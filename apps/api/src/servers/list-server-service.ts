import { ApiErrorCode, type ServerDto } from '@remote/shared'

import type { AuditRepository } from '../database/audit-repository.js'
import type { ServerRepository } from '../database/server-repository.js'
import { ApplicationError } from '../domain/application-error.js'
import { randomUUID } from 'node:crypto'

export interface ListServerContext {
  actor: string
  sourceIp?: string
}
export interface ListServerServiceDependencies {
  serverRepository: Pick<ServerRepository, 'listAll'>
  auditRepository: Pick<AuditRepository, 'recordFailure' | 'recordSuccess'>
  generateId?: () => string
  now?: () => Date
}

export class ListServerService {
  readonly #generateId: () => string
  readonly #now: () => Date
  constructor(private readonly dependencies: ListServerServiceDependencies) {
    this.#generateId = dependencies.generateId ?? randomUUID
    this.#now = dependencies.now ?? (() => new Date())
  }
  async execute(context: ListServerContext): Promise<ServerDto[]> {
    const source =
      context.sourceIp === undefined ? {} : { sourceIp: context.sourceIp }
    try {
      const servers = this.dependencies.serverRepository.listAll()
      this.dependencies.auditRepository.recordSuccess({
        id: this.#generateId(),
        action: 'server.list',
        result: 'success',
        actor: context.actor,
        targetType: 'server',
        ...source,
        metadata: { resource: 'server', count: servers.length },
        createdAt: this.#now().toISOString(),
      })
      return servers
    } catch (error: unknown) {
      try {
        this.dependencies.auditRepository.recordFailure({
          id: this.#generateId(),
          action: 'server.list',
          result: 'failure',
          actor: context.actor,
          targetType: 'server',
          ...source,
          metadata: { resource: 'server' },
          createdAt: this.#now().toISOString(),
        })
      } catch {
        /* preserve original error */
      }
      throw error instanceof ApplicationError
        ? error
        : new ApplicationError(
            ApiErrorCode.INTERNAL_ERROR,
            500,
            'Internal server error',
          )
    }
  }
}
