<script setup lang="ts">
import type { CreateServerRequest, ServerDto } from '@remote/shared'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import SecretInput from '../components/SecretInput.vue'
import { apiClient, ApiClientError } from '../lib/api-client'
import { useSessionStore } from '../stores/session'

const props = defineProps<{
  createServer?: (request: CreateServerRequest) => Promise<ServerDto>
}>()
const router = useRouter()
const session = useSessionStore()
const name = ref('')
const host = ref('')
const port = ref(22)
const username = ref('')
const authType = ref<'password' | 'privateKey'>('password')
const password = ref('')
const privateKey = ref('')
const passphrase = ref('')
const pending = ref(false)
const fieldErrors = ref<Readonly<Record<string, string>>>({})
const errorMessage = ref('')
const savedServer = ref<ServerDto | null>(null)

async function submit(): Promise<void> {
  if (pending.value) return
  pending.value = true
  fieldErrors.value = {}
  errorMessage.value = ''
  savedServer.value = null
  const common = {
    name: name.value,
    host: host.value,
    port: port.value,
    username: username.value,
  }
  const request: CreateServerRequest =
    authType.value === 'password'
      ? { ...common, authType: 'password', password: password.value }
      : {
          ...common,
          authType: 'privateKey',
          privateKey: privateKey.value,
          ...(passphrase.value === '' ? {} : { passphrase: passphrase.value }),
        }
  try {
    const operation =
      props.createServer ?? ((payload) => apiClient.createServer(payload))
    savedServer.value = await session.runAuthenticated(() => operation(request))
  } catch (error) {
    if (error instanceof ApiClientError) fieldErrors.value = error.fields ?? {}
    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Server creation failed. Please try again.'
    if (error instanceof ApiClientError && error.status === 401) {
      await router.replace({ name: 'login' })
    }
  } finally {
    password.value = ''
    privateKey.value = ''
    passphrase.value = ''
    pending.value = false
  }
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">Remote Admin</p>
        <h1>Create server</h1>
      </div>
      <RouterLink class="back-link" to="/servers">Back to servers</RouterLink>
      <span v-if="session.user" class="session-user">{{
        session.user.username
      }}</span>
    </header>
    <div class="content-grid">
      <form class="server-form" @submit.prevent="submit">
        <div class="field">
          <label for="name">Name</label>
          <input
            id="name"
            v-model="name"
            required
            :aria-invalid="fieldErrors.name ? 'true' : undefined"
            :aria-describedby="fieldErrors.name ? 'name-error' : undefined"
          />
          <p v-if="fieldErrors.name" id="name-error" class="field-error">
            {{ fieldErrors.name }}
          </p>
        </div>
        <div class="connection-grid">
          <div class="field host-field">
            <label for="host">Host</label>
            <input
              id="host"
              v-model="host"
              required
              :aria-invalid="fieldErrors.host ? 'true' : undefined"
              :aria-describedby="fieldErrors.host ? 'host-error' : undefined"
            />
            <p v-if="fieldErrors.host" id="host-error" class="field-error">
              {{ fieldErrors.host }}
            </p>
          </div>
          <div class="field port-field">
            <label for="port">Port</label>
            <input
              id="port"
              v-model.number="port"
              type="number"
              min="1"
              max="65535"
              required
              :aria-invalid="fieldErrors.port ? 'true' : undefined"
              :aria-describedby="fieldErrors.port ? 'port-error' : undefined"
            />
            <p v-if="fieldErrors.port" id="port-error" class="field-error">
              {{ fieldErrors.port }}
            </p>
          </div>
        </div>
        <div class="field">
          <label for="username">SSH username</label>
          <input
            id="username"
            v-model="username"
            autocomplete="username"
            required
            :aria-invalid="fieldErrors.username ? 'true' : undefined"
            :aria-describedby="
              fieldErrors.username ? 'username-error' : undefined
            "
          />
          <p
            v-if="fieldErrors.username"
            id="username-error"
            class="field-error"
          >
            {{ fieldErrors.username }}
          </p>
        </div>
        <fieldset class="auth-fieldset">
          <legend>Authentication</legend>
          <div class="segmented-control">
            <label>
              <input
                v-model="authType"
                type="radio"
                role="radio"
                value="password"
              />
              <span>Password</span>
            </label>
            <label>
              <input
                v-model="authType"
                type="radio"
                role="radio"
                value="privateKey"
              />
              <span>Private key</span>
            </label>
          </div>
        </fieldset>
        <SecretInput
          v-if="authType === 'password'"
          id="server-password"
          v-model="password"
          label="Password"
          autocomplete="new-password"
          :error="fieldErrors.password"
          required
        />
        <template v-else>
          <div class="field">
            <label for="private-key">Private key</label>
            <textarea
              id="private-key"
              v-model="privateKey"
              rows="7"
              autocomplete="off"
              spellcheck="false"
              required
              :aria-invalid="fieldErrors.privateKey ? 'true' : undefined"
              :aria-describedby="
                fieldErrors.privateKey ? 'private-key-error' : undefined
              "
            />
            <p
              v-if="fieldErrors.privateKey"
              id="private-key-error"
              class="field-error"
            >
              {{ fieldErrors.privateKey }}
            </p>
          </div>
          <SecretInput
            id="passphrase"
            v-model="passphrase"
            label="Passphrase"
            :error="fieldErrors.passphrase"
          />
        </template>
        <button class="primary-button" type="submit" :disabled="pending">
          {{ pending ? 'Testing connection...' : 'Test & Save' }}
        </button>
      </form>
      <aside
        data-testid="status-region"
        class="status-region"
        :class="{ 'result-panel': savedServer }"
        aria-live="polite"
        aria-atomic="true"
      >
        <p v-if="pending" class="status-message">Testing connection...</p>
        <p v-else-if="errorMessage" class="form-error">{{ errorMessage }}</p>
        <template v-else-if="savedServer">
          <p class="status-label">Server saved</p>
          <h2>{{ savedServer.name }}</h2>
          <dl>
            <div>
              <dt>Endpoint</dt>
              <dd>
                {{ savedServer.username }}@{{ savedServer.host }}:{{
                  savedServer.port
                }}
              </dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>
                {{
                  savedServer.authType === 'privateKey'
                    ? 'Private key'
                    : 'Password'
                }}
              </dd>
            </div>
            <div>
              <dt>Host key</dt>
              <dd>{{ savedServer.hostKeyAlgorithm }}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd class="fingerprint">{{ savedServer.hostKeyFingerprint }}</dd>
            </div>
          </dl>
        </template>
      </aside>
    </div>
  </main>
</template>
