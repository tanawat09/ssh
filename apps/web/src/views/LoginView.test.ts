import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import LoginView from './LoginView.vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('LoginView', () => {
  it('disables a stable submit command while login is pending', async () => {
    let resolveLogin: (() => void) | undefined
    const login = vi
      .fn()
      .mockReturnValue(new Promise<void>((resolve) => (resolveLogin = resolve)))
    const wrapper = mount(LoginView, {
      global: { plugins: [createPinia()] },
      props: { login },
    })

    await wrapper.get('#username').setValue('admin')
    await wrapper.get('#login-password').setValue('secret')
    await wrapper.get('form').trigger('submit')

    expect(
      wrapper.get('button[type="submit"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.get('button[type="submit"]').text()).toBe('Signing in...')
    resolveLogin?.()
  })

  it('renders the login failure and clears the password', async () => {
    const login = vi
      .fn()
      .mockRejectedValue(new Error('Invalid username or password'))
    const wrapper = mount(LoginView, {
      global: { plugins: [createPinia()] },
      props: { login },
    })

    await wrapper.get('#username').setValue('admin')
    await wrapper.get('#login-password').setValue('wrong')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Invalid username or password',
    )
    expect(
      (wrapper.get('#login-password').element as HTMLInputElement).value,
    ).toBe('')
  })
})
