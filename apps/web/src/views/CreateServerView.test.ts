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
  await wrapper.get('#port').setValue('2202')
  await wrapper.get('#username').setValue('deploy')
}

describe('CreateServerView', () => {
  it('shows only fields for the selected authentication mode', async () => {
    const wrapper = mount(CreateServerView, {
      global: { plugins: [createPinia()] },
    })

    expect(wrapper.find('#server-password').exists()).toBe(true)
    expect(wrapper.get('#server-password').attributes('required')).toBeDefined()
    expect(wrapper.find('#private-key').exists()).toBe(false)

    await wrapper.get('[role="radio"][value="privateKey"]').setValue()

    expect(wrapper.find('#server-password').exists()).toBe(false)
    expect(wrapper.find('#private-key').exists()).toBe(true)
    expect(wrapper.find('#passphrase').exists()).toBe(true)
    expect(wrapper.get('#private-key').attributes('required')).toBeDefined()
    expect(wrapper.get('#passphrase').attributes('required')).toBeUndefined()
  })

  it('renders and describes all password-form field errors', async () => {
    const createServer = vi.fn().mockRejectedValue(
      new ApiClientError(
        400,
        'INVALID_REQUEST',
        'Check the highlighted fields',
        {
          name: 'Enter a name',
          host: 'Enter a valid host',
          port: 'Enter a valid port',
          username: 'Enter a username',
          password: 'Enter a password',
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

    const errorAssociations = [
      ['name', 'name-error'],
      ['host', 'host-error'],
      ['port', 'port-error'],
      ['username', 'username-error'],
      ['server-password', 'server-password-error'],
    ] as const
    for (const [controlId, errorId] of errorAssociations) {
      expect(wrapper.get(`#${controlId}`).attributes('aria-invalid')).toBe(
        'true',
      )
      expect(wrapper.get(`#${controlId}`).attributes('aria-describedby')).toBe(
        errorId,
      )
      expect(wrapper.get(`#${errorId}`).text()).not.toBe('')
    }
    expect(wrapper.get('[data-testid="status-region"]').text()).toContain(
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
    expect((wrapper.get('#port').element as HTMLInputElement).value).toBe(
      '2202',
    )
  })

  it('describes private-key errors and clears key and passphrase while retaining public fields', async () => {
    const createServer = vi.fn().mockRejectedValue(
      new ApiClientError(400, 'INVALID_REQUEST', 'Check private key fields', {
        privateKey: 'Enter a valid private key',
        passphrase: 'Passphrase is not valid',
      }),
    )
    const wrapper = mount(CreateServerView, {
      global: { plugins: [createPinia()] },
      props: { createServer },
    })
    await fillPublicFields(wrapper)
    await wrapper.get('[role="radio"][value="privateKey"]').setValue()
    await wrapper.get('#private-key').setValue('private material')
    await wrapper.get('#passphrase').setValue('key secret')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('#private-key').attributes('aria-describedby')).toBe(
      'private-key-error',
    )
    expect(wrapper.get('#passphrase').attributes('aria-describedby')).toBe(
      'passphrase-error',
    )
    expect(
      (wrapper.get('#private-key').element as HTMLTextAreaElement).value,
    ).toBe('')
    expect((wrapper.get('#passphrase').element as HTMLInputElement).value).toBe(
      '',
    )
    expect((wrapper.get('#name').element as HTMLInputElement).value).toBe(
      'Production',
    )
    expect((wrapper.get('#host').element as HTMLInputElement).value).toBe(
      'server.example.com',
    )
    expect((wrapper.get('#port').element as HTMLInputElement).value).toBe(
      '2202',
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

    const statusRegion = wrapper.get('[data-testid="status-region"]').element

    await wrapper.get('form').trigger('submit')
    expect(
      wrapper.get('button[type="submit"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.get('button[type="submit"]').text()).toBe(
      'Testing connection...',
    )
    expect(wrapper.get('[data-testid="status-region"]').element).toBe(
      statusRegion,
    )
    expect(
      wrapper.get('[data-testid="status-region"]').attributes('aria-atomic'),
    ).toBe('true')
    expect(wrapper.get('[data-testid="status-region"]').text()).toContain(
      'Testing connection',
    )

    resolveCreate?.(savedServer)
    await flushPromises()

    expect(wrapper.get('[data-testid="status-region"]').element).toBe(
      statusRegion,
    )
    expect(wrapper.get('[data-testid="status-region"]').text()).toContain(
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
