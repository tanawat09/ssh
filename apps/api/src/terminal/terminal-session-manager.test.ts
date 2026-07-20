import { describe, expect, it } from 'vitest'

import { ApplicationError } from '../domain/application-error.js'
import { TerminalSessionManager } from './terminal-session-manager.js'

describe('TerminalSessionManager', () => {
  it('reserves up to five different servers for one actor', () => {
    const manager = new TerminalSessionManager()
    const reservations = Array.from({ length: 5 }, (_, index) =>
      manager.reserve('admin', `server-${String(index + 1)}`),
    )

    expect(new Set(reservations.map(({ id }) => id)).size).toBe(5)
    expect(
      reservations.map(({ actor, serverId }) => ({ actor, serverId })),
    ).toEqual(
      Array.from({ length: 5 }, (_, index) => ({
        actor: 'admin',
        serverId: `server-${String(index + 1)}`,
      })),
    )
  })

  it('rejects a sixth active session for the same actor', () => {
    const manager = new TerminalSessionManager()
    for (let index = 1; index <= 5; index += 1) {
      manager.reserve('admin', `server-${String(index)}`)
    }

    expect(() => manager.reserve('admin', 'server-6')).toThrow(
      expect.objectContaining<Partial<ApplicationError>>({
        code: 'TERMINAL_SESSION_LIMIT',
        statusCode: 429,
        message: 'Terminal session limit reached',
      }),
    )
  })

  it('rejects a duplicate active server for the same actor', () => {
    const manager = new TerminalSessionManager()
    manager.reserve('admin', 'server-1')

    expect(() => manager.reserve('admin', 'server-1')).toThrow(
      expect.objectContaining<Partial<ApplicationError>>({
        code: 'TERMINAL_ALREADY_ACTIVE',
        statusCode: 409,
        message: 'A terminal for this server is already active',
      }),
    )
  })

  it('isolates reservations by actor', () => {
    const manager = new TerminalSessionManager()
    manager.reserve('admin', 'server-1')

    expect(() => manager.reserve('other-admin', 'server-1')).not.toThrow()
  })

  it('reports a server active across actors until its reservation is released', () => {
    const manager = new TerminalSessionManager()
    const reservation = manager.reserve('operator-a', 'server-1')

    expect(manager.isServerActive('server-1')).toBe(true)
    expect(manager.isServerActive('server-2')).toBe(false)

    reservation.release()
    expect(manager.isServerActive('server-1')).toBe(false)
  })

  it('keeps a server active while another actor still has a reservation', () => {
    const manager = new TerminalSessionManager()
    const first = manager.reserve('operator-a', 'server-1')
    manager.reserve('operator-b', 'server-1')

    first.release()
    expect(manager.isServerActive('server-1')).toBe(true)
  })

  it('allows reuse after an idempotent release', () => {
    const manager = new TerminalSessionManager()
    const reservation = manager.reserve('admin', 'server-1')

    reservation.release()
    reservation.release()

    expect(() => manager.reserve('admin', 'server-1')).not.toThrow()
  })
})
