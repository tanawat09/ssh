import { FormatRegistry } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'

import { ApiErrorSchema } from './api-error.js'
import { LoginRequestSchema, SessionDtoSchema } from './auth-contract.js'
import {
  CreateServerRequestSchema,
  ServerDtoSchema,
} from './server-contract.js'

FormatRegistry.Set('date-time', (value) => {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))
})

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

  it('enforces the approved string bounds', () => {
    expect(
      check.Check({
        name: 'n'.repeat(101),
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        password: 'secret',
      }),
    ).toBe(false)
    expect(
      check.Check({
        name: 'Production',
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'privateKey',
        privateKey: 'pem',
        passphrase: '',
      }),
    ).toBe(true)
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
})
