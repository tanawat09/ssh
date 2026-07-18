import type { ApiErrorCode, ServerDto } from '@remote/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  createTerminalSocket,
  type TerminalSocket,
  type TerminalSocketFactory,
} from '../lib/terminal-socket'

export interface TerminalTab {
  server: ServerDto
  status: 'connecting' | 'ready' | 'error' | 'closed'
  sessionId: string | undefined
  errorCode: ApiErrorCode | undefined
  errorMessage: string
}

const maximumSessions = 5
const maximumPendingOutputBytes = 1_048_576

export const useTerminalSessionsStore = defineStore('terminal-sessions', () => {
  const tabs = ref<TerminalTab[]>([])
  const activeServerId = ref<string | null>(null)
  const lastError = ref('')
  const connections = new Map<string, TerminalSocket>()
  const outputSubscribers = new Map<string, Set<(data: Uint8Array) => void>>()
  const pendingOutput = new Map<string, Uint8Array[]>()

  function findTab(serverId: string): TerminalTab | undefined {
    return tabs.value.find(({ server }) => server.id === serverId)
  }

  function deliverOutput(serverId: string, data: Uint8Array): void {
    const subscribers = outputSubscribers.get(serverId)
    if (subscribers !== undefined && subscribers.size > 0) {
      subscribers.forEach((subscriber) => {
        subscriber(data)
      })
      return
    }

    const queued = pendingOutput.get(serverId) ?? []
    const queuedBytes = queued.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    if (queuedBytes + data.byteLength <= maximumPendingOutputBytes) {
      queued.push(data.slice())
      pendingOutput.set(serverId, queued)
      return
    }
    const tab = findTab(serverId)
    if (tab !== undefined) {
      tab.status = 'error'
      tab.errorCode = 'SSH_CONNECTION_FAILED'
      tab.errorMessage = 'Terminal output exceeded the local buffer limit.'
    }
    connections.get(serverId)?.close()
  }

  function connect(
    server: ServerDto,
    createSocket: TerminalSocketFactory = createTerminalSocket,
  ): boolean {
    lastError.value = ''
    if (findTab(server.id) !== undefined) {
      activeServerId.value = server.id
      return true
    }
    if (tabs.value.length >= maximumSessions) {
      lastError.value = 'Maximum of 5 terminal sessions reached.'
      return false
    }

    const tab: TerminalTab = {
      server,
      status: 'connecting',
      sessionId: undefined,
      errorCode: undefined,
      errorMessage: '',
    }
    tabs.value.push(tab)
    activeServerId.value = server.id

    try {
      const connection = createSocket(server.id, {
        onReady: (sessionId) => {
          const current = findTab(server.id)
          if (current === undefined) return
          current.status = 'ready'
          current.sessionId = sessionId
          current.errorCode = undefined
          current.errorMessage = ''
        },
        onOutput: (data) => {
          deliverOutput(server.id, data)
        },
        onError: (code, message) => {
          const current = findTab(server.id)
          if (current === undefined) return
          current.status = 'error'
          current.errorCode = code
          current.errorMessage = message
        },
        onClosed: (reason) => {
          const current = findTab(server.id)
          if (current === undefined) return
          current.status = 'closed'
          if (current.errorMessage.length === 0) {
            current.errorMessage =
              reason === 'ssh'
                ? 'The remote SSH session ended.'
                : 'Terminal connection closed.'
          }
          connections.delete(server.id)
        },
      })
      connections.set(server.id, connection)
    } catch {
      tab.status = 'error'
      tab.errorCode = 'SSH_CONNECTION_FAILED'
      tab.errorMessage = 'Unable to open terminal connection.'
    }
    return true
  }

  function activate(serverId: string): void {
    if (findTab(serverId) !== undefined) activeServerId.value = serverId
  }

  function disconnect(serverId: string): void {
    const index = tabs.value.findIndex(({ server }) => server.id === serverId)
    if (index < 0) return
    connections.get(serverId)?.disconnect()
    connections.delete(serverId)
    outputSubscribers.delete(serverId)
    pendingOutput.delete(serverId)
    tabs.value.splice(index, 1)
    if (activeServerId.value === serverId) {
      activeServerId.value =
        tabs.value[index]?.server.id ?? tabs.value[index - 1]?.server.id ?? null
    }
  }

  function disconnectAll(): void {
    connections.forEach((connection) => {
      connection.close()
    })
    connections.clear()
    outputSubscribers.clear()
    pendingOutput.clear()
    tabs.value = []
    activeServerId.value = null
    lastError.value = ''
  }

  function subscribeOutput(
    serverId: string,
    subscriber: (data: Uint8Array) => void,
  ): () => void {
    const subscribers = outputSubscribers.get(serverId) ?? new Set()
    subscribers.add(subscriber)
    outputSubscribers.set(serverId, subscribers)
    pendingOutput.get(serverId)?.forEach(subscriber)
    pendingOutput.delete(serverId)
    return () => {
      const current = outputSubscribers.get(serverId)
      current?.delete(subscriber)
      if (current?.size === 0) outputSubscribers.delete(serverId)
    }
  }

  function sendInput(serverId: string, data: string): void {
    connections.get(serverId)?.sendInput(data)
  }

  function resize(serverId: string, cols: number, rows: number): void {
    connections.get(serverId)?.resize(cols, rows)
  }

  return {
    tabs,
    activeServerId,
    lastError,
    connect,
    activate,
    disconnect,
    disconnectAll,
    subscribeOutput,
    sendInput,
    resize,
  }
})
