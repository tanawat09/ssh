<script setup lang="ts">
import type { ServerDto } from '@remote/shared'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { apiClient, ApiClientError } from '../lib/api-client'
import { useSessionStore } from '../stores/session'

const props = defineProps<{
  listServers?: () => Promise<ServerDto[]>
}>()
const router = useRouter()
const session = useSessionStore()
const pending = ref(true)
const servers = ref<ServerDto[]>([])
const errorMessage = ref('')

async function loadServers(): Promise<void> {
  if (pending.value && servers.value.length > 0) return
  pending.value = true
  errorMessage.value = ''
  try {
    const operation = props.listServers ?? (() => apiClient.listServers())
    servers.value = await session.runAuthenticated(operation)
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Unable to load servers.'
    if (error instanceof ApiClientError && error.status === 401) {
      await router.replace({ name: 'login' })
    }
  } finally {
    pending.value = false
  }
}

onMounted(loadServers)
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">Remote Admin</p>
        <h1>Servers</h1>
      </div>
      <div class="header-actions">
        <span v-if="session.user" class="session-user">
          {{ session.user.username }}
        </span>
        <RouterLink class="primary-button header-button" to="/servers/new">
          Create server
        </RouterLink>
      </div>
    </header>
    <section class="server-list" aria-live="polite" aria-atomic="true">
      <p v-if="pending" class="status-message">Loading servers...</p>
      <div v-else-if="errorMessage" class="list-error">
        <p class="form-error">{{ errorMessage }}</p>
        <button class="secondary-button" type="button" @click="loadServers">
          Try again
        </button>
      </div>
      <p v-else-if="servers.length === 0" class="empty-message">
        No servers yet.
      </p>
      <div v-else class="server-rows">
        <article v-for="server in servers" :key="server.id" class="server-row">
          <div>
            <h2>{{ server.name }}</h2>
            <p>{{ server.username }}@{{ server.host }}:{{ server.port }}</p>
          </div>
          <dl>
            <div>
              <dt>Authentication</dt>
              <dd>
                {{
                  server.authType === 'privateKey' ? 'Private key' : 'Password'
                }}
              </dd>
            </div>
            <div>
              <dt>Host key</dt>
              <dd>{{ server.hostKeyAlgorithm }}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd class="fingerprint">{{ server.hostKeyFingerprint }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  </main>
</template>
