import { createCipheriv } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  CredentialCipher,
  type EncryptedCredential,
} from './credential-cipher.js'

const encryptionKey = Buffer.alloc(32, 7)

function mutateBase64(value: string): string {
  const bytes = Buffer.from(value, 'base64')
  bytes[0] = (bytes[0] ?? 0) ^ 1
  return bytes.toString('base64')
}

function encryptJson(value: unknown): EncryptedCredential {
  const iv = Buffer.alloc(12, 3)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])

  return {
    encryptedPayload: encryptedPayload.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

describe('CredentialCipher', () => {
  it('round trips a password credential into Base64 database fields', () => {
    const cipher = new CredentialCipher(encryptionKey)
    const encrypted = cipher.encrypt({
      authType: 'password',
      password: 'secret',
    })

    expect(
      Buffer.from(encrypted.encryptedPayload, 'base64').length,
    ).toBeGreaterThan(0)
    expect(Buffer.from(encrypted.iv, 'base64')).toHaveLength(12)
    expect(Buffer.from(encrypted.authTag, 'base64')).toHaveLength(16)
    expect(cipher.decrypt(encrypted)).toEqual({
      authType: 'password',
      password: 'secret',
    })
  })

  it('round trips a private-key credential with an optional passphrase', () => {
    const cipher = new CredentialCipher(encryptionKey)
    const credential = {
      authType: 'privateKey',
      privateKey: '-----BEGIN PRIVATE KEY-----',
      passphrase: 'key-secret',
    } as const

    expect(cipher.decrypt(cipher.encrypt(credential))).toEqual(credential)
    expect(
      cipher.decrypt(
        cipher.encrypt({ authType: 'privateKey', privateKey: 'private-key' }),
      ),
    ).toEqual({ authType: 'privateKey', privateKey: 'private-key' })
  })

  it('uses a fresh IV for every encryption of the same credential', () => {
    const cipher = new CredentialCipher(encryptionKey)
    const credential = { authType: 'password', password: 'secret' } as const

    const first = cipher.encrypt(credential)
    const second = cipher.encrypt(credential)

    expect(first.iv).not.toBe(second.iv)
    expect(first.encryptedPayload).not.toBe(second.encryptedPayload)
  })

  it('rejects ciphertext modified after encryption', () => {
    const cipher = new CredentialCipher(encryptionKey)
    const encrypted = cipher.encrypt({
      authType: 'password',
      password: 'secret',
    })

    expect(() =>
      cipher.decrypt({
        ...encrypted,
        encryptedPayload: mutateBase64(encrypted.encryptedPayload),
      }),
    ).toThrow()
  })

  it('rejects an authentication tag modified after encryption', () => {
    const cipher = new CredentialCipher(encryptionKey)
    const encrypted = cipher.encrypt({
      authType: 'password',
      password: 'secret',
    })

    expect(() =>
      cipher.decrypt({
        ...encrypted,
        authTag: mutateBase64(encrypted.authTag),
      }),
    ).toThrow()
  })

  it.each([
    ['encryptedPayload', 'Encrypted payload'],
    ['iv', 'IV'],
    ['authTag', 'Authentication tag'],
  ] as const)('rejects invalid Base64 in %s', (field, fieldLabel) => {
    const cipher = new CredentialCipher(encryptionKey)
    const encrypted = cipher.encrypt({
      authType: 'password',
      password: 'secret',
    })

    expect(() => cipher.decrypt({ ...encrypted, [field]: '*' })).toThrow(
      `${fieldLabel} must be valid Base64`,
    )
  })

  it.each([
    ['encryptedPayload', 'Encrypted payload'],
    ['iv', 'IV'],
    ['authTag', 'Authentication tag'],
  ] as const)('rejects noncanonical Base64 in %s', (field, fieldLabel) => {
    const cipher = new CredentialCipher(encryptionKey)
    const encrypted = cipher.encrypt({
      authType: 'password',
      password: 'secret',
    })

    expect(() =>
      cipher.decrypt({ ...encrypted, [field]: `${encrypted[field]}=` }),
    ).toThrow(`${fieldLabel} must be valid Base64`)
  })

  it.each([
    ['iv', 11, 'IV must be exactly 12 bytes'],
    ['authTag', 15, 'Authentication tag must be exactly 16 bytes'],
  ] as const)(
    'rejects an incorrect decoded %s length',
    (field, length, expectedMessage) => {
      const cipher = new CredentialCipher(encryptionKey)
      const encrypted = cipher.encrypt({
        authType: 'password',
        password: 'secret',
      })

      expect(() =>
        cipher.decrypt({
          ...encrypted,
          [field]: Buffer.alloc(length).toString('base64'),
        }),
      ).toThrow(expectedMessage)
    },
  )

  it('rejects encryption keys that are not exactly 32 bytes', () => {
    expect(() => new CredentialCipher(Buffer.alloc(31))).toThrow(
      'Credential encryption key must be exactly 32 bytes',
    )
    expect(() => new CredentialCipher(Buffer.alloc(33))).toThrow(
      'Credential encryption key must be exactly 32 bytes',
    )
  })

  it.each([
    { authType: 'password', password: 'secret', host: 'server.example.test' },
    { authType: 'password' },
    { authType: 'password', password: 123 },
    { authType: 'privateKey', privateKey: 'key', password: 'secret' },
    { authType: 'privateKey', privateKey: 'key', passphrase: 123 },
    { authType: 'agent', token: 'secret' },
    null,
  ])(
    'rejects authenticated JSON that is not an exact credential shape',
    (value) => {
      const cipher = new CredentialCipher(encryptionKey)

      expect(() => cipher.decrypt(encryptJson(value))).toThrow(
        'Decrypted credential has an invalid shape',
      )
    },
  )
})
