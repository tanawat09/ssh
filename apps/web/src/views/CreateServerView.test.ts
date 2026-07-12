import type { ServerDto } from '@remote/shared'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { ApiClientError } from '../lib/api-client'
import CreateServerView from './CreateServerView.vue'

const { replaceRoute } = vi.hoisted(() => ({ replaceRoute: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: replaceRoute }) }))

const savedServer: ServerDto = {
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

interface FieldWrapper {
  get(selector: string): { setValue(value: string): Promise<void> }
}

async function fillPublicFields(wrapper: FieldWrapper) {
  await wrapper.get('#name').setValue('Production')
  await wrapper.get('#host').setValue('server.example.com')
  await wrapper.get('#username').setValue('deploy')
}

describe('CreateServerView', () => {
  it('shows only fields for the selected authentication mode', async () => {
    const wrapper = mount(CreateServerView, {
      global: { plugins: [createPinia()] },
    })

    expect(wrapper.find('#server-password').exists()).toBe(true)
    expect(wrapper.find('#private-key').exists()).toBe(false)

    await wrapper.get('[role="radio"][value="privateKey"]').setValue()

    expect(wrapper.find('#server-password').exists()).toBe(false)
    expect(wrapper.find('#private-key').exists()).toBe(true)
    expect(wrapper.find('#passphrase').exists()).toBe(true)
  })

  it('shows field errors and clears secrets while retaining public fields after failure', async () => {
    const createServer = vi.fn().mockRejectedValue(
      new ApiClientError(
        400,
        'INVALID_REQUEST',
        'Check the highlighted fields',
        {
          host: 'Enter a valid host',
        },
      ),
    )
    const wrapper = mount(CreateServerView, {
      global: { plugins: [createPinia()] },
      props: { createServer },
    })
    await fillPublicFields(wrapper)
    await wrapper.get('#server-password').setValue('secret')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('#host-error').text()).toBe('Enter a valid host')
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Check the highlighted fields',
    )
    expect(
      (wrapper.get('#server-password').element as HTMLInputElement).value,
    ).toBe('')
    expect((wrapper.get('#name').element as HTMLInputElement).value).toBe(
      'Production',
    )
    expect((wrapper.get('#host').element as HTMLInputElement).value).toBe(
      'server.example.com',
    )
    expect((wrapper.get('#username').element as HTMLInputElement).value).toBe(
      'deploy',
    )
  })

  it('keeps the submit state stable and displays only non-secret result data', async () => {
    let resolveCreate: ((value: ServerDto) => void) | undefined
    const createServer = vi
      .fn()
      .mockReturnValue(
        new Promise<ServerDto>((resolve) => (resolveCreate = resolve)),
      )
    const wrapper = mount(CreateServerView, {
      global: { plugins: [createPinia()] },
      props: { createServer },
    })
    await fillPublicFields(wrapper)
    await wrapper.get('#server-password').setValue('secret')

    await wrapper.get('form').trigger('submit')
    expect(
      wrapper.get('button[type="submit"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.get('button[type="submit"]').text()).toBe(
      'Testing connection...',
    )

    resolveCreate?.(savedServer)
    await flushPromises()

    expect(wrapper.get('[aria-live="polite"]').text()).toContain(
      'SHA256:fingerprint',
    )
    expect(wrapper.text()).not.toContain('secret')
    expect(
      (wrapper.get('#server-password').element as HTMLInputElement).value,
    ).toBe('')
  })

  it('returns to login when the session cookie is rejected', async () => {
    replaceRoute.mockClear()
    const createServer = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(401, 'UNAUTHENTICATED', 'Authentication required'),
      )
    const wrapper = mount(CreateServerView, {
      global: { plugins: [createPinia()] },
      props: { createServer },
    })
    await fillPublicFields(wrapper)
    await wrapper.get('#server-password').setValue('secret')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(replaceRoute).toHaveBeenCalledWith({ name: 'login' })
  })
})
