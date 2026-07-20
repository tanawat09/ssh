import { ApiErrorCode } from '@remote/shared'
import type { RawData, WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import type { AuditEvent } from './database/audit-repository.js'
import type { ServerConnectionMaterial } from './database/server-repository.js'
import type { ServerCredential } from './security/credential-cipher.js'
import { DeleteServerService } from './servers/delete-server-service.js'
import type { SshTerminal } from './terminal/ssh-terminal-gateway.js'
import { TerminalSessionManager } from './terminal/terminal-session-manager.js'

const config: AppConfig = {
  nodeEnv: 'test',
  adminUsername: 'admin',
  adminPasswordHash: '$argon2id$v=19$test',
  jwtSecret: '01234567890123456789012345678901',
  jwtExpiresInSeconds: 3600,
  credentialEncryptionKey: Buffer.alloc(32, 7),
  allowedOrigin: 'http://localhost:8080',
  databasePath: ':memory:',
  sshConnectTimeoutMs: 1000,
}

describe('application health', () => {
  const applications = new Set<ReturnType<typeof buildApp>>()
  const sockets = new Set<WebSocket>()

  afterEach(async () => {
    sockets.forEach((socket) => {
      socket.terminate()
    })
    sockets.clear()
    await Promise.all(
      [...applications].map((application) => application.close()),
    )
    applications.clear()
  })

  it('returns a successful readiness response', async () => {
    const application = buildApp({ config })
    applications.add(application)

    const response = await application.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('registers the authenticated terminal websocket route before HTTP routes', async () => {
    const application = buildApp({
      config,
      terminalRouteDependencies: {
        allowedOrigin: config.allowedOrigin,
        sshConnectTimeoutMs: config.sshConnectTimeoutMs,
        serverRepository: {
          getConnectionMaterialById: vi.fn(() => undefined),
        },
        credentialCipher: {
          decrypt: vi.fn(() => {
            throw new Error('not used')
          }),
        },
        sshGateway: {
          openTerminal: vi.fn(() => Promise.reject(new Error('not used'))),
        },
        sessionManager: new TerminalSessionManager(),
        auditRepository: {
          recordSuccess: vi.fn(),
          recordFailure: vi.fn(),
        },
      },
    })
    applications.add(application)
    await application.ready()
    const token = application.jwt.sign({ sub: 'admin', role: 'admin' })
    const socket = await application.injectWS(
      '/api/v1/servers/missing/terminal',
      {
        headers: {
          origin: config.allowedOrigin,
          cookie: `remote_session=${token}`,
        },
      },
    )

    const message = await new Promise<RawData>((resolve) => {
      socket.once('message', (data) => {
        resolve(data)
      })
    })
    const messageBuffer = Array.isArray(message)
      ? Buffer.concat(message)
      : message instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(message))
        : Buffer.from(message)
    expect(JSON.parse(messageBuffer.toString('utf8')) as unknown).toEqual({
      type: 'error',
      code: 'SERVER_NOT_FOUND',
      message: 'Server not found',
    })
    socket.terminate()
  })

  it('shares terminal reservations with deletion without disconnecting the terminal', async () => {
    const sessionManager = new TerminalSessionManager()
    const deleteWithAudit = vi.fn<(id: string, event: AuditEvent) => boolean>(
      () => true,
    )
    const recordFailure = vi.fn<(event: AuditEvent) => void>()
    const closeTerminal = vi.fn<() => void>()
    const terminal: SshTerminal = {
      write: vi.fn(),
      resize: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      close: closeTerminal,
      onData: vi.fn(),
      onClose: vi.fn(),
    }
    const connectionMaterial: ServerConnectionMaterial = {
      id: 'server-1',
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password',
      hostKeyBase64: Buffer.from('host-key').toString('base64'),
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
    const deleteServerService = new DeleteServerService({
      serverRepository: { deleteWithAudit },
      auditRepository: { recordFailure },
      sessionManager,
    })
    const application = buildApp({
      config,
      deleteServerService,
      terminalRouteDependencies: {
        allowedOrigin: config.allowedOrigin,
        sshConnectTimeoutMs: config.sshConnectTimeoutMs,
        serverRepository: {
          getConnectionMaterialById: vi.fn(() => connectionMaterial),
        },
        credentialCipher: { decrypt: vi.fn(() => credential) },
        sshGateway: { openTerminal: vi.fn(() => Promise.resolve(terminal)) },
        sessionManager,
        auditRepository: {
          recordSuccess: vi.fn(),
          recordFailure: vi.fn(),
        },
      },
    })
    applications.add(application)
    await application.ready()
    const token = application.jwt.sign({ sub: 'admin', role: 'admin' })
    const socket = await application.injectWS(
      '/api/v1/servers/server-1/terminal',
      {
        headers: {
          origin: config.allowedOrigin,
          cookie: `remote_session=${token}`,
        },
      },
    )
    sockets.add(socket)
    await new Promise<RawData>((resolve) => {
      socket.once('message', resolve)
    })

    const response = await application.inject({
      method: 'DELETE',
      url: '/api/v1/servers/server-1',
      headers: {
        origin: config.allowedOrigin,
        cookie: `remote_session=${token}`,
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: {
        code: ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
        message: 'Disconnect the active terminal before deleting this server',
      },
    })
    expect(deleteWithAudit).not.toHaveBeenCalled()
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(sessionManager.isServerActive('server-1')).toBe(true)
  })
})
