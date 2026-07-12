import { ApiErrorCode } from '@remote/shared'
import type Database from 'better-sqlite3'

export interface AuditEvent {
  id: string
  action: string
  result: 'success' | 'failure'
  actor: string
  targetType: string
  targetId?: string
  sourceIp?: string
  metadata: Readonly<Record<string, unknown>>
  createdAt: string
}

const metadataKeys = [
  'errorCode',
  'host',
  'port',
  'username',
  'authType',
  'tofuAccepted',
  'hostKeyFingerprint',
] as const

type AllowedMetadataKey = (typeof metadataKeys)[number]
type SanitizedAuditMetadata = Partial<
  Record<AllowedMetadataKey, string | number | boolean>
>

const auditErrorCodes: ReadonlySet<string> = new Set(
  Object.values(ApiErrorCode),
)

function hasAllowedMetadataValue(
  key: AllowedMetadataKey,
  value: unknown,
): value is string | number | boolean {
  if (key === 'port') {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65_535
    )
  }

  if (key === 'tofuAccepted') {
    return typeof value === 'boolean'
  }

  if (key === 'errorCode') {
    return typeof value === 'string' && auditErrorCodes.has(value)
  }

  if (key === 'authType') {
    return value === 'password' || value === 'privateKey'
  }

  if (key === 'hostKeyFingerprint') {
    return typeof value === 'string' && value.length >= 1 && value.length <= 512
  }

  return typeof value === 'string'
}

export function serializeAuditMetadata(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const sanitized: SanitizedAuditMetadata = {}
  for (const key of metadataKeys) {
    const value = metadata[key]
    if (hasAllowedMetadataValue(key, value)) {
      sanitized[key] = value
    }
  }
  return JSON.stringify(sanitized)
}

export class AuditRepository {
  readonly #insertFailure: Database.Statement

  constructor(database: Database.Database) {
    this.#insertFailure = database.prepare(`
      INSERT INTO audit_logs (
        id, action, result, actor, target_type, target_id, source_ip,
        metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  }

  recordFailure(event: AuditEvent): void {
    if (event.result !== 'failure') {
      throw new Error('AuditRepository.recordFailure requires a failure event')
    }

    this.#insertFailure.run(
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
  }
}
