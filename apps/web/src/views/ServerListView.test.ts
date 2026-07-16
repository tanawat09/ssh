import type { ServerDto } from '@remote/shared'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { ApiClientError } from '../lib/api-client'
import ServerListView from './ServerListView.vue'

const { replaceRoute } = vi.hoisted(() => ({ replaceRoute: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: replaceRoute }) }))

const server: ServerDto = {
  id: 'server-id',
  name: 'Production',
  host: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyFingerprint: 'SHA256:fingerprint',
  createdAt: '2026-07-12T03:00:00.000Z',
  updatedAt: '2026-07-12T03:00:00.000Z',
}

function mountView(listServers: () => Promise<ServerDto[]>) {
  return mount(ServerListView, {
    global: {
      plugins: [createPinia()],
      stubs: {
        RouterLink: { template: '<a v-bind="$attrs"><slot /></a>' },
      },
    },
    props: { listServers },
  })
}

describe('ServerListView', () => {
  it('shows loading state while the list request is pending', async () => {
    let resolve: ((value: ServerDto[]) => void) | undefined
    const listServers = vi.fn(
      () => new Promise<ServerDto[]>((done) => (resolve = done)),
    )
    const wrapper = mountView(listServers)

    expect(wrapper.text()).toContain('Loading servers...')
    resolve?.([])
    await flushPromises()
    expect(wrapper.text()).toContain('No servers yet.')
  })

  it('shows an empty state when no servers exist', async () => {
    const wrapper = mountView(vi.fn().mockResolvedValue([]))
    await flushPromises()
    expect(wrapper.text()).toContain('No servers yet.')
    expect(wrapper.find('.server-row').exists()).toBe(false)
  })

  it('links to the create-server route', async () => {
    const wrapper = mountView(vi.fn().mockResolvedValue([]))
    await flushPromises()
    expect(wrapper.get('a').attributes('to')).toBe('/servers/new')
  })

  it('renders public server fields without credential-like data', async () => {
    const wrapper = mountView(vi.fn().mockResolvedValue([server]))
    await flushPromises()
    expect(wrapper.text()).toContain('Production')
    expect(wrapper.text()).toContain('deploy@server.example.com:22')
    expect(wrapper.text()).toContain('SHA256:fingerprint')
    expect(wrapper.text()).not.toMatch(
      /privateKey|private key material|passphrase|encryptedCredential/i,
    )
    expect(wrapper.text()).not.toContain('encryptedCredential')
  })

  it('shows an error and retries the request', async () => {
    const listServers = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unable to load servers.'))
      .mockResolvedValueOnce([server])
    const wrapper = mountView(listServers)
    await flushPromises()
    expect(wrapper.text()).toContain('Unable to load servers.')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(listServers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Production')
  })

  it('redirects to login when the session cookie is rejected', async () => {
    replaceRoute.mockClear()
    const listServers = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(401, 'UNAUTHENTICATED', 'Authentication required'),
      )
    const wrapper = mountView(listServers)
    await flushPromises()
    expect(replaceRoute).toHaveBeenCalledWith({ name: 'login' })
    expect(wrapper.text()).toContain('Authentication required')
  })
})
