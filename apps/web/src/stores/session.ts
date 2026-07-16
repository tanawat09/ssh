import type { LoginRequest, SessionDto } from '@remote/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { apiClient, ApiClientError } from '../lib/api-client'

interface LoginApi {
  login(request: LoginRequest): Promise<SessionDto>
}

interface SessionApi {
  session(): Promise<SessionDto>
}

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionDto['user'] | null>(null)
  const isAuthenticated = computed(() => user.value !== null)

  async function login(
    request: LoginRequest,
    api: LoginApi = apiClient,
  ): Promise<void> {
    const session = await api.login(request)
    user.value = session.user
  }

  async function restore(api: SessionApi = apiClient): Promise<void> {
    try {
      user.value = (await api.session()).user
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401)
        user.value = null
      else throw error
    }
  }

  function clear(): void {
    user.value = null
  }

  async function runAuthenticated<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) clear()
      throw error
    }
  }

  function routeFor(meta: {
    requiresAuth?: unknown
  }): true | { name: 'login' } {
    return meta.requiresAuth === true && !isAuthenticated.value
      ? { name: 'login' }
      : true
  }

  return {
    user,
    isAuthenticated,
    login,
    restore,
    clear,
    runAuthenticated,
    routeFor,
  }
})
