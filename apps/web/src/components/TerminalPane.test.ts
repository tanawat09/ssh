import type { ServerDto } from '@remote/shared'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  TerminalSocket,
  TerminalSocketHandlers,
} from '../lib/terminal-socket'
import { useTerminalSessionsStore } from '../stores/terminal-sessions'
import TerminalPane from './TerminalPane.vue'

const terminalMocks = vi.hoisted(() => ({
  open: vi.fn(),
  write: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  onData: vi.fn(),
  fit: vi.fn(),
  proposeDimensions: vi.fn(() => ({ cols: 120, rows: 40 })),
  dataHandler: undefined as ((data: string) => void) | undefined,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open = terminalMocks.open
    write = terminalMocks.write
    focus = terminalMocks.focus
    dispose = terminalMocks.dispose
    loadAddon = terminalMocks.loadAddon
    onData(handler: (data: string) => void) {
      terminalMocks.dataHandler = handler
      terminalMocks.onData(handler)
      return { dispose: vi.fn() }
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = terminalMocks.fit
    proposeDimensions = terminalMocks.proposeDimensions
  },
}))

const server: ServerDto = {
  id: 'server-1',
  name: 'Production',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyFingerprint: 'SHA256:fingerprint',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
}

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    terminalMocks.open.mockClear()
    terminalMocks.write.mockClear()
    terminalMocks.focus.mockClear()
    terminalMocks.dispose.mockClear()
    terminalMocks.dataHandler = undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {
          // Layout is controlled by the test.
        }
        disconnect(): void {
          // No observer resources are allocated by this test double.
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('forwards terminal output, input, and fitted dimensions', async () => {
    const store = useTerminalSessionsStore()
    let handlers: TerminalSocketHandlers | undefined
    const sendInput = vi.fn<(data: string) => void>()
    const resize = vi.fn<(cols: number, rows: number) => void>()
    const socket: TerminalSocket = {
      sendInput,
      resize,
      disconnect: vi.fn(),
      close: vi.fn(),
    }
    store.connect(server, (_serverId, value) => {
      handlers = value
      return socket
    })
    const wrapper = mount(TerminalPane, {
      props: { serverId: server.id, active: true },
    })

    handlers?.onOutput(new Uint8Array([104, 105]))
    terminalMocks.dataHandler?.('whoami\r')
    await vi.runAllTimersAsync()

    expect(terminalMocks.open).toHaveBeenCalledTimes(1)
    expect(terminalMocks.write).toHaveBeenCalledWith(new Uint8Array([104, 105]))
    expect(sendInput).toHaveBeenCalledWith('whoami\r')
    expect(resize).toHaveBeenCalledWith(120, 40)

    wrapper.unmount()
    expect(terminalMocks.dispose).toHaveBeenCalledTimes(1)
  })
})
