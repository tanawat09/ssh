export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  adminUsername: string
  adminPasswordHash: string
  jwtSecret: string
  jwtExpiresInSeconds: number
  credentialEncryptionKey: Buffer
  allowedOrigin: string
  databasePath: string
  sshConnectTimeoutMs: number
}

const requiredVariables = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'JWT_SECRET',
  'CREDENTIAL_ENCRYPTION_KEY',
  'ALLOWED_ORIGIN',
  'DATABASE_PATH',
] as const

type RequiredVariable = (typeof requiredVariables)[number]

function requireVariable(
  env: NodeJS.ProcessEnv,
  name: RequiredVariable,
): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function parseBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: 'JWT_EXPIRES_IN_SECONDS' | 'SSH_CONNECT_TIMEOUT_MS',
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = env[name]
  if (rawValue === undefined) {
    return defaultValue
  }

  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    )
  }
  return value
}

function decodeCredentialEncryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be Base64-encoded 32 bytes')
  }
  return key
}

function validateJwtSecret(secret: string): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 UTF-8 bytes')
  }
  return secret
}

function validateNodeEnv(nodeEnv: string | undefined): AppConfig['nodeEnv'] {
  const value = nodeEnv ?? 'development'
  if (!['development', 'test', 'production'].includes(value)) {
    throw new Error('NODE_ENV must be one of development, test, production')
  }
  return value as AppConfig['nodeEnv']
}

function validateAdminPasswordHash(hash: string): string {
  if (
    !/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(
      hash,
    )
  ) {
    throw new Error('ADMIN_PASSWORD_HASH must be an Argon2id PHC string')
  }
  return hash
}

function validateAllowedOrigin(origin: string): string {
  try {
    const parsed = new URL(origin)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== origin
    ) {
      throw new Error()
    }
  } catch {
    throw new Error(
      'ALLOWED_ORIGIN must be an absolute HTTP(S) origin without a path, query, or fragment',
    )
  }
  return origin
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const values = Object.fromEntries(
    requiredVariables.map((name) => [name, requireVariable(env, name)]),
  ) as Record<RequiredVariable, string>

  return {
    nodeEnv: validateNodeEnv(env.NODE_ENV),
    adminUsername: values.ADMIN_USERNAME,
    adminPasswordHash: validateAdminPasswordHash(values.ADMIN_PASSWORD_HASH),
    jwtSecret: validateJwtSecret(values.JWT_SECRET),
    jwtExpiresInSeconds: parseBoundedInteger(
      env,
      'JWT_EXPIRES_IN_SECONDS',
      3600,
      300,
      28_800,
    ),
    credentialEncryptionKey: decodeCredentialEncryptionKey(
      values.CREDENTIAL_ENCRYPTION_KEY,
    ),
    allowedOrigin: validateAllowedOrigin(values.ALLOWED_ORIGIN),
    databasePath: values.DATABASE_PATH,
    sshConnectTimeoutMs: parseBoundedInteger(
      env,
      'SSH_CONNECT_TIMEOUT_MS',
      10_000,
      1000,
      60_000,
    ),
  }
}
