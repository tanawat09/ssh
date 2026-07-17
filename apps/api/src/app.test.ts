import type { RawData } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
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

  afterEach(async () => {
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
      socket.once('message', (data) => resolve(data))
    })
    expect(JSON.parse(message.toString())).toEqual({
      type: 'error',
      code: 'SERVER_NOT_FOUND',
      message: 'Server not found',
    })
    socket.terminate()
  })
})
