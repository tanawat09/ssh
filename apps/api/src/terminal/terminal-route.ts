import { randomUUID } from 'node:crypto'

import {
  ApiErrorCode,
  parseTerminalClientMessage,
  serializeTerminalServerMessage,
  type TerminalServerMessage,
} from '@remote/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { WebSocket, type RawData } from 'ws'

import type { AuditRepository } from '../database/audit-repository.js'
import type { ServerRepository } from '../database/server-repository.js'
import { ApplicationError } from '../domain/application-error.js'
import type { CredentialCipher } from '../security/credential-cipher.js'
import { requirePermission } from '../security/permissions.js'
import type { SshTerminal, SshTerminalGateway } from './ssh-terminal-gateway.js'
import type {
  TerminalReservation,
  TerminalSessionManager,
} from './terminal-session-manager.js'

export interface TerminalRouteDependencies {
  allowedOrigin: string
  sshConnectTimeoutMs: number
  serverRepository: Pick<ServerRepository, 'getConnectionMaterialById'>
  credentialCipher: Pick<CredentialCipher, 'decrypt'>
  sshGateway: Pick<SshTerminalGateway, 'openTerminal'>
  sessionManager: Pick<TerminalSessionManager, 'reserve'>
  auditRepository: Pick<AuditRepository, 'recordFailure' | 'recordSuccess'>
  generateId?: () => string
  now?: () => Date
}

const highWaterMark = 1_048_576
const lowWaterMark = 262_144
const drainTimeoutMs = 5_000
const drainPollMs = 50

function asApplicationError(error: unknown): ApplicationError {
  return error instanceof ApplicationError
    ? error
    : new ApplicationError(
        ApiErrorCode.INTERNAL_ERROR,
        500,
        'Internal server error',
      )
}

function actorFrom(request: FastifyRequest): string {
  const user: unknown = request.user
  if (
    typeof user === 'object' &&
    user !== null &&
    'sub' in user &&
    typeof user.sub === 'string'
  ) {
    return user.sub
  }
  return 'admin'
}

function rawDataToString(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString('utf8')
  }
  return Buffer.from(raw).toString('utf8')
}

export function registerTerminalRoute(
  app: FastifyInstance,
  dependencies: TerminalRouteDependencies,
): void {
  const generateId = dependencies.generateId ?? randomUUID
  const now = dependencies.now ?? (() => new Date())

  app.get<{ Params: { serverId: string } }>(
    '/api/v1/servers/:serverId/terminal',
    {
      websocket: true,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['serverId'],
          properties: {
            serverId: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
      preHandler: [
        (request, _reply, done) => {
          if (request.headers.origin !== dependencies.allowedOrigin) {
            done(
              new ApplicationError(
                ApiErrorCode.FORBIDDEN,
                403,
                'Origin is not allowed',
              ),
            )
            return
          }
          done()
        },
        requirePermission('servers:connect'),
      ],
    },
    (socket, request) => {
      const { serverId } = request.params
      const actor = actorFrom(request)
      const source = { sourceIp: request.ip }
      let reservation: TerminalReservation | undefined
      let terminal: SshTerminal | undefined
      let connectedAt: number | undefined
      let finished = false
      let drainStartedAt: number | undefined
      let drainTimer: NodeJS.Timeout | undefined

      const sendControl = (message: TerminalServerMessage): void => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(serializeTerminalServerMessage(message))
        }
      }

      const recordDisconnect = (reason: 'client' | 'ssh' | 'error'): void => {
        if (connectedAt === undefined) return
        const durationMs = Math.min(
          86_400_000,
          Math.max(0, now().getTime() - connectedAt),
        )
        try {
          dependencies.auditRepository.recordSuccess({
            id: generateId(),
            action: 'terminal.disconnect',
            result: 'success',
            actor,
            targetType: 'server',
            targetId: serverId,
            ...source,
            metadata: { reason, durationMs },
            createdAt: now().toISOString(),
          })
        } catch {
          // Cleanup must continue even if audit persistence is unavailable.
        }
      }

      const cleanup = (
        reason: 'client' | 'ssh' | 'error',
        notifyClient: boolean,
      ): void => {
        if (finished) return
        finished = true
        if (drainTimer !== undefined) clearInterval(drainTimer)
        if (notifyClient) sendControl({ type: 'closed', reason })
        terminal?.close()
        reservation?.release()
        recordDisconnect(reason)
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(reason === 'client' ? 1000 : 1011)
        }
      }

      const fail = (error: unknown): void => {
        const applicationError = asApplicationError(error)
        if (connectedAt === undefined) {
          try {
            dependencies.auditRepository.recordFailure({
              id: generateId(),
              action: 'terminal.connect',
              result: 'failure',
              actor,
              targetType: 'server',
              targetId: serverId,
              ...source,
              metadata: { errorCode: applicationError.code },
              createdAt: now().toISOString(),
            })
          } catch {
            // Preserve the stable original failure when auditing also fails.
          }
        }
        sendControl({
          type: 'error',
          code: applicationError.code,
          message: applicationError.message,
        })
        cleanup('error', false)
      }

      const setupPromise = new Promise<SshTerminal | undefined>((resolve) => {
        setImmediate(() => {
          void (async () => {
            try {
              reservation = dependencies.sessionManager.reserve(actor, serverId)
              const material =
                dependencies.serverRepository.getConnectionMaterialById(
                  serverId,
                )
              if (material === undefined) {
                throw new ApplicationError(
                  ApiErrorCode.SERVER_NOT_FOUND,
                  404,
                  'Server not found',
                )
              }
              const credential = dependencies.credentialCipher.decrypt(
                material.encryptedCredential,
              )
              const openedTerminal = await dependencies.sshGateway.openTerminal(
                {
                  material,
                  credential,
                  timeoutMs: dependencies.sshConnectTimeoutMs,
                },
              )
              if (finished) {
                openedTerminal.close()
                resolve(undefined)
                return
              }

              terminal = openedTerminal
              terminal.onData((data) => {
                if (finished || socket.readyState !== WebSocket.OPEN) return
                socket.send(data, { binary: true }, (error) => {
                  if (error != null) cleanup('error', false)
                })
                if (
                  socket.bufferedAmount > highWaterMark &&
                  drainTimer === undefined
                ) {
                  terminal?.pause()
                  drainStartedAt = Date.now()
                  drainTimer = setInterval(() => {
                    if (socket.bufferedAmount <= lowWaterMark) {
                      if (drainTimer !== undefined) clearInterval(drainTimer)
                      drainTimer = undefined
                      drainStartedAt = undefined
                      terminal?.resume()
                    } else if (
                      drainStartedAt !== undefined &&
                      Date.now() - drainStartedAt >= drainTimeoutMs
                    ) {
                      cleanup('error', true)
                    }
                  }, drainPollMs)
                }
              })
              terminal.onClose(() => {
                cleanup('ssh', true)
              })
              const connectedTime = now()
              dependencies.auditRepository.recordSuccess({
                id: generateId(),
                action: 'terminal.connect',
                result: 'success',
                actor,
                targetType: 'server',
                targetId: serverId,
                ...source,
                metadata: {},
                createdAt: connectedTime.toISOString(),
              })
              connectedAt = connectedTime.getTime()
              sendControl({ type: 'ready', sessionId: reservation.id })
              resolve(terminal)
            } catch (error: unknown) {
              fail(error)
              resolve(undefined)
            }
          })()
        })
      })

      socket.on('message', (raw, isBinary) => {
        const message = isBinary
          ? undefined
          : parseTerminalClientMessage(rawDataToString(raw))
        if (message === undefined) {
          fail(
            new ApplicationError(
              ApiErrorCode.TERMINAL_PROTOCOL_ERROR,
              400,
              'Invalid terminal message',
            ),
          )
          return
        }
        if (message.type === 'disconnect') {
          cleanup('client', true)
          return
        }

        void setupPromise.then((activeTerminal) => {
          if (finished || activeTerminal === undefined) return
          if (message.type === 'input') {
            activeTerminal.write(message.data)
          } else {
            activeTerminal.resize(message.cols, message.rows)
          }
        })
      })
      socket.once('close', () => {
        cleanup('client', false)
      })
      socket.once('error', () => {
        cleanup('error', false)
      })
    },
  )
}
