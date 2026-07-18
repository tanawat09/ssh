import { EventEmitter } from 'node:events'

import type { Client, ClientChannel, ConnectConfig } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'

import type { ServerConnectionMaterial } from '../database/server-repository.js'
import { SshTerminalGateway } from './ssh-terminal-gateway.js'

const hostKey = Buffer.from('stored-host-key')

const material: ServerConnectionMaterial = {
  id: 'server-1',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyBase64: hostKey.toString('base64'),
  encryptedCredential: {
    encryptedPayload: 'encrypted',
    iv: 'iv',
    authTag: 'tag',
  },
}

class FakeChannel extends EventEmitter {
  readonly write = vi.fn<(data: string) => boolean>(() => true)
  readonly setWindow =
    vi.fn<(rows: number, cols: number, height: number, width: number) => void>()
  readonly pause = vi.fn<() => void>()
  readonly resume = vi.fn<() => void>()
  readonly end = vi.fn<() => void>()
}

class FakeClient extends EventEmitter {
  connectConfig: ConnectConfig | undefined
  shellOptions: Record<string, unknown> | undefined
  readonly channel = new FakeChannel()
  readonly end = vi.fn<() => void>()

  constructor(
    private readonly behavior:
      'ready' | 'auth-error' | 'connection-error' | 'silent' = 'ready',
    private readonly presentedHostKey = hostKey,
  ) {
    super()
  }

  connect(config: ConnectConfig): void {
    this.connectConfig = config
    if (this.behavior === 'silent') return
    queueMicrotask(() => {
      if (this.behavior === 'auth-error') {
        this.emit(
          'error',
          Object.assign(new Error('rejected'), {
            level: 'client-authentication',
          }),
        )
        return
      }
      if (this.behavior === 'connection-error') {
        this.emit('error', new Error('refused'))
        return
      }
      const verifyHost = config.hostVerifier as
        ((key: Buffer) => boolean) | undefined
      if (verifyHost?.(this.presentedHostKey) !== true) {
        this.emit('error', new Error('host rejected'))
        return
      }
      this.emit('ready')
    })
  }

  shell(
    options: Record<string, unknown>,
    callback: (
      error: Error | undefined,
      channel: ClientChannel | undefined,
    ) => void,
  ): void {
    this.shellOptions = options
    callback(undefined, this.channel as unknown as ClientChannel)
  }
}

function gatewayFor(client: FakeClient): SshTerminalGateway {
  return new SshTerminalGateway(() => client as unknown as Client)
}

describe('SshTerminalGateway', () => {
  it('opens a password-authenticated xterm PTY pinned to the stored host key', async () => {
    const client = new FakeClient()

    const terminal = await gatewayFor(client).openTerminal({
      material,
      credential: { authType: 'password', password: 'test-password' },
      timeoutMs: 1_000,
    })

    expect(client.connectConfig).toMatchObject({
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      password: 'test-password',
    })
    expect(client.shellOptions).toEqual({
      term: 'xterm-256color',
      cols: 80,
      rows: 24,
      width: 0,
      height: 0,
    })
    expect(terminal).toBeDefined()
  })

  it('opens a private-key terminal with an optional passphrase', async () => {
    const client = new FakeClient()
    await gatewayFor(client).openTerminal({
      material: { ...material, authType: 'privateKey' },
      credential: {
        authType: 'privateKey',
        privateKey: 'test-private-key',
        passphrase: 'test-passphrase',
      },
      timeoutMs: 1_000,
    })

    expect(client.connectConfig).toMatchObject({
      privateKey: 'test-private-key',
      passphrase: 'test-passphrase',
    })
    expect(client.connectConfig).not.toHaveProperty('password')
  })

  it('forwards terminal data, input, resize, flow control, and close', async () => {
    const client = new FakeClient()
    const terminal = await gatewayFor(client).openTerminal({
      material,
      credential: { authType: 'password', password: 'test-password' },
      timeoutMs: 1_000,
    })
    const onData = vi.fn<(data: Buffer) => void>()
    const onClose = vi.fn<() => void>()
    terminal.onData(onData)
    terminal.onClose(onClose)

    client.channel.emit('data', Buffer.from('hello'))
    client.channel.emit('close')
    terminal.write('whoami\r')
    terminal.resize(120, 40)
    terminal.pause()
    terminal.resume()
    terminal.close()
    terminal.close()

    expect(onData).toHaveBeenCalledWith(Buffer.from('hello'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(client.channel.write).toHaveBeenCalledWith('whoami\r')
    expect(client.channel.setWindow).toHaveBeenCalledWith(40, 120, 0, 0)
    expect(client.channel.pause).toHaveBeenCalledTimes(1)
    expect(client.channel.resume).toHaveBeenCalledTimes(1)
    expect(client.channel.end).toHaveBeenCalledTimes(1)
    expect(client.end).toHaveBeenCalledTimes(1)
  })

  it('rejects a changed host key with a stable mismatch error', async () => {
    const client = new FakeClient('ready', Buffer.from('different-host-key'))

    await expect(
      gatewayFor(client).openTerminal({
        material,
        credential: { authType: 'password', password: 'test-password' },
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      code: 'SSH_HOST_KEY_MISMATCH',
      statusCode: 502,
      message: 'SSH host key does not match the saved server',
    })
    expect(client.end).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['auth-error' as const, 'SSH_AUTHENTICATION_FAILED', 422],
    ['connection-error' as const, 'SSH_CONNECTION_FAILED', 502],
  ])(
    'maps %s without exposing the raw ssh error',
    async (behavior, code, statusCode) => {
      const client = new FakeClient(behavior)

      await expect(
        gatewayFor(client).openTerminal({
          material,
          credential: { authType: 'password', password: 'test-password' },
          timeoutMs: 1_000,
        }),
      ).rejects.toMatchObject({ code, statusCode })
      expect(client.end).toHaveBeenCalledTimes(1)
    },
  )

  it('closes an unresponsive client and returns the stable timeout', async () => {
    const client = new FakeClient('silent')

    await expect(
      gatewayFor(client).openTerminal({
        material,
        credential: { authType: 'password', password: 'test-password' },
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      code: 'SSH_TIMEOUT',
      statusCode: 504,
      message: 'SSH connection timed out',
    })
    expect(client.end).toHaveBeenCalledTimes(1)
  })
})
