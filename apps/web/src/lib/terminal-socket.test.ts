import { describe, expect, it, vi } from 'vitest'

import {
  createTerminalSocket,
  type TerminalSocketHandlers,
} from './terminal-socket'

class FakeWebSocket {
  binaryType = ''
  readyState = 1
  readonly sent: string[] = []
  readonly close = vi.fn<() => void>(() => {
    this.readyState = 3
  })
  readonly listeners = new Map<string, ((event: Event) => void)[]>()

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  emit(type: string, event: Event): void {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

function setup() {
  let socket: FakeWebSocket | undefined
  const handlers: TerminalSocketHandlers = {
    onReady: vi.fn(),
    onOutput: vi.fn(),
    onError: vi.fn(),
    onClosed: vi.fn(),
  }
  const terminalSocket = createTerminalSocket('server/id', handlers, {
    location: { protocol: 'https:', host: 'ssh.example.com' },
    createWebSocket: (url) => {
      socket = new FakeWebSocket(url)
      return socket as unknown as WebSocket
    },
  })
  if (socket === undefined) throw new Error('WebSocket was not created')
  return { socket, handlers, terminalSocket }
}

describe('createTerminalSocket', () => {
  it('uses an encoded same-origin WSS URL without credentials', () => {
    const { socket } = setup()

    expect(socket.url).toBe(
      'wss://ssh.example.com/api/v1/servers/server%2Fid/terminal',
    )
    expect(socket.url).not.toMatch(/token|password|privateKey/i)
    expect(socket.binaryType).toBe('arraybuffer')
  })

  it('forwards approved control messages and binary terminal output', () => {
    const { socket, handlers } = setup()

    socket.emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'ready', sessionId: 'session-1' }),
      }),
    )
    const bytes = new Uint8Array([104, 105])
    socket.emit('message', new MessageEvent('message', { data: bytes.buffer }))
    socket.emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'closed', reason: 'ssh' }),
      }),
    )

    expect(handlers.onReady).toHaveBeenCalledWith('session-1')
    expect(handlers.onOutput).toHaveBeenCalledWith(bytes)
    expect(handlers.onClosed).toHaveBeenCalledWith('ssh')
  })

  it('sends validated control shapes and closes explicitly', () => {
    const { socket, terminalSocket } = setup()

    terminalSocket.sendInput('whoami\r')
    terminalSocket.resize(120, 40)
    terminalSocket.disconnect()

    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'input', data: 'whoami\r' },
      { type: 'resize', cols: 120, rows: 40 },
      { type: 'disconnect' },
    ])
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('maps malformed server control data to a protocol error', () => {
    const { socket, handlers } = setup()

    socket.emit('message', new MessageEvent('message', { data: '{invalid' }))

    expect(handlers.onError).toHaveBeenCalledWith(
      'TERMINAL_PROTOCOL_ERROR',
      'Invalid terminal response',
    )
  })
})
