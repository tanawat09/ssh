import { readFileSync } from 'node:fs'

import Database from 'better-sqlite3'

const migrationVersion = '001'
const migrationUrl = new URL(
  `./migrations/${migrationVersion}_create_server.sql`,
  import.meta.url,
)

export function openDatabase(path: string): Database.Database {
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  return database
}

export function migrateDatabase(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const hasMigration = database
    .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .pluck()
    .get(migrationVersion)

  if (hasMigration !== undefined) {
    return
  }

  const migrationSql = readFileSync(migrationUrl, 'utf8')
  database.transaction(() => {
    database.exec(migrationSql)
    database
      .prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      )
      .run(migrationVersion, new Date().toISOString())
  })()
}
