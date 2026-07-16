import { ApiErrorCode, type CreateServerRequest } from '@remote/shared'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../domain/application-error.js'
import type { AuditEvent, ServerRecord } from '../database/server-repository.js'
import { CreateServerService } from './create-server-service.js'

const passwordRequest: CreateServerRequest = {
  name: '  Production  ',
  host: '  SERVER.Example.COM  ',
  port: 22,
  username: '  Deploy  ',
  authType: 'password',
  password: 'secret',
}
const privateKeyRequest: CreateServerRequest = {
  ...passwordRequest,
  authType: 'privateKey',
  privateKey: 'private-key-secret',
  passphrase: 'passphrase-secret',
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const order: string[] = []
  const serverRepository = {
    existsByEndpoint: vi.fn(() => {
      order.push('duplicate')
      return false
    }),
    createWithAudit: vi.fn((record: ServerRecord) => {
      order.push('create')
      return {
        id: record.id,
        name: record.name,
        host: record.host,
        port: record.port,
        username: record.username,
        authType: record.authType,
        hostKeyAlgorithm: record.hostKeyAlgorithm,
        hostKeyFingerprint: record.hostKeyFingerprint,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }
    }),
  }
  const auditRepository = {
    recordFailure: vi.fn<(event: AuditEvent) => void>(),
  }
  const sshGateway = {
    testConnection: vi.fn(() => {
      order.push('ssh')
      return Promise.resolve({
        algorithm: 'ssh-ed25519',
        fingerprint: 'SHA256:fingerprint',
        keyBase64: 'a2V5',
      })
    }),
  }
  const credentialCipher = {
    encrypt: vi.fn(() => {
      order.push('encrypt')
      return { encryptedPayload: 'enc', iv: 'iv', authTag: 'tag' }
    }),
  }
  return {
    order,
    serverRepository,
    auditRepository,
    sshGateway,
    credentialCipher,
    ...overrides,
  }
}

function service(deps = dependencies()) {
  return {
    deps,
    service: new CreateServerService({
      ...deps,
      sshConnectTimeoutMs: 10_000,
      generateId: vi
        .fn()
        .mockReturnValueOnce('server-id')
        .mockReturnValueOnce('audit-id'),
      now: () => new Date('2026-07-12T00:00:00.000Z'),
    }),
  }
}

describe('CreateServerService', () => {
  it('normalizes before duplicate, SSH, encryption, and atomic creation', async () => {
    const { service: subject, deps } = service()

    const result = await subject.execute(passwordRequest, {
      actor: 'admin',
      sourceIp: '127.0.0.1',
    })

    expect(deps.order).toEqual(['duplicate', 'ssh', 'encrypt', 'create'])
    expect(deps.serverRepository.existsByEndpoint).toHaveBeenCalledWith({
      host: 'server.example.com',
      port: 22,
      username: 'Deploy',
    })
    expect(deps.sshGateway.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Production',
        host: 'server.example.com',
        username: 'Deploy',
      }),
      10_000,
    )
    expect(deps.credentialCipher.encrypt).toHaveBeenCalledWith({
      authType: 'password',
      password: 'secret',
    })
    expect(result).not.toHaveProperty('password')
    expect(result).not.toHaveProperty('hostKeyBase64')
    expect(result).not.toHaveProperty('encryptedPayload')
  })

  it('rejects duplicate endpoints without SSH and audits sanitized metadata', async () => {
    const deps = dependencies()
    deps.serverRepository.existsByEndpoint.mockReturnValue(true)
    const subject = service(deps).service

    await expect(
      subject.execute(passwordRequest, {
        actor: 'admin',
        sourceIp: 'secret-ip',
      }),
    ).rejects.toMatchObject({
      code: ApiErrorCode.SERVER_ALREADY_EXISTS,
      statusCode: 409,
    })

    expect(deps.sshGateway.testConnection).not.toHaveBeenCalled()
    expect(deps.credentialCipher.encrypt).not.toHaveBeenCalled()
    expect(deps.serverRepository.createWithAudit).not.toHaveBeenCalled()
    expect(deps.auditRepository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failure',
        metadata: {
          host: 'server.example.com',
          port: 22,
          username: 'Deploy',
          authType: 'password',
          errorCode: ApiErrorCode.SERVER_ALREADY_EXISTS,
          tofuAccepted: false,
        },
      }),
    )
    const event = deps.auditRepository.recordFailure.mock.calls[0]?.[0]
    expect(JSON.stringify(event?.metadata)).not.toContain('secret')
  })

  it('forwards a private key and passphrase only to SSH and credential encryption', async () => {
    const { service: subject, deps } = service()

    await subject.execute(privateKeyRequest, { actor: 'admin' })

    expect(deps.credentialCipher.encrypt).toHaveBeenCalledWith({
      authType: 'privateKey',
      privateKey: 'private-key-secret',
      passphrase: 'passphrase-secret',
    })
    expect(
      JSON.stringify(deps.serverRepository.createWithAudit.mock.calls),
    ).not.toMatch(/private-key-secret|passphrase-secret/)
  })

  it.each([
    [
      'encryption',
      (deps: ReturnType<typeof dependencies>) => {
        deps.credentialCipher.encrypt.mockImplementation(() => {
          throw new Error('cipher leaked private-key-secret')
        })
      },
    ],
    [
      'persistence',
      (deps: ReturnType<typeof dependencies>) => {
        deps.serverRepository.createWithAudit.mockImplementation(() => {
          throw new Error('SQLITE leaked passphrase-secret')
        })
      },
    ],
  ] as const)(
    'sanitizes an unexpected %s failure and records only stable audit metadata',
    async (_stage, fail) => {
      const deps = dependencies()
      fail(deps)
      const subject = service(deps).service

      await expect(
        subject.execute(privateKeyRequest, {
          actor: 'admin',
          sourceIp: '198.51.100.5',
        }),
      ).rejects.toMatchObject({
        code: ApiErrorCode.INTERNAL_ERROR,
        statusCode: 500,
        message: 'Internal server error',
      })
      const event = deps.auditRepository.recordFailure.mock.calls[0]?.[0]
      expect(event).toMatchObject({
        sourceIp: '198.51.100.5',
        metadata: {
          host: 'server.example.com',
          port: 22,
          username: 'Deploy',
          authType: 'privateKey',
          errorCode: ApiErrorCode.INTERNAL_ERROR,
          tofuAccepted: true,
          hostKeyFingerprint: 'SHA256:fingerprint',
        },
      })
      expect(JSON.stringify(event)).not.toMatch(
        /private-key-secret|passphrase-secret|cipher leaked|SQLITE leaked/,
      )
    },
  )

  it.each([
    ApiErrorCode.SSH_AUTHENTICATION_FAILED,
    ApiErrorCode.SSH_CONNECTION_FAILED,
    ApiErrorCode.SSH_TIMEOUT,
  ])(
    'does not encrypt or create after %s and records failure',
    async (code) => {
      const deps = dependencies()
      deps.sshGateway.testConnection.mockRejectedValue(
        new ApplicationError(
          code,
          code === ApiErrorCode.SSH_TIMEOUT ? 504 : 422,
          'safe',
        ),
      )
      const subject = service(deps).service

      await expect(
        subject.execute(passwordRequest, { actor: 'admin' }),
      ).rejects.toMatchObject({ code })
      expect(deps.credentialCipher.encrypt).not.toHaveBeenCalled()
      expect(deps.serverRepository.createWithAudit).not.toHaveBeenCalled()
      expect(deps.auditRepository.recordFailure).toHaveBeenCalledOnce()
    },
  )

  it('validates normalized DNS/IP hosts before dependency calls', async () => {
    const { service: subject, deps } = service()

    await expect(
      subject.execute(
        { ...passwordRequest, host: '-invalid.example' },
        { actor: 'admin' },
      ),
    ).rejects.toMatchObject({
      code: ApiErrorCode.INVALID_REQUEST,
      statusCode: 400,
    })
    expect(deps.serverRepository.existsByEndpoint).not.toHaveBeenCalled()
    expect(deps.auditRepository.recordFailure).toHaveBeenCalledOnce()
  })
})
