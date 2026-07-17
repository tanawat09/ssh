import type { ServerDto } from '@remote/shared'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  TerminalSocket,
  TerminalSocketHandlers,
} from '../lib/terminal-socket'
import { useTerminalSessionsStore } from '../stores/terminal-sessions'
import TerminalWorkspaceView from './TerminalWorkspaceView.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('../components/TerminalPane.vue', () => ({
  default: {
    props: ['serverId', 'active'],
    template: '<div class="terminal-pane-stub">{{ serverId }}</div>',
  },
}))

const server = (id: string, name: string): ServerDto => ({
  id,
  name,
  host: `${id}.example.com`,
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyFingerprint: `SHA256:${id}`,
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
})

describe('TerminalWorkspaceView', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens, switches, and closes multiple terminal tabs', async () => {
    const servers = [
      server('production', 'Production'),
      server('database', 'Database'),
    ]
    const store = useTerminalSessionsStore()
    const handlers = new Map<string, TerminalSocketHandlers>()
    const sockets = new Map<string, TerminalSocket>()
    const connectServer = (value: ServerDto): boolean =>
      store.connect(value, (serverId, socketHandlers) => {
        handlers.set(serverId, socketHandlers)
        const socket: TerminalSocket = {
          sendInput: vi.fn(),
          resize: vi.fn(),
          disconnect: vi.fn(),
          close: vi.fn(),
        }
        sockets.set(serverId, socket)
        return socket
      })
    const wrapper = mount(TerminalWorkspaceView, {
      props: {
        listServers: vi.fn().mockResolvedValue(servers),
        connectServer,
      },
      global: {
        stubs: {
          RouterLink: { template: '<a><slot /></a>' },
          TerminalPane: {
            props: ['serverId', 'active'],
            template: '<div class="terminal-pane-stub">{{ serverId }}</div>',
          },
        },
      },
    })
    await flushPromises()

    const connectButtons = wrapper.findAll('[data-test="connect-server"]')
    await connectButtons[0]?.trigger('click')
    await connectButtons[1]?.trigger('click')
    handlers.get('production')?.onReady('session-1')
    handlers.get('database')?.onReady('session-2')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('2 / 5 sessions')
    expect(wrapper.findAll('[data-test="terminal-tab"]')).toHaveLength(2)
    expect(store.activeServerId).toBe('database')
    await wrapper
      .findAll('[data-test="terminal-tab"]')[0]
      ?.get('button')
      .trigger('click')
    expect(store.activeServerId).toBe('production')

    await wrapper
      .find('[data-test="close-terminal-production"]')
      .trigger('click')
    expect(sockets.get('production')?.disconnect).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-test="terminal-tab"]')).toHaveLength(1)
    expect(store.activeServerId).toBe('database')
  })
})
