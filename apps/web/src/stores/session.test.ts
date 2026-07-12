import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from '../lib/api-client'
import { useSessionStore } from './session'

describe('session store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('authenticates only after login succeeds without storing a token', async () => {
    const api = {
      login: vi
        .fn()
        .mockResolvedValue({ user: { username: 'admin', role: 'admin' } }),
    }
    const store = useSessionStore()

    await store.login({ username: 'admin', password: 'secret' }, api)

    expect(store.user).toEqual({ username: 'admin', role: 'admin' })
    expect(store.isAuthenticated).toBe(true)
    expect('token' in store.$state).toBe(false)
  })

  it('clears the session after a protected request returns 401', async () => {
    const store = useSessionStore()
    store.user = { username: 'admin', role: 'admin' }
    const operation = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(401, 'UNAUTHENTICATED', 'Authentication required'),
      )

    await expect(store.runAuthenticated(operation)).rejects.toMatchObject({
      status: 401,
    })
    expect(store.user).toBeNull()
  })

  it('redirects unauthenticated protected navigation to login', () => {
    const store = useSessionStore()

    expect(store.routeFor({ requiresAuth: true })).toEqual({ name: 'login' })
    expect(store.routeFor({ requiresAuth: false })).toBe(true)
  })
})
