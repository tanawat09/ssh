import {
  ApiErrorCode,
  type ApiErrorCode as ApiErrorCodeType,
  type TerminalServerMessage,
} from '@remote/shared'

export interface TerminalSocketHandlers {
  onReady(sessionId: string): void
  onOutput(data: Uint8Array): void
  onError(code: ApiErrorCodeType, message: string): void
  onClosed(reason: 'client' | 'ssh' | 'error'): void
}

export interface TerminalSocket {
  sendInput(data: string): void
  resize(cols: number, rows: number): void
  disconnect(): void
  close(): void
}

export type TerminalSocketFactory = (
  serverId: string,
  handlers: TerminalSocketHandlers,
) => TerminalSocket

interface TerminalSocketOptions {
  location?: Pick<Location, 'protocol' | 'host'>
  createWebSocket?: (url: string) => WebSocket
}

const errorCodes = new Set<string>(Object.values(ApiErrorCode))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function parseServerMessage(value: string): TerminalServerMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  if (
    parsed.type === 'ready' &&
    hasExactKeys(parsed, ['type', 'sessionId']) &&
    typeof parsed.sessionId === 'string' &&
    parsed.sessionId.length > 0
  ) {
    return { type: 'ready', sessionId: parsed.sessionId }
  }
  if (
    parsed.type === 'error' &&
    hasExactKeys(parsed, ['type', 'code', 'message']) &&
    typeof parsed.code === 'string' &&
    errorCodes.has(parsed.code) &&
    typeof parsed.message === 'string'
  ) {
    return {
      type: 'error',
      code: parsed.code as ApiErrorCodeType,
      message: parsed.message,
    }
  }
  if (
    parsed.type === 'closed' &&
    hasExactKeys(parsed, ['type', 'reason']) &&
    (parsed.reason === 'client' ||
      parsed.reason === 'ssh' ||
      parsed.reason === 'error')
  ) {
    return { type: 'closed', reason: parsed.reason }
  }
  return undefined
}

export function createTerminalSocket(
  serverId: string,
  handlers: TerminalSocketHandlers,
  options: TerminalSocketOptions = {},
): TerminalSocket {
  const location = options.location ?? window.location
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${location.host}/api/v1/servers/${encodeURIComponent(serverId)}/terminal`
  const socket = (options.createWebSocket ?? ((value) => new WebSocket(value)))(
    url,
  )
  socket.binaryType = 'arraybuffer'
  let closedNotified = false

  socket.addEventListener('message', (event) => {
    if (event.data instanceof ArrayBuffer) {
      handlers.onOutput(new Uint8Array(event.data))
      return
    }
    if (typeof event.data !== 'string') {
      handlers.onError(
        ApiErrorCode.TERMINAL_PROTOCOL_ERROR,
        'Invalid terminal response',
      )
      return
    }
    const message = parseServerMessage(event.data)
    if (message === undefined) {
      handlers.onError(
        ApiErrorCode.TERMINAL_PROTOCOL_ERROR,
        'Invalid terminal response',
      )
    } else if (message.type === 'ready') {
      handlers.onReady(message.sessionId)
    } else if (message.type === 'error') {
      handlers.onError(message.code, message.message)
    } else {
      closedNotified = true
      handlers.onClosed(message.reason)
    }
  })
  socket.addEventListener('error', () => {
    handlers.onError(
      ApiErrorCode.SSH_CONNECTION_FAILED,
      'Terminal connection lost',
    )
  })
  socket.addEventListener('close', () => {
    if (!closedNotified) handlers.onClosed('error')
  })

  const send = (message: object): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  return {
    sendInput: (data) => send({ type: 'input', data }),
    resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    disconnect: () => {
      send({ type: 'disconnect' })
      socket.close()
    },
    close: () => socket.close(),
  }
}
