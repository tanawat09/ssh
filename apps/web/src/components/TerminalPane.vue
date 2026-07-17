<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useTerminalSessionsStore } from '../stores/terminal-sessions'

const props = defineProps<{
  serverId: string
  active: boolean
}>()

const terminalHost = ref<HTMLElement | null>(null)
const sessions = useTerminalSessionsStore()
let terminal: Terminal | undefined
let fitAddon: FitAddon | undefined
let resizeObserver: ResizeObserver | undefined
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribeOutput: (() => void) | undefined
let disposeInput: (() => void) | undefined

function fitTerminal(): void {
  if (!props.active || terminal === undefined || fitAddon === undefined) return
  fitAddon.fit()
  terminal.focus()
  const dimensions = fitAddon.proposeDimensions()
  if (dimensions !== undefined) {
    sessions.resize(
      props.serverId,
      Math.min(400, Math.max(20, dimensions.cols)),
      Math.min(200, Math.max(5, dimensions.rows)),
    )
  }
}

function scheduleFit(): void {
  if (resizeTimer !== undefined) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(fitTerminal, 50)
}

onMounted(() => {
  if (terminalHost.value === null) return
  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    fontSize: 14,
    scrollback: 5_000,
    theme: {
      background: '#171c22',
      foreground: '#d9e0e5',
      cursor: '#88c7a7',
      selectionBackground: '#315d4a',
    },
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalHost.value)
  const input = terminal.onData((data) =>
    sessions.sendInput(props.serverId, data),
  )
  disposeInput = () => input.dispose()
  unsubscribeOutput = sessions.subscribeOutput(props.serverId, (data) =>
    terminal?.write(data),
  )
  resizeObserver = new ResizeObserver(scheduleFit)
  resizeObserver.observe(terminalHost.value)
  scheduleFit()
})

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    scheduleFit()
  },
)

onBeforeUnmount(() => {
  if (resizeTimer !== undefined) clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  unsubscribeOutput?.()
  disposeInput?.()
  terminal?.dispose()
})
</script>

<template>
  <div
    ref="terminalHost"
    class="terminal-host"
    role="application"
    :aria-label="`SSH terminal for ${serverId}`"
  ></div>
</template>
