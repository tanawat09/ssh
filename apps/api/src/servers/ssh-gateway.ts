import { createHash } from 'node:crypto'

import { ApiErrorCode, type CreateServerRequest } from '@remote/shared'
import { Client, type ConnectConfig } from 'ssh2'

import { ApplicationError } from '../domain/application-error.js'

export interface VerifiedHostKey {
  algorithm: string
  fingerprint: string
  keyBase64: string
}

export interface SshGateway {
  testConnection(
    request: CreateServerRequest,
    timeoutMs: number,
  ): Promise<VerifiedHostKey>
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

function timeoutError(): ApplicationError {
  return new ApplicationError(
    ApiErrorCode.SSH_TIMEOUT,
    504,
    'SSH connection timed out',
  )
}

function errorFor(error: SshClientError): ApplicationError {
  return error.level === 'client-authentication'
    ? authenticationError()
    : connectionError()
}

function deriveHostKeyAlgorithm(key: Buffer): string | undefined {
  if (key.length < 4) {
    return undefined
  }

  const algorithmLength = key.readUInt32BE(0)
  const algorithmEnd = 4 + algorithmLength
  if (algorithmLength === 0 || algorithmEnd > key.length) {
    return undefined
  }

  const algorithm = key.subarray(4, algorithmEnd).toString('ascii')
  return /^[\x21-\x7e]+$/.test(algorithm) ? algorithm : undefined
}

function toVerifiedHostKey(key: Buffer): VerifiedHostKey | undefined {
  const algorithm = deriveHostKeyAlgorithm(key)
  if (algorithm === undefined) {
    return undefined
  }

  return {
    algorithm,
    fingerprint: `SHA256:${createHash('sha256')
      .update(key)
      .digest('base64')
      .replace(/=+$/, '')}`,
    keyBase64: key.toString('base64'),
  }
}

export class Ssh2Gateway implements SshGateway {
  constructor(
    private readonly createClient: () => Client = () => new Client(),
  ) {}

  testConnection(
    request: CreateServerRequest,
    timeoutMs: number,
  ): Promise<VerifiedHostKey> {
    return new Promise((resolve, reject) => {
      const client = this.createClient()
      let settled = false
      let timer: NodeJS.Timeout | undefined
      let hostKey: VerifiedHostKey | undefined

      const finish = (
        result: ApplicationError | VerifiedHostKey,
        closeClient = true,
      ): void => {
        if (settled) {
          return
        }
        settled = true
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        if (closeClient) {
          try {
            client.end()
          } catch {
            // ssh2 can synchronously reject a close after a failed connect.
          }
        }

        if (result instanceof ApplicationError) {
          reject(result)
        } else {
          resolve(result)
        }
      }

      const baseConfig: ConnectConfig = {
        host: request.host,
        port: request.port,
        username: request.username,
        hostVerifier: (key: Buffer) => {
          hostKey = toVerifiedHostKey(key)
          return hostKey !== undefined
        },
      }

      client.once('ready', () => {
        finish(hostKey ?? connectionError())
      })
      client.on('error', (error) => {
        const applicationError = errorFor(error)
        finish(
          applicationError,
          applicationError.code !== ApiErrorCode.SSH_AUTHENTICATION_FAILED,
        )
      })
      timer = setTimeout(() => {
        finish(timeoutError())
      }, timeoutMs)

      try {
        if (request.authType === 'password') {
          client.connect({ ...baseConfig, password: request.password })
        } else if (request.passphrase === undefined) {
          client.connect({ ...baseConfig, privateKey: request.privateKey })
        } else {
          client.connect({
            ...baseConfig,
            passphrase: request.passphrase,
            privateKey: request.privateKey,
          })
        }
      } catch {
        finish(
          request.authType === 'privateKey'
            ? authenticationError()
            : connectionError(),
        )
      }
    })
  }
}
