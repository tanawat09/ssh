import { randomUUID } from 'node:crypto'

import { ApiErrorCode } from '@remote/shared'

import type { AuditRepository } from '../database/audit-repository.js'
import type { ServerRepository } from '../database/server-repository.js'
import { ApplicationError } from '../domain/application-error.js'
import type { TerminalSessionManager } from '../terminal/terminal-session-manager.js'

export interface DeleteServerContext {
  actor: string
  sourceIp?: string
}

export interface DeleteServerServiceDependencies {
  serverRepository: Pick<ServerRepository, 'deleteWithAudit'>
  auditRepository: Pick<AuditRepository, 'recordFailure'>
  sessionManager: Pick<TerminalSessionManager, 'isServerActive'>
  generateId?: () => string
  now?: () => Date
}

function toApplicationError(error: unknown): ApplicationError {
  return error instanceof ApplicationError
    ? error
    : new ApplicationError(
        ApiErrorCode.INTERNAL_ERROR,
        500,
        'Internal server error',
      )
}

export class DeleteServerService {
  readonly #generateId: () => string
  readonly #now: () => Date

  constructor(private readonly dependencies: DeleteServerServiceDependencies) {
    this.#generateId = dependencies.generateId ?? randomUUID
    this.#now = dependencies.now ?? (() => new Date())
  }

  execute(serverId: string, context: DeleteServerContext): void {
    const source =
      context.sourceIp === undefined ? {} : { sourceIp: context.sourceIp }

    try {
      if (this.dependencies.sessionManager.isServerActive(serverId)) {
        throw new ApplicationError(
          ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
          409,
          'Disconnect the active terminal before deleting this server',
        )
      }

      const deleted = this.dependencies.serverRepository.deleteWithAudit(
        serverId,
        {
          id: this.#generateId(),
          action: 'server.delete',
          result: 'success',
          actor: context.actor,
          targetType: 'server',
          targetId: serverId,
          ...source,
          metadata: { resource: 'server' },
          createdAt: this.#now().toISOString(),
        },
      )
      if (!deleted) {
        throw new ApplicationError(
          ApiErrorCode.SERVER_NOT_FOUND,
          404,
          'Server not found',
        )
      }
    } catch (error: unknown) {
      const applicationError = toApplicationError(error)
      try {
        this.dependencies.auditRepository.recordFailure({
          id: this.#generateId(),
          action: 'server.delete',
          result: 'failure',
          actor: context.actor,
          targetType: 'server',
          targetId: serverId,
          ...source,
          metadata: {
            resource: 'server',
            errorCode: applicationError.code,
          },
          createdAt: this.#now().toISOString(),
        })
      } catch {
        // Preserve the stable original failure when audit persistence also fails.
      }
      throw applicationError
    }
  }
}
