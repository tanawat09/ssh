import { ApiErrorCode, type ServerDto } from '@remote/shared'
import type Database from 'better-sqlite3'

import type { EncryptedCredential } from '../security/credential-cipher.js'
import { ApplicationError } from '../domain/application-error.js'
import { serializeAuditMetadata, type AuditEvent } from './audit-repository.js'

export type { AuditEvent } from './audit-repository.js'

export interface Endpoint {
  host: string
  port: number
  username: string
}

export interface ServerRecord extends ServerDto {
  hostKeyBase64: string
}

export interface ServerConnectionMaterial {
  id: string
  host: string
  port: number
  username: string
  authType: ServerDto['authType']
  hostKeyBase64: string
  encryptedCredential: EncryptedCredential
}

function isEndpointUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const { code, message } = error as {
    code?: unknown
    message?: unknown
  }
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    typeof message === 'string' &&
    message.includes('servers.host, servers.port, servers.username')
  )
}

export class ServerRepository {
  readonly #existsByEndpoint: Database.Statement
  readonly #listAll: Database.Statement
  readonly #getConnectionMaterialById: Database.Statement
  readonly #insertServer: Database.Statement
  readonly #insertCredential: Database.Statement
  readonly #insertSuccessAudit: Database.Statement
  readonly #deleteServer: Database.Statement
  readonly #createWithAuditTransaction: (
    record: ServerRecord,
    encrypted: EncryptedCredential,
    event: AuditEvent,
  ) => void
  readonly #deleteWithAuditTransaction: (
    id: string,
    event: AuditEvent,
  ) => boolean

  constructor(database: Database.Database) {
    this.#existsByEndpoint = database.prepare(`
      SELECT 1
      FROM servers
      WHERE lower(host) = lower(?) AND port = ? AND username = ?
      LIMIT 1
    `)
    this.#listAll = database.prepare(`
      SELECT id, name, host, port, username, auth_type,
        host_key_algorithm, host_key_fingerprint, created_at, updated_at
      FROM servers
      ORDER BY created_at ASC, id ASC
    `)
    this.#getConnectionMaterialById = database.prepare(`
      SELECT s.id, s.host, s.port, s.username, s.auth_type,
        s.host_key_base64, c.encrypted_payload, c.iv, c.auth_tag
      FROM servers s
      INNER JOIN server_credentials c ON c.server_id = s.id
      WHERE s.id = ?
      LIMIT 1
    `)
    this.#insertServer = database.prepare(`
      INSERT INTO servers (
        id, name, host, port, username, auth_type,
        host_key_algorithm, host_key_fingerprint, host_key_base64,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.#insertCredential = database.prepare(`
      INSERT INTO server_credentials (
        server_id, encrypted_payload, iv, auth_tag
      ) VALUES (?, ?, ?, ?)
    `)
    this.#insertSuccessAudit = database.prepare(`
      INSERT INTO audit_logs (
        id, action, result, actor, target_type, target_id, source_ip,
        metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.#deleteServer = database.prepare('DELETE FROM servers WHERE id = ?')
    this.#createWithAuditTransaction = database.transaction(
      (
        record: ServerRecord,
        encrypted: EncryptedCredential,
        event: AuditEvent,
      ) => {
        this.#insertServer.run(
          record.id,
          record.name,
          record.host,
          record.port,
          record.username,
          record.authType,
          record.hostKeyAlgorithm,
          record.hostKeyFingerprint,
          record.hostKeyBase64,
          record.createdAt,
          record.updatedAt,
        )
        this.#insertCredential.run(
          record.id,
          Buffer.from(encrypted.encryptedPayload, 'base64'),
          Buffer.from(encrypted.iv, 'base64'),
          Buffer.from(encrypted.authTag, 'base64'),
        )
        this.#insertSuccessAudit.run(
          event.id,
          event.action,
          event.result,
          event.actor,
          event.targetType,
          event.targetId ?? null,
          event.sourceIp ?? null,
          serializeAuditMetadata(event.metadata),
          event.createdAt,
        )
      },
    )
    this.#deleteWithAuditTransaction = database.transaction(
      (id: string, event: AuditEvent): boolean => {
        const result = this.#deleteServer.run(id)
        if (result.changes === 0) {
          return false
        }
        this.#insertSuccessAudit.run(
          event.id,
          event.action,
          event.result,
          event.actor,
          event.targetType,
          event.targetId ?? null,
          event.sourceIp ?? null,
          serializeAuditMetadata(event.metadata),
          event.createdAt,
        )
        return true
      },
    )
  }

  existsByEndpoint(endpoint: Endpoint): boolean {
    return (
      this.#existsByEndpoint.get(
        endpoint.host,
        endpoint.port,
        endpoint.username,
      ) !== undefined
    )
  }

  listAll(): ServerDto[] {
    const rows = this.#listAll.all() as {
      id: string
      name: string
      host: string
      port: number
      username: string
      auth_type: ServerDto['authType']
      host_key_algorithm: string
      host_key_fingerprint: string
      created_at: string
      updated_at: string
    }[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      hostKeyAlgorithm: row.host_key_algorithm,
      hostKeyFingerprint: row.host_key_fingerprint,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  getConnectionMaterialById(id: string): ServerConnectionMaterial | undefined {
    const row = this.#getConnectionMaterialById.get(id) as
      | {
          id: string
          host: string
          port: number
          username: string
          auth_type: ServerDto['authType']
          host_key_base64: string
          encrypted_payload: Buffer
          iv: Buffer
          auth_tag: Buffer
        }
      | undefined
    if (row === undefined) {
      return undefined
    }

    return {
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      hostKeyBase64: row.host_key_base64,
      encryptedCredential: {
        encryptedPayload: row.encrypted_payload.toString('base64'),
        iv: row.iv.toString('base64'),
        authTag: row.auth_tag.toString('base64'),
      },
    }
  }

  createWithAudit(
    record: ServerRecord,
    encrypted: EncryptedCredential,
    event: AuditEvent,
  ): ServerDto {
    if (event.result !== 'success') {
      throw new Error(
        'ServerRepository.createWithAudit requires a success event',
      )
    }

    try {
      this.#createWithAuditTransaction(record, encrypted, event)
    } catch (error: unknown) {
      if (isEndpointUniqueConstraint(error)) {
        throw new ApplicationError(
          ApiErrorCode.SERVER_ALREADY_EXISTS,
          409,
          'A server already exists for this endpoint',
        )
      }
      throw error
    }

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
  }

  deleteWithAudit(id: string, event: AuditEvent): boolean {
    if (event.result !== 'success') {
      throw new Error(
        'ServerRepository.deleteWithAudit requires a success event',
      )
    }
    return this.#deleteWithAuditTransaction(id, event)
  }
}
