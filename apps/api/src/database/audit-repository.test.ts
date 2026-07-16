import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateDatabase, openDatabase } from './database.js'
import { AuditRepository } from './audit-repository.js'

const databases: Database.Database[] = []

function createDatabase(): Database.Database {
  const database = openDatabase(':memory:')
  migrateDatabase(database)
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

describe('AuditRepository', () => {
  it('records successful list metadata and sanitizes invalid counts', () => {
    const database = createDatabase()
    const repository = new AuditRepository(database)
    repository.recordSuccess({
      id: 'audit-success-1',
      action: 'server.list',
      result: 'success',
      actor: 'admin',
      targetType: 'server',
      sourceIp: '127.0.0.1',
      metadata: { resource: 'server', count: 2, password: 'secret' },
      createdAt: '2026-07-12T00:00:00.000Z',
    })
    repository.recordSuccess({
      id: 'audit-success-2',
      action: 'server.list',
      result: 'success',
      actor: 'admin',
      targetType: 'server',
      metadata: { resource: 'server', count: -1 },
      createdAt: '2026-07-12T00:00:01.000Z',
    })
    const rows = database
      .prepare('SELECT metadata FROM audit_logs ORDER BY id')
      .all() as { metadata: string }[]
    expect(JSON.parse(rows[0]?.metadata ?? '{}')).toEqual({
      resource: 'server',
      count: 2,
    })
    expect(JSON.parse(rows[1]?.metadata ?? '{}')).toEqual({
      resource: 'server',
    })
  })
  it('records only allow-listed metadata for a failed create attempt', () => {
    const database = createDatabase()
    const repository = new AuditRepository(database)

    repository.recordFailure({
      id: 'audit-failure-1',
      action: 'server.create',
      result: 'failure',
      actor: 'admin',
      targetType: 'server',
      sourceIp: '127.0.0.1',
      metadata: {
        errorCode: 'SSH_AUTHENTICATION_FAILED',
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'privateKey',
        tofuAccepted: false,
        hostKeyFingerprint: 'SHA256:server',
        password: 'password must not persist',
        privateKey: 'private key must not persist',
        passphrase: 'passphrase must not persist',
        jwt: 'jwt must not persist',
        encryptionKey: 'key must not persist',
        decryptedPayload: 'payload must not persist',
      },
      createdAt: '2026-07-12T00:00:00.000Z',
    })

    const audit = database
      .prepare('SELECT target_id AS targetId, metadata FROM audit_logs')
      .get() as { targetId: string | null; metadata: string }

    expect(audit.targetId).toBeNull()
    expect(JSON.parse(audit.metadata)).toEqual({
      errorCode: 'SSH_AUTHENTICATION_FAILED',
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'privateKey',
      tofuAccepted: false,
      hostKeyFingerprint: 'SHA256:server',
    })
    expect(audit.metadata).not.toMatch(
      /password|private key|passphrase|jwt|key must|payload must/i,
    )
  })

  it('rejects unrecognized error codes rather than retaining raw failure text', () => {
    const database = createDatabase()
    const repository = new AuditRepository(database)

    repository.recordFailure({
      id: 'audit-failure-2',
      action: 'server.create',
      result: 'failure',
      actor: 'admin',
      targetType: 'server',
      metadata: {
        errorCode: 'private key rejected: secret material',
      },
      createdAt: '2026-07-12T00:00:00.000Z',
    })

    const audit = database.prepare('SELECT metadata FROM audit_logs').get() as {
      metadata: string
    }

    expect(JSON.parse(audit.metadata)).toEqual({})
    expect(audit.metadata).not.toContain('private key rejected')
  })
})
