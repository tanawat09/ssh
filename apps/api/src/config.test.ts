import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.js'

const validEnv = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD_HASH:
    '$argon2id$v=19$m=65536,t=3,p=4$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
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

  it.each([
    '$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
    '$argon2id$v=18$m=65536,t=3,p=4$c2FsdA$aGFzaA',
    '$argon2id$v=19$test',
    'not-a-password-hash',
  ])('rejects a malformed Argon2id password hash', (adminPasswordHash) => {
    expect(() =>
      loadConfig({ ...validEnv, ADMIN_PASSWORD_HASH: adminPasswordHash }),
    ).toThrow('ADMIN_PASSWORD_HASH must be an Argon2id PHC string')
  })

  it.each([
    '$argon2id$v=19$m=0,t=3,p=4$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=19455,t=3,p=4$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=262145,t=3,p=4$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=65536,t=1,p=4$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=65536,t=11,p=4$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=65536,t=3,p=0$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=65536,t=3,p=17$c2FsdC1ieXRlcw$YWJjZGVmZ2hpamtsbW5vcA',
    '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$YWJjZGVmZ2hpamtsbW5vcA',
    `$argon2id$v=19$m=65536,t=3,p=4$${Buffer.alloc(65, 1)
      .toString('base64')
      .replace(/=+$/, '')}$YWJjZGVmZ2hpamtsbW5vcA`,
    `$argon2id$v=19$m=65536,t=3,p=4$c2FsdC1ieXRlcw$${Buffer.alloc(15, 1)
      .toString('base64')
      .replace(/=+$/, '')}`,
    `$argon2id$v=19$m=65536,t=3,p=4$c2FsdC1ieXRlcw$${Buffer.alloc(65, 1)
      .toString('base64')
      .replace(/=+$/, '')}`,
  ])(
    'rejects unsafe Argon2id costs or decoded field lengths',
    (adminPasswordHash) => {
      expect(() =>
        loadConfig({ ...validEnv, ADMIN_PASSWORD_HASH: adminPasswordHash }),
      ).toThrow(
        'ADMIN_PASSWORD_HASH Argon2id costs or field lengths are outside supported bounds',
      )
    },
  )

  it('accepts inclusive Argon2id cost and decoded field bounds', () => {
    const salt = Buffer.alloc(8, 1).toString('base64').replace(/=+$/, '')
    const hash = Buffer.alloc(16, 2).toString('base64').replace(/=+$/, '')

    expect(
      loadConfig({
        ...validEnv,
        ADMIN_PASSWORD_HASH: `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${hash}`,
      }).adminPasswordHash,
    ).toContain('m=19456,t=2,p=1')
  })

  it.each(['staging', 'Production', ''])(
    'rejects invalid NODE_ENV %j',
    (nodeEnv) => {
      expect(() => loadConfig({ ...validEnv, NODE_ENV: nodeEnv })).toThrow(
        'NODE_ENV must be one of development, test, production',
      )
    },
  )

  it.each([
    'remote.example.test',
    'ftp://remote.example.test',
    'https://remote.example.test/',
    'https://remote.example.test/path',
    'https://remote.example.test?query=value',
    'https://remote.example.test#fragment',
  ])(
    'rejects ALLOWED_ORIGIN value %j that is not an exact web origin',
    (origin) => {
      expect(() => loadConfig({ ...validEnv, ALLOWED_ORIGIN: origin })).toThrow(
        'ALLOWED_ORIGIN must be an absolute HTTP(S) origin without a path, query, or fragment',
      )
    },
  )

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
