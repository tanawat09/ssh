import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.js'

const validEnv = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD_HASH: '$argon2id$v=19$test',
  JWT_SECRET: 'a-secure-test-jwt-secret-with-32-bytes',
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ALLOWED_ORIGIN: 'https://remote.example.test',
  DATABASE_PATH: '/data/remote.sqlite',
}

describe('loadConfig', () => {
  it.each([
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'JWT_SECRET',
    'CREDENTIAL_ENCRYPTION_KEY',
    'ALLOWED_ORIGIN',
    'DATABASE_PATH',
  ])('rejects a missing %s', (variable) => {
    const env = Object.fromEntries(
      Object.entries(validEnv).filter(([name]) => name !== variable),
    )

    expect(() => loadConfig(env)).toThrow(
      `Missing required environment variable: ${variable}`,
    )
  })

  it('rejects an encryption key that does not decode to 32 bytes', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64'),
      }),
    ).toThrow('CREDENTIAL_ENCRYPTION_KEY must be Base64-encoded 32 bytes')
  })

  it.each(['a'.repeat(31), 'ก'.repeat(10)])(
    'rejects a JWT secret shorter than 32 UTF-8 bytes',
    (jwtSecret) => {
      expect(() => loadConfig({ ...validEnv, JWT_SECRET: jwtSecret })).toThrow(
        'JWT_SECRET must be at least 32 UTF-8 bytes',
      )
    },
  )

  it('accepts a JWT secret that is exactly 32 UTF-8 bytes', () => {
    const jwtSecret = `${'ก'.repeat(10)}ab`

    expect(loadConfig({ ...validEnv, JWT_SECRET: jwtSecret }).jwtSecret).toBe(
      jwtSecret,
    )
  })

  it.each(['999', '60001', '1000.5', 'not-a-number'])(
    'rejects invalid SSH_CONNECT_TIMEOUT_MS value %s',
    (sshConnectTimeoutMs) => {
      expect(() =>
        loadConfig({
          ...validEnv,
          SSH_CONNECT_TIMEOUT_MS: sshConnectTimeoutMs,
        }),
      ).toThrow('SSH_CONNECT_TIMEOUT_MS must be an integer from 1000 to 60000')
    },
  )

  it.each(['299', '28801', '3600.5', 'not-a-number'])(
    'rejects invalid JWT_EXPIRES_IN_SECONDS value %s',
    (jwtExpiresInSeconds) => {
      expect(() =>
        loadConfig({
          ...validEnv,
          JWT_EXPIRES_IN_SECONDS: jwtExpiresInSeconds,
        }),
      ).toThrow('JWT_EXPIRES_IN_SECONDS must be an integer from 300 to 28800')
    },
  )

  it('returns parsed values and safe defaults', () => {
    const config = loadConfig({ ...validEnv })

    expect(config).toEqual({
      nodeEnv: 'development',
      adminUsername: validEnv.ADMIN_USERNAME,
      adminPasswordHash: validEnv.ADMIN_PASSWORD_HASH,
      jwtSecret: validEnv.JWT_SECRET,
      jwtExpiresInSeconds: 3600,
      credentialEncryptionKey: Buffer.alloc(32, 7),
      allowedOrigin: validEnv.ALLOWED_ORIGIN,
      databasePath: validEnv.DATABASE_PATH,
      sshConnectTimeoutMs: 10_000,
    })
    expect(config).not.toHaveProperty('credentialEncryptionKeyBase64')
  })

  it('accepts inclusive numeric bounds and the configured node environment', () => {
    const low = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      SSH_CONNECT_TIMEOUT_MS: '1000',
      JWT_EXPIRES_IN_SECONDS: '300',
    })
    const high = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      SSH_CONNECT_TIMEOUT_MS: '60000',
      JWT_EXPIRES_IN_SECONDS: '28800',
    })

    expect(low).toMatchObject({
      nodeEnv: 'test',
      sshConnectTimeoutMs: 1000,
      jwtExpiresInSeconds: 300,
    })
    expect(high).toMatchObject({
      nodeEnv: 'production',
      sshConnectTimeoutMs: 60_000,
      jwtExpiresInSeconds: 28_800,
    })
  })
})
