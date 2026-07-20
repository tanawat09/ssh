<script setup lang="ts">
import { ApiErrorCode, type ServerDto } from '@remote/shared'
import { onMounted, ref } from 'vue'
import { SquareTerminal, Trash2, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { apiClient, ApiClientError } from '../lib/api-client'
import { useSessionStore } from '../stores/session'

const props = defineProps<{
  listServers?: () => Promise<ServerDto[]>
  deleteServer?: (serverId: string) => Promise<void>
}>()
const router = useRouter()
const session = useSessionStore()
const pending = ref(true)
const servers = ref<ServerDto[]>([])
const errorMessage = ref('')
const selectedServer = ref<ServerDto | null>(null)
const deletePending = ref(false)
const deleteError = ref('')

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

function openDeleteDialog(server: ServerDto): void {
  if (deletePending.value) return
  selectedServer.value = server
  deleteError.value = ''
}

function closeDeleteDialog(): void {
  if (deletePending.value) return
  selectedServer.value = null
  deleteError.value = ''
}

async function confirmDelete(): Promise<void> {
  const server = selectedServer.value
  if (server === null || deletePending.value) return

  deletePending.value = true
  deleteError.value = ''
  try {
    const operation = props.deleteServer ?? ((id) => apiClient.deleteServer(id))
    await session.runAuthenticated(() => operation(server.id))
    servers.value = servers.value.filter(({ id }) => id !== server.id)
    selectedServer.value = null
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      error.code === ApiErrorCode.SERVER_HAS_ACTIVE_SESSION
    ) {
      deleteError.value =
        'Disconnect the active terminal before deleting this server.'
    } else {
      deleteError.value =
        error instanceof Error ? error.message : 'Unable to delete server.'
    }
    if (error instanceof ApiClientError && error.status === 401) {
      await router.replace({ name: 'login' })
    }
  } finally {
    deletePending.value = false
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
          <div class="server-identity">
            <h2>{{ server.name }}</h2>
            <p>{{ server.username }}@{{ server.host }}:{{ server.port }}</p>
            <div class="server-row-actions">
              <RouterLink
                class="secondary-button connect-button"
                :to="{
                  name: 'terminals',
                  query: { server: server.id },
                }"
              >
                <SquareTerminal :size="16" aria-hidden="true" />
                Connect
              </RouterLink>
              <button
                class="icon-button server-delete-button"
                type="button"
                :title="`Delete ${server.name}`"
                :aria-label="`Delete ${server.name}`"
                :disabled="deletePending"
                @click="openDeleteDialog(server)"
              >
                <Trash2 :size="18" aria-hidden="true" />
              </button>
            </div>
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
    <div
      v-if="selectedServer"
      class="dialog-backdrop"
      @click.self="closeDeleteDialog"
      @keydown.esc="closeDeleteDialog"
    >
      <section
        class="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-server-title"
      >
        <button
          class="icon-button dialog-close"
          type="button"
          title="Cancel deletion"
          aria-label="Cancel deletion"
          :disabled="deletePending"
          @click="closeDeleteDialog"
        >
          <X :size="18" aria-hidden="true" />
        </button>
        <h2 id="delete-server-title">Delete {{ selectedServer.name }}?</h2>
        <p class="dialog-endpoint">
          {{ selectedServer.username }}@{{ selectedServer.host }}:{{
            selectedServer.port
          }}
        </p>
        <p v-if="deleteError" class="form-error">{{ deleteError }}</p>
        <div class="dialog-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="deletePending"
            @click="closeDeleteDialog"
          >
            Cancel
          </button>
          <button
            class="danger-button"
            type="button"
            :disabled="deletePending"
            @click="confirmDelete"
          >
            {{ deletePending ? 'Deleting...' : 'Delete server' }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
