import { ApiErrorCode, type ServerDto } from '@remote/shared'
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

function mountView(
  listServers: () => Promise<ServerDto[]>,
  deleteServer: (serverId: string) => Promise<void> = vi
    .fn<(serverId: string) => Promise<void>>()
    .mockResolvedValue(undefined),
) {
  return mount(ServerListView, {
    global: {
      plugins: [createPinia()],
      stubs: {
        RouterLink: { template: '<a v-bind="$attrs"><slot /></a>' },
      },
    },
    props: { listServers, deleteServer },
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  }
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

  it('opens one labelled confirmation dialog for the selected server', async () => {
    const staging = { ...server, id: 'server-2', name: 'Staging' }
    const wrapper = mountView(vi.fn().mockResolvedValue([server, staging]))
    await flushPromises()

    const deleteButton = wrapper.get('[aria-label="Delete Production"]')
    expect(deleteButton.attributes('title')).toBe('Delete Production')
    await deleteButton.trigger('click')

    const dialogs = wrapper.findAll('[role="dialog"]')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]?.attributes('aria-modal')).toBe('true')
    expect(dialogs[0]?.attributes('aria-labelledby')).toBe(
      'delete-server-title',
    )
    expect(dialogs[0]?.text()).toContain('Delete Production?')
    expect(dialogs[0]?.text()).toContain('deploy@server.example.com:22')
  })

  it('closes the confirmation dialog without deleting when cancelled', async () => {
    const deleteServer = vi.fn<(serverId: string) => Promise<void>>()
    const wrapper = mountView(vi.fn().mockResolvedValue([server]), deleteServer)
    await flushPromises()

    await wrapper.get('[aria-label="Delete Production"]').trigger('click')
    await wrapper.get('.confirmation-dialog .secondary-button').trigger('click')

    expect(deleteServer).not.toHaveBeenCalled()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Production')
  })

  it('disables dialog actions and prevents repeat deletion while pending', async () => {
    const deletion = deferred<undefined>()
    const deleteServer = vi
      .fn<(serverId: string) => Promise<void>>()
      .mockReturnValue(deletion.promise)
    const wrapper = mountView(vi.fn().mockResolvedValue([server]), deleteServer)
    await flushPromises()

    await wrapper.get('[aria-label="Delete Production"]').trigger('click')
    await wrapper.get('.danger-button').trigger('click')

    expect(deleteServer).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.danger-button').attributes()).toHaveProperty(
      'disabled',
    )
    expect(
      wrapper.get('.confirmation-dialog .secondary-button').attributes(),
    ).toHaveProperty('disabled')
    expect(wrapper.get('.dialog-close').attributes()).toHaveProperty('disabled')
    await wrapper.get('.danger-button').trigger('click')
    expect(deleteServer).toHaveBeenCalledTimes(1)

    deletion.resolve(undefined)
    await flushPromises()
  })

  it('removes only the deleted server after a successful response', async () => {
    const staging = {
      ...server,
      id: 'server-2',
      name: 'Staging',
      host: 'staging.example.com',
    }
    const deleteServer = vi
      .fn<(serverId: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const wrapper = mountView(
      vi.fn().mockResolvedValue([server, staging]),
      deleteServer,
    )
    await flushPromises()

    await wrapper.get('[aria-label="Delete Production"]').trigger('click')
    await wrapper.get('.danger-button').trigger('click')
    await flushPromises()

    expect(deleteServer).toHaveBeenCalledWith('server-id')
    expect(wrapper.text()).not.toContain('Production')
    expect(wrapper.text()).toContain('Staging')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('keeps the server and explains how to resolve an active-session conflict', async () => {
    const deleteServer = vi
      .fn<(serverId: string) => Promise<void>>()
      .mockRejectedValue(
        new ApiClientError(
          409,
          ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
          'Server has an active terminal session',
        ),
      )
    const wrapper = mountView(vi.fn().mockResolvedValue([server]), deleteServer)
    await flushPromises()

    await wrapper.get('[aria-label="Delete Production"]').trigger('click')
    await wrapper.get('.danger-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(
      'Disconnect the active terminal before deleting this server.',
    )
    expect(wrapper.get('.server-row').text()).toContain('Production')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('redirects after an unauthenticated delete without removing the server', async () => {
    replaceRoute.mockClear()
    const deleteServer = vi
      .fn<(serverId: string) => Promise<void>>()
      .mockRejectedValue(
        new ApiClientError(
          401,
          ApiErrorCode.UNAUTHENTICATED,
          'Authentication required',
        ),
      )
    const wrapper = mountView(vi.fn().mockResolvedValue([server]), deleteServer)
    await flushPromises()

    await wrapper.get('[aria-label="Delete Production"]').trigger('click')
    await wrapper.get('.danger-button').trigger('click')
    await flushPromises()

    expect(replaceRoute).toHaveBeenCalledWith({ name: 'login' })
    expect(wrapper.get('.server-row').text()).toContain('Production')
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
