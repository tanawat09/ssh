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

function request(token: string, payload: object = passwordRequest) {
  return {
    method: 'POST' as const,
    url: '/api/v1/servers',
    headers: { origin, cookie: `remote_session=${token}` },
    payload,
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
