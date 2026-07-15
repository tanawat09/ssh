import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SecretInput from './SecretInput.vue'

describe('SecretInput', () => {
  it('toggles visibility with an accessible icon button', async () => {
    const wrapper = mount(SecretInput, {
      props: { id: 'password', label: 'Password', modelValue: 'secret' },
    })

    expect(wrapper.get('input').attributes('type')).toBe('password')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Show password')
    expect(wrapper.get('button').attributes('title')).toBe('Show password')

    await wrapper.get('button').trigger('click')

    expect(wrapper.get('input').attributes('type')).toBe('text')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Hide password')
  })

  it('forwards required semantics and describes its field error', () => {
    const wrapper = mount(SecretInput, {
      props: {
        id: 'password',
        label: 'Password',
        modelValue: '',
        required: true,
        error: 'Enter a password',
      },
    })

    expect(wrapper.get('input').attributes('required')).toBeDefined()
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('input').attributes('aria-describedby')).toBe(
      'password-error',
    )
    expect(wrapper.get('#password-error').text()).toBe('Enter a password')
  })
})
