import {
  ApiErrorCode,
  type CreateServerRequest,
  type ServerDto,
} from '@remote/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../app.js'
import type { AppConfig } from '../config.js'
import { ApplicationError } from '../domain/application-error.js'

const origin = 'https://remote.example.test'
const config: AppConfig = {
  nodeEnv: 'test',
  adminUsername: 'admin',
  adminPasswordHash: 'unused',
  jwtSecret: 'a-secure-test-jwt-secret-with-32-bytes',
  jwtExpiresInSeconds: 3600,
  credentialEncryptionKey: Buffer.alloc(32, 7),
  allowedOrigin: origin,
  databasePath: ':memory:',
  sshConnectTimeoutMs: 10_000,
}
const passwordRequest: CreateServerRequest = {
  name: 'Production',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  password: 'password-secret',
}
const privateKeyRequest: CreateServerRequest = {
  name: 'Production',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'privateKey',
  privateKey: 'private-key-secret',
  passphrase: 'passphrase-secret',
}
const dto: ServerDto = {
  id: 'server-id',
  name: 'Production',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyFingerprint: 'SHA256:fingerprint',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
}

const apps: ReturnType<typeof buildApp>[] = []
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

async function setup(execute = vi.fn(() => Promise.resolve(dto))) {
  const app = buildApp({ config, createServerService: { execute } })
  apps.push(app)
  await app.ready()
  const token = app.jwt.sign({ sub: 'admin', role: 'admin' })
  return { app, execute, token }
}

async function setupList(execute = vi.fn(() => Promise.resolve([dto]))) {
  const app = buildApp({ config, listServerService: { execute } })
  apps.push(app)
  await app.ready()
  const token = app.jwt.sign({ sub: 'admin', role: 'admin' })
  return { app, execute, token }
}

async function setupDelete(
  execute = vi.fn<
    (serverId: string, context: { actor: string; sourceIp?: string }) => void
  >(),
) {
  const app = buildApp({ config, deleteServerService: { execute } })
  apps.push(app)
  await app.ready()
  const token = app.jwt.sign({ sub: 'admin', role: 'admin' })
  return { app, execute, token }
}

async function setupWithConfig(
  configured: AppConfig,
  execute = vi.fn(() => Promise.resolve(dto)),
) {
  const app = buildApp({ config: configured, createServerService: { execute } })
  apps.push(app)
  await app.ready()
  const token = app.jwt.sign({ sub: 'admin', role: 'admin' })
  return { app, execute, token }
}

function request(token: string, payload: object = passwordRequest) {
  return {
    method: 'POST' as const,
    url: '/api/v1/servers',
    headers: { origin, cookie: `remote_session=${token}` },
    payload,
  }
}

function deleteRequest(token: string, serverId = 'server-1') {
  return {
    method: 'DELETE' as const,
    url: `/api/v1/servers/${serverId}`,
    headers: { origin, cookie: `remote_session=${token}` },
  }
}

describe('POST /api/v1/servers', () => {
  it.each([passwordRequest, privateKeyRequest])(
    'creates both credential variants and returns a secret-free DTO',
    async (payload) => {
      const { app, execute, token } = await setup()
      const response = await app.inject(request(token, payload))

      expect(response.statusCode).toBe(201)
      expect(response.json()).toEqual(dto)
      expect(execute).toHaveBeenCalledWith(payload, {
        actor: 'admin',
        sourceIp: '127.0.0.1',
      })
      expect(response.body).not.toMatch(
        /password-secret|private-key-secret|passphrase-secret/,
      )
    },
  )

  it('rejects invalid bodies with a stable 400 without invoking the service', async () => {
    const { app, execute, token } = await setup()
    const response = await app.inject(
      request(token, { ...passwordRequest, host: '' }),
    )
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: ApiErrorCode.INVALID_REQUEST, message: 'Invalid request' },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('uses the client reported by nginx through a private proxy', async () => {
    const { app, execute, token } = await setupWithConfig({
      ...config,
      nodeEnv: 'production',
    })
    const response = await app.inject({
      ...request(token),
      remoteAddress: '172.20.0.2',
      headers: {
        ...request(token).headers,
        'x-forwarded-for': '198.51.100.42, 10.0.0.8',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(execute).toHaveBeenCalledWith(passwordRequest, {
      actor: 'admin',
      sourceIp: '198.51.100.42',
    })
  })

  it('does not trust forwarded addresses from a public peer', async () => {
    const { app, execute, token } = await setupWithConfig({
      ...config,
      nodeEnv: 'production',
    })
    const response = await app.inject({
      ...request(token),
      remoteAddress: '198.51.100.42',
      headers: {
        ...request(token).headers,
        'x-forwarded-for': '10.0.0.8',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(execute).toHaveBeenCalledWith(passwordRequest, {
      actor: 'admin',
      sourceIp: '198.51.100.42',
    })
  })

  it('requires authentication and permission', async () => {
    const { app } = await setup()
    const unauthenticated = await app.inject({
      ...request('invalid'),
      headers: { origin },
    })
    const forbiddenToken = app.jwt.sign({ sub: 'viewer', role: 'viewer' })
    const forbidden = await app.inject(request(forbiddenToken))
    expect(unauthenticated.statusCode).toBe(401)
    expect(forbidden.statusCode).toBe(403)
  })

  it('rejects a missing or mismatched origin before service execution', async () => {
    const { app, execute, token } = await setup()
    for (const headers of [
      { cookie: `remote_session=${token}` },
      { origin: 'https://attacker.test', cookie: `remote_session=${token}` },
    ]) {
      const response = await app.inject({ ...request(token), headers })
      expect(response.statusCode).toBe(403)
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    [ApiErrorCode.SERVER_ALREADY_EXISTS, 409],
    [ApiErrorCode.SSH_AUTHENTICATION_FAILED, 422],
    [ApiErrorCode.SSH_CONNECTION_FAILED, 502],
    [ApiErrorCode.SSH_TIMEOUT, 504],
  ] as const)(
    'maps %s to %i without raw errors or secrets',
    async (code, status) => {
      const execute = vi.fn(() =>
        Promise.reject(new ApplicationError(code, status, 'Safe failure')),
      )
      const { app, token } = await setup(execute)
      const response = await app.inject(request(token, privateKeyRequest))
      expect(response.statusCode).toBe(status)
      expect(response.json()).toEqual({
        error: { code, message: 'Safe failure' },
      })
      expect(response.body).not.toMatch(
        /private-key-secret|passphrase-secret|ssh2|SQLITE/,
      )
    },
  )

  it('maps unexpected service errors to a stable 500', async () => {
    const { app, token } = await setup(
      vi.fn(() => Promise.reject(new Error('SQLITE raw'))),
    )
    const response = await app.inject(request(token))
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: {
        code: ApiErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    })
    expect(response.body).not.toMatch(/SQLITE|password-secret/)
  })
})

describe('GET /api/v1/servers', () => {
  it('requires authentication and permission', async () => {
    const { app, token } = await setupList()
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/v1/servers',
      headers: { origin },
    })
    const viewer = app.jwt.sign({ sub: 'viewer', role: 'viewer' })
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/servers',
      headers: { origin, cookie: `remote_session=${viewer}` },
    })
    expect(unauthenticated.statusCode).toBe(401)
    expect(forbidden.statusCode).toBe(403)
    expect(token).toBeTruthy()
  })

  it('returns servers and passes authenticated actor/source to service', async () => {
    const { app, execute, token } = await setupList()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/servers',
      headers: { origin, cookie: `remote_session=${token}` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([dto])
    expect(execute).toHaveBeenCalledWith({
      actor: 'admin',
      sourceIp: '127.0.0.1',
    })
  })
})

describe('DELETE /api/v1/servers/:serverId', () => {
  it('returns 204 and passes the authenticated actor and source IP', async () => {
    const { app, execute, token } = await setupDelete()

    const response = await app.inject(deleteRequest(token))

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(execute).toHaveBeenCalledWith('server-1', {
      actor: 'admin',
      sourceIp: '127.0.0.1',
    })
  })

  it('requires authentication and servers:delete permission', async () => {
    const { app, execute } = await setupDelete()
    const unauthenticated = await app.inject({
      method: 'DELETE',
      url: '/api/v1/servers/server-1',
      headers: { origin },
    })
    const viewer = app.jwt.sign({ sub: 'viewer', role: 'viewer' })
    const forbidden = await app.inject(deleteRequest(viewer))

    expect(unauthenticated.statusCode).toBe(401)
    expect(unauthenticated.json()).toEqual({
      error: {
        code: ApiErrorCode.UNAUTHENTICATED,
        message: 'Authentication required',
      },
    })
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json()).toEqual({
      error: { code: ApiErrorCode.FORBIDDEN, message: 'Permission denied' },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires the exact configured Origin', async () => {
    const { app, execute, token } = await setupDelete()

    for (const headers of [
      { cookie: `remote_session=${token}` },
      { origin: 'https://attacker.test', cookie: `remote_session=${token}` },
    ]) {
      const response = await app.inject({
        ...deleteRequest(token),
        headers,
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({
        error: {
          code: ApiErrorCode.FORBIDDEN,
          message: 'Origin is not allowed',
        },
      })
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a server ID longer than 128 characters', async () => {
    const { app, execute, token } = await setupDelete()

    const response = await app.inject(deleteRequest(token, 's'.repeat(129)))

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: ApiErrorCode.INVALID_REQUEST, message: 'Invalid request' },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns a stable 400 when the server ID exceeds the router limit', async () => {
    const { app, execute, token } = await setupDelete()
    const serverId = 's'.repeat(257)

    const response = await app.inject(deleteRequest(token, serverId))

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: ApiErrorCode.INVALID_REQUEST, message: 'Invalid request' },
    })
    expect(response.body).not.toContain(serverId)
    expect(response.body).not.toContain('/api/v1/servers/')
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    [ApiErrorCode.SERVER_NOT_FOUND, 404, 'Server not found'],
    [
      ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
      409,
      'Disconnect the active terminal before deleting this server',
    ],
  ] as const)(
    'propagates %s as a stable %i response',
    async (code, status, message) => {
      const { app, token } = await setupDelete(
        vi.fn(() => {
          throw new ApplicationError(code, status, message)
        }),
      )

      const response = await app.inject(deleteRequest(token))

      expect(response.statusCode).toBe(status)
      expect(response.json()).toEqual({ error: { code, message } })
    },
  )

  it('maps unexpected errors to a stable 500 response', async () => {
    const { app, token } = await setupDelete(
      vi.fn(() => {
        throw new Error('SQLITE secret detail')
      }),
    )

    const response = await app.inject(deleteRequest(token))

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: {
        code: ApiErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    })
    expect(response.body).not.toContain('SQLITE secret detail')
  })
})
