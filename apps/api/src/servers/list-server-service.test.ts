import { ApiErrorCode, type ServerDto } from '@remote/shared'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../domain/application-error.js'
import { ListServerService } from './list-server-service.js'

const servers: ServerDto[] = [
  {
    id: 'server-1',
    name: 'Production',
    host: 'example.test',
    port: 22,
    username: 'deploy',
    authType: 'password',
    hostKeyAlgorithm: 'ssh-ed25519',
    hostKeyFingerprint: 'SHA256:fingerprint',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  },
]

describe('ListServerService', () => {
  it('returns repository servers and records count/source audit', () => {
    const recordSuccess = vi.fn()
    const service = new ListServerService({
      serverRepository: { listAll: vi.fn(() => servers) },
      auditRepository: { recordSuccess, recordFailure: vi.fn() },
      generateId: () => 'audit-1',
      now: () => new Date('2026-07-12T01:00:00.000Z'),
    })
    expect(service.execute({ actor: 'admin', sourceIp: '127.0.0.1' })).toEqual(
      servers,
    )
    expect(recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'audit-1',
        action: 'server.list',
        result: 'success',
        actor: 'admin',
        sourceIp: '127.0.0.1',
        metadata: { resource: 'server', count: 1 },
        createdAt: '2026-07-12T01:00:00.000Z',
      }),
    )
  })

  it('records failure and maps unexpected repository errors', () => {
    const recordFailure = vi.fn()
    const service = new ListServerService({
      serverRepository: {
        listAll: vi.fn(() => {
          throw new Error('SQLITE secret')
        }),
      },
      auditRepository: { recordSuccess: vi.fn(), recordFailure },
      generateId: () => 'audit-2',
      now: () => new Date('2026-07-12T01:00:00.000Z'),
    })
    expect(() => service.execute({ actor: 'admin' })).toThrow(
      new ApplicationError(
        ApiErrorCode.INTERNAL_ERROR,
        500,
        'Internal server error',
      ),
    )
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'server.list',
        result: 'failure',
        metadata: { resource: 'server' },
      }),
    )
  })

  it('preserves application errors and original error when failure audit fails', () => {
    const error = new ApplicationError(ApiErrorCode.INTERNAL_ERROR, 500, 'safe')
    const service = new ListServerService({
      serverRepository: {
        listAll: vi.fn(() => {
          throw error
        }),
      },
      auditRepository: {
        recordSuccess: vi.fn(),
        recordFailure: vi.fn(() => {
          throw new Error('audit')
        }),
      },
    })
    expect(() => service.execute({ actor: 'admin' })).toThrow(error)
  })
})
