<script setup lang="ts">
import type { ServerDto } from '@remote/shared'
import {
  ArrowLeft,
  Menu,
  Server as ServerIcon,
  SquareTerminal,
  X,
} from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TerminalPane from '../components/TerminalPane.vue'
import { apiClient, ApiClientError } from '../lib/api-client'
import { useSessionStore } from '../stores/session'
import { useTerminalSessionsStore } from '../stores/terminal-sessions'

const props = defineProps<{
  listServers?: () => Promise<ServerDto[]>
  connectServer?: (server: ServerDto) => boolean
}>()

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const terminals = useTerminalSessionsStore()
const servers = ref<ServerDto[]>([])
const pending = ref(true)
const errorMessage = ref('')
const sidebarOpen = ref(true)

function openServer(server: ServerDto): void {
  const connect = props.connectServer ?? ((value) => terminals.connect(value))
  connect(server)
  sidebarOpen.value = false
}

async function loadServers(): Promise<void> {
  pending.value = true
  errorMessage.value = ''
  try {
    const operation = props.listServers ?? (() => apiClient.listServers())
    servers.value = await session.runAuthenticated(operation)
    const initialServerId = route.query.server
    if (typeof initialServerId === 'string') {
      const initialServer = servers.value.find(
        ({ id }) => id === initialServerId,
      )
      if (initialServer !== undefined) openServer(initialServer)
    }
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
onBeforeUnmount(() => terminals.disconnectAll())
</script>

<template>
  <main class="terminal-workspace">
    <header class="terminal-header">
      <div class="terminal-brand">
        <button
          class="workspace-icon-button mobile-sidebar-toggle"
          type="button"
          title="Toggle servers"
          aria-label="Toggle server list"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Menu :size="20" aria-hidden="true" />
        </button>
        <SquareTerminal :size="21" aria-hidden="true" />
        <strong>Remote Admin</strong>
      </div>
      <div class="terminal-header-actions">
        <span class="session-counter">
          {{ terminals.tabs.length }} / 5 sessions
        </span>
        <RouterLink class="workspace-back-link" to="/servers">
          <ArrowLeft :size="16" aria-hidden="true" />
          Servers
        </RouterLink>
      </div>
    </header>

    <div class="terminal-layout">
      <aside class="server-sidebar" :class="{ 'is-open': sidebarOpen }">
        <div class="sidebar-heading">
          <span>Servers</span>
          <span>{{ servers.length }}</span>
        </div>
        <p v-if="pending" class="sidebar-status">Loading servers...</p>
        <div v-else-if="errorMessage" class="sidebar-error">
          <p>{{ errorMessage }}</p>
          <button type="button" class="sidebar-retry" @click="loadServers">
            Try again
          </button>
        </div>
        <p v-else-if="servers.length === 0" class="sidebar-status">
          No servers yet.
        </p>
        <div v-else class="sidebar-server-list">
          <button
            v-for="server in servers"
            :key="server.id"
            class="sidebar-server"
            :class="{
              active: terminals.activeServerId === server.id,
              connected: terminals.tabs.some(
                (tab) => tab.server.id === server.id,
              ),
            }"
            type="button"
            data-test="connect-server"
            :disabled="
              terminals.tabs.length >= 5 &&
              !terminals.tabs.some((tab) => tab.server.id === server.id)
            "
            @click="openServer(server)"
          >
            <ServerIcon :size="17" aria-hidden="true" />
            <span>
              <strong>{{ server.name }}</strong>
              <small>{{ server.username }}@{{ server.host }}</small>
            </span>
            <i aria-hidden="true"></i>
          </button>
        </div>
        <p v-if="terminals.lastError" class="sidebar-limit-error">
          {{ terminals.lastError }}
        </p>
      </aside>

      <section class="terminal-surface">
        <nav
          v-if="terminals.tabs.length > 0"
          class="terminal-tabs"
          aria-label="Active terminals"
        >
          <div
            v-for="tab in terminals.tabs"
            :key="tab.server.id"
            class="terminal-tab"
            :class="{ active: terminals.activeServerId === tab.server.id }"
            data-test="terminal-tab"
          >
            <button type="button" @click="terminals.activate(tab.server.id)">
              <span class="terminal-status-dot" :class="tab.status"></span>
              {{ tab.server.name }}
            </button>
            <button
              class="close-terminal-button"
              type="button"
              :title="`Disconnect ${tab.server.name}`"
              :aria-label="`Disconnect ${tab.server.name}`"
              :data-test="`close-terminal-${tab.server.id}`"
              @click="terminals.disconnect(tab.server.id)"
            >
              <X :size="14" aria-hidden="true" />
            </button>
          </div>
        </nav>

        <div v-if="terminals.tabs.length === 0" class="terminal-empty-state">
          <SquareTerminal :size="34" aria-hidden="true" />
          <h1>Select a server</h1>
          <p>Open a saved SSH connection from the server list.</p>
        </div>
        <div v-else class="terminal-panes">
          <div
            v-for="tab in terminals.tabs"
            :key="tab.server.id"
            v-show="terminals.activeServerId === tab.server.id"
            class="terminal-pane-shell"
          >
            <TerminalPane
              :server-id="tab.server.id"
              :active="terminals.activeServerId === tab.server.id"
            />
            <div
              v-if="tab.status === 'connecting'"
              class="terminal-state-banner"
            >
              Connecting to {{ tab.server.name }}...
            </div>
            <div
              v-else-if="tab.status === 'error' || tab.status === 'closed'"
              class="terminal-state-banner error"
            >
              {{ tab.errorMessage }}
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
