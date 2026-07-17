import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import type { RawData, WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServerConnectionMaterial } from '../database/server-repository.js'
import type { ServerCredential } from '../security/credential-cipher.js'
import type { SshTerminal } from './ssh-terminal-gateway.js'
import { TerminalSessionManager } from './terminal-session-manager.js'
import { registerTerminalRoute } from './terminal-route.js'

const origin = 'http://localhost:8080'
const hostKeyBase64 = Buffer.from('host-key').toString('base64')
const material: ServerConnectionMaterial = {
  id: 'server-1',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyBase64,
  encryptedCredential: {
    encryptedPayload: 'encrypted',
    iv: 'iv',
    authTag: 'tag',
  },
}
const credential: ServerCredential = {
  authType: 'password',
  password: 'test-password',
}

class FakeTerminal implements SshTerminal {
  readonly write = vi.fn<(data: string) => void>()
  readonly resize = vi.fn<(cols: number, rows: number) => void>()
  readonly pause = vi.fn<() => void>()
  readonly resume = vi.fn<() => void>()
  readonly close = vi.fn<() => void>()
  #dataListeners: ((data: Buffer) => void)[] = []
  #closeListeners: (() => void)[] = []

  onData(listener: (data: Buffer) => void): void {
    this.#dataListeners.push(listener)
  }

  onClose(listener: () => void): void {
    this.#closeListeners.push(listener)
  }

  emitData(data: Buffer): void {
    this.#dataListeners.forEach((listener) => listener(data))
  }

  emitClose(): void {
    this.#closeListeners.forEach((listener) => listener())
  }
}

interface SetupOverrides {
  connectionMaterial?: ServerConnectionMaterial | undefined
  openError?: Error
}

const applications: FastifyInstance[] = []
const sockets: WebSocket[] = []

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.terminate())
  await Promise.all(applications.splice(0).map((app) => app.close()))
})

async function setup(overrides: SetupOverrides = {}) {
  const app = Fastify()
  applications.push(app)
  await app.register(cookie)
  await app.register(jwt, {
    secret: 'a-secure-test-jwt-secret-with-32-bytes',
    cookie: { cookieName: 'remote_session', signed: false },
    sign: { algorithm: 'HS256', expiresIn: 3600 },
    verify: { algorithms: ['HS256'] },
  })
  await app.register(websocket, {
    options: { maxPayload: 65_536, perMessageDeflate: false },
  })

  const terminal = new FakeTerminal()
  let resolveOpen: ((value: SshTerminal) => void) | undefined
  const openPromise =
    overrides.openError === undefined
      ? new Promise<SshTerminal>((resolve) => {
          resolveOpen = resolve
        })
      : Promise.reject(overrides.openError)
  const openTerminal = vi.fn(() => openPromise)
  const decrypt = vi.fn(() => credential)
  const getConnectionMaterialById = vi.fn(() =>
    Object.hasOwn(overrides, 'connectionMaterial')
      ? overrides.connectionMaterial
      : material,
  )
  const recordSuccess = vi.fn()
  const recordFailure = vi.fn()

  registerTerminalRoute(app, {
    allowedOrigin: origin,
    sshConnectTimeoutMs: 1_000,
    serverRepository: { getConnectionMaterialById },
    credentialCipher: { decrypt },
    sshGateway: { openTerminal },
    sessionManager: new TerminalSessionManager(),
    auditRepository: { recordSuccess, recordFailure },
    generateId: () => 'audit-id',
    now: () => new Date('2026-07-17T00:00:00.000Z'),
  })
  await app.ready()
  const token = app.jwt.sign({ sub: 'admin', role: 'admin' })

  return {
    app,
    terminal,
    resolveOpen: () => resolveOpen?.(terminal),
    openTerminal,
    decrypt,
    getConnectionMaterialById,
    recordSuccess,
    recordFailure,
    headers: { origin, cookie: `remote_session=${token}` },
  }
}

function nextMessage(
  socket: WebSocket,
): Promise<{ data: RawData; isBinary: boolean }> {
  return new Promise((resolve) => {
    socket.once('message', (data, isBinary) => resolve({ data, isBinary }))
  })
}

describe('terminal websocket route', () => {
  it('rejects upgrades without the JWT cookie or exact allowed Origin', async () => {
    const { app, headers } = await setup()

    await expect(
      app.injectWS('/api/v1/servers/server-1/terminal', {
        headers: { origin },
      }),
    ).rejects.toThrow(/401/)
    await expect(
      app.injectWS('/api/v1/servers/server-1/terminal', {
        headers: { ...headers, origin: 'https://attacker.example' },
      }),
    ).rejects.toThrow(/403/)
  })

  it('opens a terminal and forwards binary output, input, and resize', async () => {
    const context = await setup()
    const socket = await context.app.injectWS(
      '/api/v1/servers/server-1/terminal',
      { headers: context.headers },
    )
    sockets.push(socket)
    const readyMessage = nextMessage(socket)
    context.resolveOpen()

    expect(JSON.parse((await readyMessage).data.toString())).toEqual({
      type: 'ready',
      sessionId: expect.any(String),
    })
    expect(context.getConnectionMaterialById).toHaveBeenCalledWith('server-1')
    expect(context.decrypt).toHaveBeenCalledWith(material.encryptedCredential)
    expect(context.openTerminal).toHaveBeenCalledWith({
      material,
      credential,
      timeoutMs: 1_000,
    })

    const outputMessage = nextMessage(socket)
    context.terminal.emitData(Buffer.from('terminal output'))
    const output = await outputMessage
    expect(output.isBinary).toBe(true)
    expect(output.data.toString()).toBe('terminal output')

    socket.send(JSON.stringify({ type: 'input', data: 'whoami\r' }))
    socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    await vi.waitFor(() => {
      expect(context.terminal.write).toHaveBeenCalledWith('whoami\r')
      expect(context.terminal.resize).toHaveBeenCalledWith(120, 40)
    })
    expect(context.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'terminal.connect',
        result: 'success',
        targetId: 'server-1',
      }),
    )
  })

  it('disconnects explicitly and records sanitized duration metadata', async () => {
    const context = await setup()
    const socket = await context.app.injectWS(
      '/api/v1/servers/server-1/terminal',
      { headers: context.headers },
    )
    sockets.push(socket)
    const readyMessage = nextMessage(socket)
    context.resolveOpen()
    await readyMessage
    const closedMessage = nextMessage(socket)

    socket.send(JSON.stringify({ type: 'disconnect' }))

    expect(JSON.parse((await closedMessage).data.toString())).toEqual({
      type: 'closed',
      reason: 'client',
    })
    await vi.waitFor(() => expect(context.terminal.close).toHaveBeenCalled())
    expect(context.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'terminal.disconnect',
        metadata: { reason: 'client', durationMs: 0 },
      }),
    )
  })

  it('returns stable errors for a missing server and invalid protocol', async () => {
    const missing = await setup({ connectionMaterial: undefined })
    const missingSocket = await missing.app.injectWS(
      '/api/v1/servers/missing/terminal',
      { headers: missing.headers },
    )
    sockets.push(missingSocket)
    expect(
      JSON.parse((await nextMessage(missingSocket)).data.toString()),
    ).toEqual({
      type: 'error',
      code: 'SERVER_NOT_FOUND',
      message: 'Server not found',
    })
    expect(missing.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'terminal.connect',
        result: 'failure',
        metadata: { errorCode: 'SERVER_NOT_FOUND' },
      }),
    )

    const invalid = await setup()
    const invalidSocket = await invalid.app.injectWS(
      '/api/v1/servers/server-1/terminal',
      { headers: invalid.headers },
    )
    sockets.push(invalidSocket)
    const readyMessage = nextMessage(invalidSocket)
    invalid.resolveOpen()
    await readyMessage
    invalid.recordSuccess.mockClear()
    invalid.recordFailure.mockClear()
    invalidSocket.send('{invalid')
    expect(
      JSON.parse((await nextMessage(invalidSocket)).data.toString()),
    ).toEqual({
      type: 'error',
      code: 'TERMINAL_PROTOCOL_ERROR',
      message: 'Invalid terminal message',
    })
    expect(invalid.recordFailure).not.toHaveBeenCalled()
    expect(invalid.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'terminal.disconnect',
        metadata: { reason: 'error', durationMs: 0 },
      }),
    )
  })
})
