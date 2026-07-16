import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { AuditRepository } from './database/audit-repository.js'
import { migrateDatabase, openDatabase } from './database/database.js'
import { ServerRepository } from './database/server-repository.js'
import { CredentialCipher } from './security/credential-cipher.js'
import { CreateServerService } from './servers/create-server-service.js'
import { ListServerService } from './servers/list-server-service.js'
import { Ssh2Gateway } from './servers/ssh-gateway.js'

async function start(): Promise<void> {
  const config = loadConfig(process.env)
  const database = openDatabase(config.databasePath)
  let databaseClosed = false
  const closeDatabase = (): void => {
    if (!databaseClosed) {
      databaseClosed = true
      database.close()
    }
  }

  try {
    migrateDatabase(database)
    const serverRepository = new ServerRepository(database)
    const auditRepository = new AuditRepository(database)
    const createServerService = new CreateServerService({
      serverRepository,
      auditRepository,
      sshGateway: new Ssh2Gateway(),
      credentialCipher: new CredentialCipher(config.credentialEncryptionKey),
      sshConnectTimeoutMs: config.sshConnectTimeoutMs,
    })
    const listServerService = new ListServerService({
      serverRepository,
      auditRepository,
    })
    const app = buildApp({ config, createServerService, listServerService })
    let shuttingDown = false
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      try {
        await app.close()
      } finally {
        closeDatabase()
      }
    }
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())

    try {
      await app.listen({ host: '0.0.0.0', port: 3000 })
    } catch (error: unknown) {
      await shutdown()
      throw error
    }
  } catch (error: unknown) {
    closeDatabase()
    throw error
  }
}

try {
  await start()
} catch {
  console.error('API startup failed')
  process.exitCode = 1
}
