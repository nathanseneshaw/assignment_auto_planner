<script setup>
/**
 * Desktop auto-update button. Renders only inside the Electron app and only
 * once there's something to show:
 *   - available  → "Update" button; click downloads the new version
 *   - downloading → live percentage, disabled
 *   - downloaded  → auto-installs (relaunches into the new version)
 *   - error (only after a click) → "retry"
 *
 * Web build / browser: window.electronAPI is undefined, so this is inert.
 * Dev Electron run: checks resolve to {status:'dev'}, so the button stays hidden
 * (electron-updater only works in a packaged, published build).
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { isElectron } from '../../lib/platform'

const api = typeof window !== 'undefined' ? window.electronAPI?.updates : null

const status = ref('idle') // idle | available | downloading | downloaded | error
const version = ref('')
const percent = ref(0)
let unsubscribe = null

function apply(payload) {
  if (!payload) return
  switch (payload.status) {
    case 'available':
      status.value = 'available'
      version.value = payload.version || ''
      break
    case 'downloading':
      status.value = 'downloading'
      if (typeof payload.percent === 'number') percent.value = payload.percent
      break
    case 'downloaded':
      // Don't auto-install here — the main process shows a native "Restart now?"
      // dialog, and the button below offers the same. Avoids a double restart.
      status.value = 'downloaded'
      break
    case 'error':
      // Only surface errors the user can act on (i.e. a download they started).
      // Check-time errors (offline, no release yet) stay silent — button hidden.
      if (status.value === 'downloading') status.value = 'error'
      break
    default:
      // not-available / checked / dev / idle → nothing to show
      break
  }
}

async function startUpdate() {
  if (status.value !== 'available') return
  status.value = 'downloading'
  percent.value = 0
  const r = await api?.download()
  if (r?.status === 'error') status.value = 'error'
}

async function installUpdate() {
  await api?.install()
}

async function retry() {
  status.value = 'idle'
  await api?.check()
}

const show = computed(
  () => isElectron && !!api && ['available', 'downloading', 'downloaded', 'error'].includes(status.value),
)

const label = 'Update Available'

onMounted(async () => {
  if (!isElectron || !api) return
  unsubscribe = api.onEvent(apply)
  // The main process drives checks (on launch + hourly), so we just sync the
  // current state here rather than triggering our own check.
  apply(await api.getState())
})

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div v-if="show">
    <!-- Update available — click to download -->
    <button
      v-if="status === 'available'"
      type="button"
      @click="startUpdate"
      :title="label"
      class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white bg-primary-700 hover:bg-primary-800 transition-colors shadow-sm shadow-primary-900/20"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
      </svg>
      <span class="hidden sm:inline">{{ label }}</span>
    </button>

    <!-- Downloading -->
    <div
      v-else-if="status === 'downloading'"
      class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-primary-700 dark:text-primary-300 bg-primary-100 dark:bg-primary-900/30"
    >
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span class="hidden sm:inline">Downloading {{ percent }}%</span>
    </div>

    <!-- Downloaded — click to restart into the new version -->
    <button
      v-else-if="status === 'downloaded'"
      type="button"
      @click="installUpdate"
      title="Restart to finish updating"
      class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white bg-primary-700 hover:bg-primary-800 transition-colors shadow-sm shadow-primary-900/20"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <span class="hidden sm:inline">Restart to update</span>
    </button>

    <!-- Download failed — retry -->
    <button
      v-else-if="status === 'error'"
      type="button"
      @click="retry"
      title="Update failed — click to retry"
      class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-danger-700 dark:text-danger-300 bg-danger-100 dark:bg-danger-900/30 hover:bg-danger-200 dark:hover:bg-danger-900/50 transition-colors"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
      </svg>
      <span class="hidden sm:inline">Update failed — retry</span>
    </button>
  </div>
</template>
