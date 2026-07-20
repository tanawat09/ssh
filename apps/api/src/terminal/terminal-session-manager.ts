import { randomUUID } from 'node:crypto'

import { ApiErrorCode } from '@remote/shared'

import { ApplicationError } from '../domain/application-error.js'

export interface TerminalReservation {
  id: string
  actor: string
  serverId: string
  release(): void
}

const maximumSessionsPerActor = 5

export class TerminalSessionManager {
  readonly #sessionsByActor = new Map<string, Map<string, string>>()

  isServerActive(serverId: string): boolean {
    for (const sessions of this.#sessionsByActor.values()) {
      if (sessions.has(serverId)) return true
    }
    return false
  }

  reserve(actor: string, serverId: string): TerminalReservation {
    const sessions =
      this.#sessionsByActor.get(actor) ?? new Map<string, string>()
    if (sessions.has(serverId)) {
      throw new ApplicationError(
        ApiErrorCode.TERMINAL_ALREADY_ACTIVE,
        409,
        'A terminal for this server is already active',
      )
    }
    if (sessions.size >= maximumSessionsPerActor) {
      throw new ApplicationError(
        ApiErrorCode.TERMINAL_SESSION_LIMIT,
        429,
        'Terminal session limit reached',
      )
    }

    const id = randomUUID()
    sessions.set(serverId, id)
    this.#sessionsByActor.set(actor, sessions)
    let released = false

    return {
      id,
      actor,
      serverId,
      release: () => {
        if (released) {
          return
        }
        released = true
        const activeSessions = this.#sessionsByActor.get(actor)
        if (activeSessions?.get(serverId) !== id) {
          return
        }
        activeSessions.delete(serverId)
        if (activeSessions.size === 0) {
          this.#sessionsByActor.delete(actor)
        }
      },
    }
  }
}
