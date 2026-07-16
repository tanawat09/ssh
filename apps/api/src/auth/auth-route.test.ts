import argon2 from 'argon2'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config.js'
import { buildApp } from '../app.js'

const allowedOrigin = 'https://remote.example.test'
const password = 'correct horse battery staple'
let passwordHash = ''

beforeAll(async () => {
  passwordHash = await argon2.hash(password, { type: argon2.argon2id })
})

const apps: ReturnType<typeof buildApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()))
})

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    adminUsername: 'admin',
    adminPasswordHash: passwordHash,
    jwtSecret: 'a-secure-test-jwt-secret-with-32-bytes',
    jwtExpiresInSeconds: 3600,
    credentialEncryptionKey: Buffer.alloc(32, 7),
    allowedOrigin,
    databasePath: ':memory:',
    sshConnectTimeoutMs: 10_000,
    ...overrides,
  }
}

function createApp(config = createConfig()) {
  const app = buildApp({ config })
  apps.push(app)
  return app
}

function loginHeaders(origin = allowedOrigin) {
  return { origin }
}

describe('POST /api/v1/auth/login', () => {
  it('returns the admin session and an HttpOnly strict JWT cookie', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      payload: { username: 'admin', password },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { username: 'admin', role: 'admin' },
    })
    const cookie = response.headers['set-cookie']
    expect(cookie).toEqual(expect.stringContaining('remote_session='))
    expect(cookie).toEqual(expect.stringContaining('HttpOnly'))
    expect(cookie).toEqual(expect.stringContaining('SameSite=Strict'))
    expect(cookie).toEqual(expect.stringContaining('Path=/'))
    expect(cookie).not.toEqual(expect.stringContaining('Secure'))

    const token = response.cookies.find(
      ({ name }) => name === 'remote_session',
    )?.value
    expect(token).toBeDefined()
    const decoded = app.jwt.verify<{
      sub: string
      role: string
      iat: number
      exp: number
    }>(token ?? '')
    expect(decoded).toMatchObject({ sub: 'admin', role: 'admin' })
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'role', 'sub'])
    expect(decoded.exp - decoded.iat).toBe(3600)
  })

  it('sets Secure on the production session cookie', async () => {
    const app = createApp(createConfig({ nodeEnv: 'production' }))

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      payload: { username: 'admin', password },
    })

    expect(response.headers['set-cookie']).toEqual(
      expect.stringContaining('Secure'),
    )
  })

  it('accepts only HS256 JWTs', async () => {
    const app = createApp()
    await app.ready()
    const token = app.jwt.sign(
      { sub: 'admin', role: 'admin' },
      { algorithm: 'HS384' },
    )

    expect(() => app.jwt.verify(token)).toThrow()
  })

  it.each([
    { username: 'unknown', submittedPassword: password },
    { username: 'admin', submittedPassword: 'wrong-password' },
  ])(
    'returns the same generic 401 for invalid credentials',
    async ({ username, submittedPassword }) => {
      const config = createConfig()
      const app = createApp(config)

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: loginHeaders(),
        payload: { username, password: submittedPassword },
      })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Invalid username or password',
        },
      })
      expect(response.body).not.toContain(submittedPassword)
      expect(response.body).not.toContain(config.adminPasswordHash)
    },
  )

  it.each([undefined, 'https://attacker.example.test'])(
    'rejects a missing or mismatched Origin before login',
    async (origin) => {
      const app = createApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: origin === undefined ? {} : { origin },
        payload: { username: 'admin', password },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({
        error: { code: 'FORBIDDEN', message: 'Origin is not allowed' },
      })
    },
  )

  it('limits one source IP to five attempts in a rolling 15-minute window', async () => {
    const app = createApp()
    const request = {
      method: 'POST' as const,
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      remoteAddress: '192.0.2.10',
      payload: { username: 'admin', password: 'wrong-password' },
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject(request)
      expect(response.statusCode).toBe(401)
    }

    const response = await app.inject(request)
    expect(response.statusCode).toBe(429)
    expect(response.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Too many login attempts' },
    })
    expect(response.body).not.toContain(passwordHash)
  })

  it('uses independent login budgets for public clients forwarded by a private production proxy', async () => {
    const app = createApp(createConfig({ nodeEnv: 'production' }))
    const requestFor = (clientIp: string) => ({
      method: 'POST' as const,
      url: '/api/v1/auth/login',
      headers: { ...loginHeaders(), 'x-forwarded-for': clientIp },
      remoteAddress: '172.20.0.2',
      payload: { username: 'admin', password: 'wrong-password' },
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject(requestFor('198.51.100.10'))).statusCode).toBe(
        401,
      )
    }

    expect((await app.inject(requestFor('198.51.100.10'))).statusCode).toBe(429)
    expect((await app.inject(requestFor('203.0.113.20'))).statusCode).toBe(401)
  })

  it('does not let a private client spoof login budgets with a forged leftmost forwarded IP', async () => {
    const app = createApp(createConfig({ nodeEnv: 'production' }))
    const requestFor = (forgedIp: string) => ({
      method: 'POST' as const,
      url: '/api/v1/auth/login',
      headers: {
        ...loginHeaders(),
        'x-forwarded-for': `${forgedIp}, 10.20.0.8`,
      },
      remoteAddress: '172.20.0.3',
      payload: { username: 'admin', password: 'wrong-password' },
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await app.inject(requestFor(`198.51.100.${String(attempt + 1)}`)))
          .statusCode,
      ).toBe(401)
    }

    expect((await app.inject(requestFor('203.0.113.99'))).statusCode).toBe(429)
  })

  it('keeps attempts made near the end of a rolling window', async () => {
    const app = createApp()
    const request = {
      method: 'POST' as const,
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      remoteAddress: '192.0.2.11',
      payload: { username: 'admin', password: 'wrong-password' },
    }
    const now = vi.spyOn(Date, 'now')

    try {
      now.mockReturnValue(0)
      expect((await app.inject(request)).statusCode).toBe(401)

      now.mockReturnValue(14 * 60 * 1000)
      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect((await app.inject(request)).statusCode).toBe(401)
      }

      now.mockReturnValue(15 * 60 * 1000)
      expect((await app.inject(request)).statusCode).toBe(401)
      expect((await app.inject(request)).statusCode).toBe(429)
    } finally {
      now.mockRestore()
    }
  })

  it('fails closed for unseen IPs without evicting a live IP at capacity', async () => {
    const app = createApp()

    for (let index = 0; index < 5_000; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: loginHeaders(),
        remoteAddress: `198.51.${String(Math.floor(index / 256))}.${String(index % 256)}`,
        payload: {},
      })
      expect(response.statusCode).toBe(400)
    }

    const overflowRequest = {
      method: 'POST' as const,
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      remoteAddress: '203.0.113.1',
      payload: {},
    }
    expect((await app.inject(overflowRequest)).statusCode).toBe(429)

    const firstIpRequest = {
      ...overflowRequest,
      remoteAddress: '198.51.0.0',
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await app.inject(firstIpRequest)).statusCode).toBe(400)
    }
    expect((await app.inject(firstIpRequest)).statusCode).toBe(429)
  })

  it('does not retain attempts rejected by the per-IP limit', async () => {
    const app = createApp()
    const request = {
      method: 'POST' as const,
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      remoteAddress: '192.0.2.12',
      payload: { username: 'admin', password: 'wrong-password' },
    }
    const now = vi.spyOn(Date, 'now')

    try {
      now.mockReturnValue(0)
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await app.inject(request)).statusCode).toBe(401)
      }

      now.mockReturnValue(1)
      expect((await app.inject(request)).statusCode).toBe(429)

      now.mockReturnValue(15 * 60 * 1000)
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await app.inject(request)).statusCode).toBe(401)
      }
    } finally {
      now.mockRestore()
    }
  })
})

describe('GET /api/v1/auth/session', () => {
  it('returns the authenticated session from the HttpOnly cookie', async () => {
    const app = createApp()
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: loginHeaders(),
      payload: { username: 'admin', password },
    })
    const cookie = login.headers['set-cookie']
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { username: 'admin', role: 'admin' },
    })
  })

  it('rejects requests without a valid session', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
    })
    expect(response.statusCode).toBe(401)
  })
})
