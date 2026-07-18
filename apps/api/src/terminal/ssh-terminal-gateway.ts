import { timingSafeEqual } from 'node:crypto'

import { ApiErrorCode } from '@remote/shared'
import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type PseudoTtyOptions,
} from 'ssh2'

import type { ServerConnectionMaterial } from '../database/server-repository.js'
import { ApplicationError } from '../domain/application-error.js'
import type { ServerCredential } from '../security/credential-cipher.js'

export interface SshTerminal {
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  close(): void
  onData(listener: (data: Buffer) => void): void
  onClose(listener: () => void): void
}

export interface OpenTerminalOptions {
  material: ServerConnectionMaterial
  credential: ServerCredential
  timeoutMs: number
}

interface SshClientError extends Error {
  level?: string
}

function authenticationError(): ApplicationError {
  return new ApplicationError(
    ApiErrorCode.SSH_AUTHENTICATION_FAILED,
    422,
    'SSH authentication failed',
  )
}

function connectionError(): ApplicationError {
  return new ApplicationError(
    ApiErrorCode.SSH_CONNECTION_FAILED,
    502,
    'SSH connection failed',
  )
}

function hostKeyMismatchError(): ApplicationError {
  return new ApplicationError(
    ApiErrorCode.SSH_HOST_KEY_MISMATCH,
    502,
    'SSH host key does not match the saved server',
  )
}

function timeoutError(): ApplicationError {
  return new ApplicationError(
    ApiErrorCode.SSH_TIMEOUT,
    504,
    'SSH connection timed out',
  )
}

function safeEnd(client: Client): void {
  try {
    client.end()
  } catch {
    // ssh2 can reject a close after a failed connection attempt.
  }
}

class Ssh2Terminal implements SshTerminal {
  #closed = false

  constructor(
    private readonly client: Client,
    private readonly channel: ClientChannel,
  ) {}

  write(data: string): void {
    this.channel.write(data)
  }

  resize(cols: number, rows: number): void {
    this.channel.setWindow(rows, cols, 0, 0)
  }

  pause(): void {
    this.channel.pause()
  }

  resume(): void {
    this.channel.resume()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.channel.end()
    } catch {
      // The channel can already be closed by the remote endpoint.
    }
    safeEnd(this.client)
  }

  onData(listener: (data: Buffer) => void): void {
    this.channel.on('data', listener)
  }

  onClose(listener: () => void): void {
    this.channel.once('close', listener)
  }
}

export class SshTerminalGateway {
  constructor(
    private readonly createClient: () => Client = () => new Client(),
  ) {}

  openTerminal({
    material,
    credential,
    timeoutMs,
  }: OpenTerminalOptions): Promise<SshTerminal> {
    return new Promise((resolve, reject) => {
      const client = this.createClient()
      const expectedHostKey = Buffer.from(material.hostKeyBase64, 'base64')
      let hostKeyMismatch = false
      let settled = false

      const fail = (error: ApplicationError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        safeEnd(client)
        reject(error)
      }

      const succeed = (channel: ClientChannel): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(new Ssh2Terminal(client, channel))
      }

      const baseConfig: ConnectConfig = {
        host: material.host,
        port: material.port,
        username: material.username,
        hostVerifier: (presentedHostKey: Buffer) => {
          const matches =
            expectedHostKey.length === presentedHostKey.length &&
            timingSafeEqual(expectedHostKey, presentedHostKey)
          hostKeyMismatch = !matches
          return matches
        },
      }

      client.once('ready', () => {
        const pty: PseudoTtyOptions = {
          term: 'xterm-256color',
          cols: 80,
          rows: 24,
          width: 0,
          height: 0,
        }
        client.shell(pty, (error, channel) => {
          if (error) {
            fail(connectionError())
          } else {
            succeed(channel)
          }
        })
      })
      client.on('error', (error: SshClientError) => {
        if (hostKeyMismatch) {
          fail(hostKeyMismatchError())
        } else if (error.level === 'client-authentication') {
          fail(authenticationError())
        } else {
          fail(connectionError())
        }
      })
      const timer = setTimeout(() => {
        fail(timeoutError())
      }, timeoutMs)

      try {
        if (credential.authType === 'password') {
          client.connect({ ...baseConfig, password: credential.password })
        } else {
          client.connect({
            ...baseConfig,
            privateKey: credential.privateKey,
            ...(credential.passphrase === undefined
              ? {}
              : { passphrase: credential.passphrase }),
          })
        }
      } catch {
        fail(
          credential.authType === 'privateKey'
            ? authenticationError()
            : connectionError(),
        )
      }
    })
  }
}
