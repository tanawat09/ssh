<script setup lang="ts">
import type { LoginRequest } from '@remote/shared'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import SecretInput from '../components/SecretInput.vue'
import { ApiClientError } from '../lib/api-client'
import { useSessionStore } from '../stores/session'

const props = defineProps<{
  login?: (request: LoginRequest) => Promise<void>
}>()
const router = useRouter()
const session = useSessionStore()
const username = ref('')
const password = ref('')
const pending = ref(false)
const errorMessage = ref('')

async function submit(): Promise<void> {
  if (pending.value) return
  pending.value = true
  errorMessage.value = ''
  const request = { username: username.value, password: password.value }
  try {
    await (props.login ?? session.login)(request)
    await router.push({ name: 'create-server' })
  } catch (error) {
    errorMessage.value =
      error instanceof ApiClientError || error instanceof Error
        ? error.message
        : 'Sign in failed. Please try again.'
  } finally {
    password.value = ''
    pending.value = false
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-panel" aria-labelledby="login-title">
      <div class="section-heading">
        <p class="eyebrow">Remote Admin</p>
        <h1 id="login-title">Sign in</h1>
        <p>Use your administrator credentials.</p>
      </div>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="username">Username</label>
          <input
            id="username"
            v-model="username"
            autocomplete="username"
            required
          />
        </div>
        <SecretInput
          id="login-password"
          v-model="password"
          label="Password"
          autocomplete="current-password"
        />
        <p v-if="errorMessage" role="alert" class="form-error">
          {{ errorMessage }}
        </p>
        <button class="primary-button" type="submit" :disabled="pending">
          {{ pending ? 'Signing in...' : 'Sign in' }}
        </button>
      </form>
    </section>
  </main>
</template>
