import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'

import {
  ApiErrorCode,
  type CreateServerRequest,
  type ServerDto,
} from '@remote/shared'

import type { AuditRepository } from '../database/audit-repository.js'
import type { ServerRepository } from '../database/server-repository.js'
import { ApplicationError } from '../domain/application-error.js'
import type {
  CredentialCipher,
  ServerCredential,
} from '../security/credential-cipher.js'
import type { SshGateway, VerifiedHostKey } from './ssh-gateway.js'

interface CreateServerContext {
  actor: string
  sourceIp?: string
}

interface CreateServerServiceDependencies {
  serverRepository: Pick<
    ServerRepository,
    'existsByEndpoint' | 'createWithAudit'
  >
  auditRepository: Pick<AuditRepository, 'recordFailure'>
  sshGateway: SshGateway
  credentialCipher: Pick<CredentialCipher, 'encrypt'>
  sshConnectTimeoutMs: number
  generateId?: () => string
  now?: () => Date
}

function isDnsName(host: string): boolean {
  if (host.length === 0 || host.length > 253) {
    return false
  }
  return host
    .split('.')
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
}

function normalize(input: CreateServerRequest): CreateServerRequest {
  const host = input.host.trim().toLowerCase()
  const name = input.name.trim()
  const username = input.username.trim()
  if (
    name.length === 0 ||
    username.length === 0 ||
    (isIP(host) === 0 && !isDnsName(host))
  ) {
    throw new ApplicationError(
      ApiErrorCode.INVALID_REQUEST,
      400,
      'Invalid request',
    )
  }
  return { ...input, name, host, username }
}

function credentialFor(input: CreateServerRequest): ServerCredential {
  return input.authType === 'password'
    ? { authType: 'password', password: input.password }
    : {
        authType: 'privateKey',
        privateKey: input.privateKey,
        ...(input.passphrase === undefined
          ? {}
          : { passphrase: input.passphrase }),
      }
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

export class CreateServerService {
  readonly #generateId: () => string
  readonly #now: () => Date

  constructor(private readonly dependencies: CreateServerServiceDependencies) {
    this.#generateId = dependencies.generateId ?? randomUUID
    this.#now = dependencies.now ?? (() => new Date())
  }

  async execute(
    input: CreateServerRequest,
    context: CreateServerContext,
  ): Promise<ServerDto> {
    let normalized: CreateServerRequest | undefined
    let hostKey: VerifiedHostKey | undefined
    const source =
      context.sourceIp === undefined ? {} : { sourceIp: context.sourceIp }
    try {
      normalized = normalize(input)
      const endpoint = {
        host: normalized.host,
        port: normalized.port,
        username: normalized.username,
      }
      if (this.dependencies.serverRepository.existsByEndpoint(endpoint)) {
        throw new ApplicationError(
          ApiErrorCode.SERVER_ALREADY_EXISTS,
          409,
          'A server already exists for this endpoint',
        )
      }

      hostKey = await this.dependencies.sshGateway.testConnection(
        normalized,
        this.dependencies.sshConnectTimeoutMs,
      )
      const encrypted = this.dependencies.credentialCipher.encrypt(
        credentialFor(normalized),
      )
      const serverId = this.#generateId()
      const createdAt = this.#now().toISOString()
      return this.dependencies.serverRepository.createWithAudit(
        {
          id: serverId,
          name: normalized.name,
          ...endpoint,
          authType: normalized.authType,
          hostKeyAlgorithm: hostKey.algorithm,
          hostKeyFingerprint: hostKey.fingerprint,
          hostKeyBase64: hostKey.keyBase64,
          createdAt,
          updatedAt: createdAt,
        },
        encrypted,
        {
          id: this.#generateId(),
          action: 'server.create',
          result: 'success',
          actor: context.actor,
          targetType: 'server',
          targetId: serverId,
          ...source,
          metadata: {
            ...endpoint,
            authType: normalized.authType,
            tofuAccepted: true,
            hostKeyFingerprint: hostKey.fingerprint,
          },
          createdAt,
        },
      )
    } catch (error: unknown) {
      const applicationError = toApplicationError(error)
      const publicInput = normalized ?? {
        ...input,
        host: input.host.trim().toLowerCase(),
        name: input.name.trim(),
        username: input.username.trim(),
      }
      try {
        this.dependencies.auditRepository.recordFailure({
          id: this.#generateId(),
          action: 'server.create',
          result: 'failure',
          actor: context.actor,
          targetType: 'server',
          ...source,
          metadata: {
            host: publicInput.host,
            port: publicInput.port,
            username: publicInput.username,
            authType: publicInput.authType,
            errorCode: applicationError.code,
            tofuAccepted: hostKey !== undefined,
            ...(hostKey === undefined
              ? {}
              : { hostKeyFingerprint: hostKey.fingerprint }),
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
