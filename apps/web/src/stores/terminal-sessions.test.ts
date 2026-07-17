import type { ServerDto } from '@remote/shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  TerminalSocket,
  TerminalSocketHandlers,
} from '../lib/terminal-socket'
import { useTerminalSessionsStore } from './terminal-sessions'

const server = (index: number): ServerDto => ({
  id: `server-${String(index)}`,
  name: `Server ${String(index)}`,
  host: `server-${String(index)}.example.com`,
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyFingerprint: `SHA256:${String(index)}`,
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
})

interface FakeConnection extends TerminalSocket {
  handlers: TerminalSocketHandlers
}

function socketFactory(connections: FakeConnection[]) {
  return (_serverId: string, handlers: TerminalSocketHandlers) => {
    const connection: FakeConnection = {
      handlers,
      sendInput: vi.fn(),
      resize: vi.fn(),
      disconnect: vi.fn(),
      close: vi.fn(),
    }
    connections.push(connection)
    return connection
  }
}

describe('terminal sessions store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens at most five distinct servers and activates an existing tab', () => {
    const connections: FakeConnection[] = []
    const store = useTerminalSessionsStore()
    const factory = socketFactory(connections)

    for (let index = 1; index <= 5; index += 1) {
      expect(store.connect(server(index), factory)).toBe(true)
    }
    expect(store.connect(server(6), factory)).toBe(false)
    expect(store.lastError).toBe('Maximum of 5 terminal sessions reached.')
    expect(store.connect(server(1), factory)).toBe(true)
    expect(store.tabs).toHaveLength(5)
    expect(store.activeServerId).toBe('server-1')
    expect(connections).toHaveLength(5)
  })

  it('tracks ready, error, and subscribed binary output states', () => {
    const connections: FakeConnection[] = []
    const store = useTerminalSessionsStore()
    store.connect(server(1), socketFactory(connections))
    const output = vi.fn()
    const unsubscribe = store.subscribeOutput('server-1', output)

    connections[0]?.handlers.onReady('session-1')
    connections[0]?.handlers.onOutput(new Uint8Array([104, 105]))
    expect(store.tabs[0]).toMatchObject({
      status: 'ready',
      sessionId: 'session-1',
    })
    expect(output).toHaveBeenCalledWith(new Uint8Array([104, 105]))

    unsubscribe()
    connections[0]?.handlers.onError(
      'SSH_CONNECTION_FAILED',
      'SSH connection failed',
    )
    expect(store.tabs[0]).toMatchObject({
      status: 'error',
      errorMessage: 'SSH connection failed',
    })
  })

  it('disconnects tabs, selects a stable fallback, and closes all sockets', () => {
    const connections: FakeConnection[] = []
    const store = useTerminalSessionsStore()
    const factory = socketFactory(connections)
    store.connect(server(1), factory)
    store.connect(server(2), factory)
    store.connect(server(3), factory)
    store.activate('server-2')

    store.disconnect('server-2')

    expect(connections[1]?.disconnect).toHaveBeenCalledTimes(1)
    expect(store.activeServerId).toBe('server-3')
    expect(store.tabs.map(({ server: value }) => value.id)).toEqual([
      'server-1',
      'server-3',
    ])

    store.disconnectAll()
    expect(connections[0]?.close).toHaveBeenCalledTimes(1)
    expect(connections[2]?.close).toHaveBeenCalledTimes(1)
    expect(store.tabs).toEqual([])
    expect(store.activeServerId).toBeNull()
  })
})
