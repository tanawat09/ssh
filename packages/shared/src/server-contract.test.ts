import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'

import {
  ApiErrorCode,
  ApiErrorSchema,
  CreateServerRequestSchema,
  LoginRequestSchema,
  ServerDtoSchema,
  SessionDtoSchema,
} from './index.js'

describe('CreateServerRequestSchema', () => {
  const check = TypeCompiler.Compile(CreateServerRequestSchema)

  it('accepts password authentication', () => {
    expect(
      check.Check({
        name: 'Production',
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        password: 'secret',
      }),
    ).toBe(true)
  })

  it('accepts private-key authentication', () => {
    expect(
      check.Check({
        name: 'Production',
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'privateKey',
        privateKey: 'pem',
        passphrase: 'secret',
      }),
    ).toBe(true)
  })

  it('rejects a port outside the valid TCP range', () => {
    expect(
      check.Check({
        name: 'Production',
        host: 'server.example.com',
        port: 0,
        username: 'deploy',
        authType: 'password',
        password: 'secret',
      }),
    ).toBe(false)
  })

  it('rejects credentials for a different authentication variant', () => {
    expect(
      check.Check({
        name: 'Production',
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        privateKey: 'pem',
      }),
    ).toBe(false)
  })

  it('enforces every approved maximum string boundary', () => {
    const passwordRequest = {
      name: 'n'.repeat(100),
      host: 'h'.repeat(253),
      port: 22,
      username: 'u'.repeat(64),
      authType: 'password',
      password: 'p'.repeat(1_024),
    }
    const privateKeyRequest = {
      name: 'Production',
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'privateKey',
      privateKey: 'k'.repeat(65_536),
      passphrase: 'p'.repeat(1_024),
    }

    expect(check.Check(passwordRequest)).toBe(true)
    expect(check.Check({ ...passwordRequest, name: 'n'.repeat(101) })).toBe(
      false,
    )
    expect(check.Check({ ...passwordRequest, host: 'h'.repeat(254) })).toBe(
      false,
    )
    expect(check.Check({ ...passwordRequest, username: 'u'.repeat(65) })).toBe(
      false,
    )
    expect(
      check.Check({ ...passwordRequest, password: 'p'.repeat(1_025) }),
    ).toBe(false)
    expect(check.Check(privateKeyRequest)).toBe(true)
    expect(
      check.Check({ ...privateKeyRequest, privateKey: 'k'.repeat(65_537) }),
    ).toBe(false)
    expect(
      check.Check({ ...privateKeyRequest, passphrase: 'p'.repeat(1_025) }),
    ).toBe(false)
    expect(check.Check({ ...privateKeyRequest, passphrase: '' })).toBe(true)
  })
})

describe('public response schemas', () => {
  it('validates the approved login and session shapes', () => {
    const loginCheck = TypeCompiler.Compile(LoginRequestSchema)
    const sessionCheck = TypeCompiler.Compile(SessionDtoSchema)

    expect(loginCheck.Check({ username: 'admin', password: 'secret' })).toBe(
      true,
    )
    expect(
      sessionCheck.Check({ user: { username: 'admin', role: 'admin' } }),
    ).toBe(true)
    expect(
      sessionCheck.Check({
        user: { username: 'admin', role: 'admin', token: 'secret' },
      }),
    ).toBe(false)
  })

  it('validates credential-free server DTOs with ISO timestamps', () => {
    const serverCheck = TypeCompiler.Compile(ServerDtoSchema)
    const server = {
      id: 'server-id',
      name: 'Production',
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password',
      hostKeyAlgorithm: 'ssh-ed25519',
      hostKeyFingerprint: 'SHA256:fingerprint',
      createdAt: '2026-07-12T03:00:00.000Z',
      updatedAt: '2026-07-12T03:00:00.000Z',
    }

    expect(serverCheck.Check(server)).toBe(true)
    expect(serverCheck.Check({ ...server, password: 'secret' })).toBe(false)
    expect(serverCheck.Check({ ...server, createdAt: 'not-a-date' })).toBe(
      false,
    )
  })

  it('validates stable API errors and rejects unapproved envelope fields', () => {
    const errorCheck = TypeCompiler.Compile(ApiErrorSchema)

    expect(
      errorCheck.Check({
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request is invalid',
          fields: { host: 'Enter a valid host' },
        },
      }),
    ).toBe(true)
    expect(
      errorCheck.Check({
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request is invalid',
          submittedValues: { password: 'secret' },
        },
      }),
    ).toBe(false)
  })

  it('exposes exactly the approved API error codes and rejects unknown codes', () => {
    const errorCheck = TypeCompiler.Compile(ApiErrorSchema)

    expect(Object.values(ApiErrorCode).sort()).toEqual(
      [
        'INVALID_REQUEST',
        'UNAUTHENTICATED',
        'FORBIDDEN',
        'SERVER_ALREADY_EXISTS',
        'SERVER_NOT_FOUND',
        'TERMINAL_ALREADY_ACTIVE',
        'TERMINAL_SESSION_LIMIT',
        'TERMINAL_PROTOCOL_ERROR',
        'SSH_AUTHENTICATION_FAILED',
        'SSH_CONNECTION_FAILED',
        'SSH_HOST_KEY_MISMATCH',
        'SSH_TIMEOUT',
        'INTERNAL_ERROR',
      ].sort(),
    )
    expect(
      errorCheck.Check({
        error: { code: 'UNKNOWN_ERROR', message: 'Unknown error' },
      }),
    ).toBe(false)
  })
})
