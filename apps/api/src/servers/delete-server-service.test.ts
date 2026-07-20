import { ApiErrorCode } from '@remote/shared'
import { describe, expect, it, vi } from 'vitest'

import type { AuditEvent } from '../database/audit-repository.js'
import { ApplicationError } from '../domain/application-error.js'
import { DeleteServerService } from './delete-server-service.js'

const context = { actor: 'admin', sourceIp: '198.51.100.5' }

function dependencies() {
  return {
    serverRepository: {
      deleteWithAudit: vi.fn<(id: string, event: AuditEvent) => boolean>(
        () => true,
      ),
    },
    auditRepository: {
      recordFailure: vi.fn<(event: AuditEvent) => void>(),
    },
    sessionManager: {
      isServerActive: vi.fn<(serverId: string) => boolean>(() => false),
    },
  }
}

function service(deps = dependencies()) {
  return {
    deps,
    service: new DeleteServerService({
      ...deps,
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce('success-audit-id')
        .mockReturnValueOnce('failure-audit-id'),
      now: () => new Date('2026-07-18T00:00:00.000Z'),
    }),
  }
}

describe('DeleteServerService', () => {
  it('rejects an active server before persistence and records a sanitized failure', () => {
    const deps = dependencies()
    deps.sessionManager.isServerActive.mockReturnValue(true)
    const subject = service(deps).service

    expect(() => {
      subject.execute('server-1', context)
    }).toThrow(
      expect.objectContaining({
        code: ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
        statusCode: 409,
      }),
    )

    expect(deps.sessionManager.isServerActive).toHaveBeenCalledWith('server-1')
    expect(deps.serverRepository.deleteWithAudit).not.toHaveBeenCalled()
    expect(deps.auditRepository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'server.delete',
        result: 'failure',
        actor: 'admin',
        targetType: 'server',
        targetId: 'server-1',
        sourceIp: '198.51.100.5',
        metadata: {
          resource: 'server',
          errorCode: ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
        },
        createdAt: '2026-07-18T00:00:00.000Z',
      }),
    )
  })

  it('deletes through the atomic repository method with a success audit event', () => {
    const { service: subject, deps } = service()

    expect(() => {
      subject.execute('server-1', context)
    }).not.toThrow()

    expect(deps.serverRepository.deleteWithAudit).toHaveBeenCalledWith(
      'server-1',
      {
        id: 'success-audit-id',
        action: 'server.delete',
        result: 'success',
        actor: 'admin',
        targetType: 'server',
        targetId: 'server-1',
        sourceIp: '198.51.100.5',
        metadata: { resource: 'server' },
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    )
    expect(deps.auditRepository.recordFailure).not.toHaveBeenCalled()
  })

  it('maps a missing server to SERVER_NOT_FOUND and records the failure', () => {
    const deps = dependencies()
    deps.serverRepository.deleteWithAudit.mockReturnValue(false)
    const subject = service(deps).service

    expect(() => {
      subject.execute('missing-server', { actor: 'admin' })
    }).toThrow(
      expect.objectContaining({
        code: ApiErrorCode.SERVER_NOT_FOUND,
        statusCode: 404,
      }),
    )

    expect(deps.auditRepository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'missing-server',
        metadata: {
          resource: 'server',
          errorCode: ApiErrorCode.SERVER_NOT_FOUND,
        },
      }),
    )
  })

  it('maps repository failures to INTERNAL_ERROR without leaking details', () => {
    const deps = dependencies()
    deps.serverRepository.deleteWithAudit.mockImplementation(() => {
      throw new Error('SQLITE secret detail')
    })
    const subject = service(deps).service

    expect(() => {
      subject.execute('server-1', context)
    }).toThrow(
      expect.objectContaining({
        code: ApiErrorCode.INTERNAL_ERROR,
        statusCode: 500,
        message: 'Internal server error',
      }),
    )

    const event = deps.auditRepository.recordFailure.mock.calls[0]?.[0]
    expect(event?.metadata).toEqual({
      resource: 'server',
      errorCode: ApiErrorCode.INTERNAL_ERROR,
    })
    expect(JSON.stringify(event)).not.toContain('SQLITE secret detail')
  })

  it.each(['session manager', 'repository'] as const)(
    'normalizes an ApplicationError thrown by the %s boundary',
    (dependency) => {
      const deps = dependencies()
      const boundaryError = new ApplicationError(
        ApiErrorCode.FORBIDDEN,
        403,
        'dependency secret detail',
      )
      if (dependency === 'session manager') {
        deps.sessionManager.isServerActive.mockImplementation(() => {
          throw boundaryError
        })
      } else {
        deps.serverRepository.deleteWithAudit.mockImplementation(() => {
          throw boundaryError
        })
      }
      const subject = service(deps).service

      expect(() => {
        subject.execute('server-1', context)
      }).toThrow(
        expect.objectContaining({
          code: ApiErrorCode.INTERNAL_ERROR,
          statusCode: 500,
          message: 'Internal server error',
        }),
      )

      const event = deps.auditRepository.recordFailure.mock.calls[0]?.[0]
      expect(event?.metadata).toEqual({
        resource: 'server',
        errorCode: ApiErrorCode.INTERNAL_ERROR,
      })
      expect(JSON.stringify(event)).not.toContain('dependency secret detail')
    },
  )

  it('preserves the primary stable error when failure auditing also fails', () => {
    const deps = dependencies()
    deps.serverRepository.deleteWithAudit.mockReturnValue(false)
    deps.auditRepository.recordFailure.mockImplementation(() => {
      throw new Error('audit unavailable')
    })
    const subject = service(deps).service

    expect(() => {
      subject.execute('missing-server', context)
    }).toThrow(
      expect.objectContaining({
        code: ApiErrorCode.SERVER_NOT_FOUND,
        statusCode: 404,
      }),
    )
    expect(deps.auditRepository.recordFailure).toHaveBeenCalledOnce()
  })
})
