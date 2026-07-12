import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { AppConfig } from '../config.js'

export type ServerCredential =
  | {
      authType: 'password'
      password: string
    }
  | {
      authType: 'privateKey'
      privateKey: string
      passphrase?: string
    }

export interface EncryptedCredential {
  encryptedPayload: string
  iv: string
  authTag: string
}

const keyLength = 32
const ivLength = 12
const authTagLength = 16

function decodeBase64(value: string, field: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new Error(`${field} must be valid Base64`)
  }
  return decoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function isServerCredential(value: unknown): value is ServerCredential {
  if (!isRecord(value)) {
    return false
  }

  if (value.authType === 'password') {
    return (
      hasExactKeys(value, ['authType', 'password']) &&
      typeof value.password === 'string'
    )
  }

  if (value.authType === 'privateKey') {
    const expectedKeys =
      value.passphrase === undefined
        ? ['authType', 'privateKey']
        : ['authType', 'passphrase', 'privateKey']
    return (
      hasExactKeys(value, expectedKeys) &&
      typeof value.privateKey === 'string' &&
      (value.passphrase === undefined || typeof value.passphrase === 'string')
    )
  }

  return false
}

export class CredentialCipher {
  readonly #key: Buffer

  constructor(credentialEncryptionKey: AppConfig['credentialEncryptionKey']) {
    if (credentialEncryptionKey.length !== keyLength) {
      throw new Error('Credential encryption key must be exactly 32 bytes')
    }
    this.#key = Buffer.from(credentialEncryptionKey)
  }

  encrypt(credential: ServerCredential): EncryptedCredential {
    const iv = randomBytes(ivLength)
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv)
    const encryptedPayload = Buffer.concat([
      cipher.update(JSON.stringify(credential), 'utf8'),
      cipher.final(),
    ])

    return {
      encryptedPayload: encryptedPayload.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    }
  }

  decrypt(value: EncryptedCredential): ServerCredential {
    const encryptedPayload = decodeBase64(
      value.encryptedPayload,
      'Encrypted payload',
    )
    const iv = decodeBase64(value.iv, 'IV')
    const authTag = decodeBase64(value.authTag, 'Authentication tag')
    if (iv.length !== ivLength) {
      throw new Error('IV must be exactly 12 bytes')
    }
    if (authTag.length !== authTagLength) {
      throw new Error('Authentication tag must be exactly 16 bytes')
    }

    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([
      decipher.update(encryptedPayload),
      decipher.final(),
    ])
    const credential: unknown = JSON.parse(decrypted.toString('utf8'))
    if (!isServerCredential(credential)) {
      throw new Error('Decrypted credential has an invalid shape')
    }
    return credential
  }
}
