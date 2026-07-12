import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateDatabase, openDatabase } from './database.js'

const databases: Database.Database[] = []

function createDatabase(): Database.Database {
  const database = openDatabase(':memory:')
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

describe('database foundation', () => {
  it('enables foreign-key enforcement on every opened database', () => {
    const database = createDatabase()

    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('applies migration 001 exactly once', () => {
    const database = createDatabase()

    expect(() => {
      migrateDatabase(database)
    }).not.toThrow()
    expect(() => {
      migrateDatabase(database)
    }).not.toThrow()

    const migrations = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
    expect(migrations).toEqual([{ version: '001' }])
  })

  it('creates only the approved feature tables plus migration metadata', () => {
    const database = createDatabase()
    migrateDatabase(database)

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .pluck()
      .all()

    expect(tables).toEqual([
      'audit_logs',
      'schema_migrations',
      'server_credentials',
      'servers',
    ])
  })

  it('enforces server auth type and normalized endpoint uniqueness', () => {
    const database = createDatabase()
    migrateDatabase(database)
    const insertServer = database.prepare(`
      INSERT INTO servers (
        id, name, host, port, username, auth_type,
        host_key_algorithm, host_key_fingerprint, host_key_base64,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const values = [
      'server-1',
      'Primary',
      'host.example.test',
      22,
      'deploy',
      'password',
      'ssh-ed25519',
      'SHA256:test',
      'a2V5',
      '2026-07-12T00:00:00.000Z',
      '2026-07-12T00:00:00.000Z',
    ] as const

    insertServer.run(...values)
    expect(() => insertServer.run(...values)).toThrow(
      /UNIQUE constraint failed/,
    )
    expect(() =>
      insertServer.run(
        'server-2',
        'Invalid',
        'other.example.test',
        22,
        'deploy',
        'agent',
        'ssh-ed25519',
        'SHA256:test',
        'a2V5',
        '2026-07-12T00:00:00.000Z',
        '2026-07-12T00:00:00.000Z',
      ),
    ).toThrow(/CHECK constraint failed/)
  })

  it('keeps encrypted credential fields isolated and foreign-keyed to servers', () => {
    const database = createDatabase()
    migrateDatabase(database)

    const serverColumns = database.pragma('table_info(servers)') as {
      name: string
    }[]
    const credentialColumns = database.pragma(
      'table_info(server_credentials)',
    ) as { name: string }[]

    expect(serverColumns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['encrypted_payload', 'iv', 'auth_tag']),
    )
    expect(credentialColumns.map(({ name }) => name)).toEqual([
      'server_id',
      'encrypted_payload',
      'iv',
      'auth_tag',
    ])
    expect(() =>
      database
        .prepare(
          'INSERT INTO server_credentials (server_id, encrypted_payload, iv, auth_tag) VALUES (?, ?, ?, ?)',
        )
        .run(
          'missing-server',
          Buffer.from('ciphertext'),
          Buffer.alloc(12),
          Buffer.alloc(16),
        ),
    ).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('creates audit-time and target-lookup indexes', () => {
    const database = createDatabase()
    migrateDatabase(database)

    const indexedColumns = database
      .prepare(
        `
        SELECT group_concat(ii.name, ',') AS columns
        FROM pragma_index_list('audit_logs') AS il
        JOIN pragma_index_info(il.name) AS ii
        GROUP BY il.name
      `,
      )
      .pluck()
      .all()

    expect(indexedColumns).toEqual(
      expect.arrayContaining(['created_at', 'target_type,target_id']),
    )
  })
})
