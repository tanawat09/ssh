import { afterEach, describe, expect, it } from 'vitest'

import { buildApp } from './app.js'
import type { AppConfig } from './config.js'

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
})
