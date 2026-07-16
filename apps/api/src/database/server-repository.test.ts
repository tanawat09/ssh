import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { ApplicationError } from '../domain/application-error.js'
import { migrateDatabase, openDatabase } from './database.js'
import {
  ServerRepository,
  type AuditEvent,
  type ServerRecord,
} from './server-repository.js'

const databases: Database.Database[] = []

function createDatabase(): Database.Database {
  const database = openDatabase(':memory:')
  migrateDatabase(database)
  databases.push(database)
  return database
}

function serverRecord(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 'server-1',
    name: 'Production',
    host: 'server.example.com',
    port: 22,
    username: 'deploy',
    authType: 'password',
    hostKeyAlgorithm: 'ssh-ed25519',
    hostKeyFingerprint: 'SHA256:server',
    hostKeyBase64: 'c2VydmVyLWtleQ==',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  }
}

function successEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'audit-1',
    action: 'server.create',
    result: 'success',
    actor: 'admin',
    targetType: 'server',
    targetId: 'server-1',
    sourceIp: '127.0.0.1',
    metadata: {
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password',
      tofuAccepted: true,
    },
    createdAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  }
}

const encryptedCredential = {
  encryptedPayload: 'ZW5jcnlwdGVk',
  iv: 'aXZpdml2aXZpdml2',
  authTag: 'YXV0aHRhZ2F1dGh0YWc=',
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

describe('ServerRepository', () => {
  it('uses the normalized endpoint tuple for existence checks', () => {
    const database = createDatabase()
    const repository = new ServerRepository(database)

    expect(
      repository.existsByEndpoint({
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
      }),
    ).toBe(false)

    repository.createWithAudit(
      serverRecord(),
      encryptedCredential,
      successEvent(),
    )

    expect(
      repository.existsByEndpoint({
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
      }),
    ).toBe(true)
    expect(
      repository.existsByEndpoint({
        host: 'SERVER.EXAMPLE.COM',
        port: 22,
        username: 'deploy',
      }),
    ).toBe(true)
    expect(
      repository.existsByEndpoint({
        host: 'server.example.com',
        port: 2222,
        username: 'deploy',
      }),
    ).toBe(false)
    expect(
      repository.existsByEndpoint({
        host: 'server.example.com',
        port: 22,
        username: 'Deploy',
      }),
    ).toBe(false)
  })

  it('lists public servers in creation order without secrets', () => {
    const database = createDatabase()
    const repository = new ServerRepository(database)
    repository.createWithAudit(
      serverRecord(),
      encryptedCredential,
      successEvent(),
    )
    repository.createWithAudit(
      serverRecord({
        id: 'server-2',
        name: 'Staging',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        host: 'staging.example.com',
      }),
      encryptedCredential,
      successEvent({ id: 'audit-2', targetId: 'server-2' }),
    )
    repository.createWithAudit(
      serverRecord({
        id: 'server-0',
        name: 'Development',
        host: 'dev.example.com',
      }),
      encryptedCredential,
      successEvent({ id: 'audit-0', targetId: 'server-0' }),
    )
    expect(repository.listAll()).toEqual([
      {
        id: 'server-0',
        name: 'Development',
        host: 'dev.example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        hostKeyAlgorithm: 'ssh-ed25519',
        hostKeyFingerprint: 'SHA256:server',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      {
        id: 'server-1',
        name: 'Production',
        host: 'server.example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        hostKeyAlgorithm: 'ssh-ed25519',
        hostKeyFingerprint: 'SHA256:server',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      {
        id: 'server-2',
        name: 'Staging',
        host: 'staging.example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        hostKeyAlgorithm: 'ssh-ed25519',
        hostKeyFingerprint: 'SHA256:server',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
    ])
    const first = repository.listAll()[0]
    expect(first).not.toHaveProperty('hostKeyBase64')
    expect(first).not.toHaveProperty('encryptedPayload')
    expect(first).not.toHaveProperty('iv')
    expect(first).not.toHaveProperty('authTag')
  })

  it('persists a server, encrypted credential, and success audit event together', () => {
    const database = createDatabase()
    const repository = new ServerRepository(database)

    const result = repository.createWithAudit(
      serverRecord(),
      encryptedCredential,
      successEvent(),
    )

    expect(result).toEqual({
      id: 'server-1',
      name: 'Production',
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password',
      hostKeyAlgorithm: 'ssh-ed25519',
      hostKeyFingerprint: 'SHA256:server',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    })
    expect(result).not.toHaveProperty('encryptedPayload')
    expect(result).not.toHaveProperty('hostKeyBase64')
    expect(
      database.prepare('SELECT count(*) AS count FROM servers').get(),
    ).toEqual({ count: 1 })
    expect(
      database
        .prepare('SELECT count(*) AS count FROM server_credentials')
        .get(),
    ).toEqual({ count: 1 })
    expect(
      database.prepare('SELECT count(*) AS count FROM audit_logs').get(),
    ).toEqual({ count: 1 })
  })

  it('rolls back all server writes when the success audit insert fails', () => {
    const database = createDatabase()
    database.exec(`
      CREATE TRIGGER fail_success_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.result = 'success'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `)
    const repository = new ServerRepository(database)

    expect(() =>
      repository.createWithAudit(
        serverRecord(),
        encryptedCredential,
        successEvent(),
      ),
    ).toThrow('forced audit failure')
    expect(
      database.prepare('SELECT count(*) AS count FROM servers').get(),
    ).toEqual({ count: 0 })
    expect(
      database
        .prepare('SELECT count(*) AS count FROM server_credentials')
        .get(),
    ).toEqual({ count: 0 })
    expect(
      database.prepare('SELECT count(*) AS count FROM audit_logs').get(),
    ).toEqual({ count: 0 })
  })

  it('rejects a failure audit event before any server data is inserted', () => {
    const database = createDatabase()
    const repository = new ServerRepository(database)

    expect(() =>
      repository.createWithAudit(
        serverRecord(),
        encryptedCredential,
        successEvent({ result: 'failure' }),
      ),
    ).toThrow('ServerRepository.createWithAudit requires a success event')
    expect(
      database.prepare('SELECT count(*) AS count FROM servers').get(),
    ).toEqual({ count: 0 })
    expect(
      database
        .prepare('SELECT count(*) AS count FROM server_credentials')
        .get(),
    ).toEqual({ count: 0 })
    expect(
      database.prepare('SELECT count(*) AS count FROM audit_logs').get(),
    ).toEqual({ count: 0 })
  })

  it('maps an endpoint uniqueness constraint to the stable duplicate error', () => {
    const database = createDatabase()
    const repository = new ServerRepository(database)
    repository.createWithAudit(
      serverRecord(),
      encryptedCredential,
      successEvent(),
    )

    try {
      repository.createWithAudit(
        serverRecord({ id: 'server-2' }),
        encryptedCredential,
        successEvent({ id: 'audit-2', targetId: 'server-2' }),
      )
      throw new Error('Expected duplicate endpoint creation to throw')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect(error).toMatchObject({
        code: 'SERVER_ALREADY_EXISTS',
        statusCode: 409,
        message: 'A server already exists for this endpoint',
      })
      expect(error).not.toHaveProperty(
        'message',
        expect.stringMatching(/SQLITE|\/Users\//),
      )
    }
  })
})
