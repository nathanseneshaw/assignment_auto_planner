<script setup>
/**
 * Manual "Check for updates" control for the profile page (desktop app only).
 *
 * The main process already auto-checks GitHub Releases on launch + hourly and
 * drives the top-bar UpdateButton. This gives the user an explicit way to check
 * on demand and see the installed version. It shares the same IPC + broadcast
 * state, so a download started here shows progress in the top bar too (and vice
 * versa).
 *
 * Web build / browser: window.electronAPI is undefined, so this renders nothing.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { isElectron } from '../../lib/platform'
import { Button } from '../ui'

const api = typeof window !== 'undefined' ? window.electronAPI?.updates : null

// idle | checking | up-to-date | available | downloading | downloaded | error | dev
const status = ref('idle')
const version = ref('')
const latestVersion = ref('')
const percent = ref(0)
const message = ref('')
let unsubscribe = null

const show = computed(() => isElectron && !!api)

// Broadcast events (from the main-process auto-checker or an in-progress
// download) keep this section in sync with the rest of the app.
function applyEvent(payload) {
  if (!payload) return
  switch (payload.status) {
    case 'available':
      status.value = 'available'
      latestVersion.value = payload.version || latestVersion.value
      break
    case 'downloading':
      status.value = 'downloading'
      if (typeof payload.percent === 'number') percent.value = payload.percent
      break
    case 'downloaded':
      status.value = 'downloaded'
      break
    case 'error':
      // Only reflect errors during a download the user started here; check-time
      // errors are handled by checkForUpdates() below.
      if (status.value === 'downloading') {
        status.value = 'error'
        message.value = payload.message || ''
      }
      break
    default:
      break
  }
}

async function checkForUpdates() {
  if (!api || status.value === 'checking' || status.value === 'downloading') return
  status.value = 'checking'
  message.value = ''
  const r = await api.checkNow()
  if (r?.currentVersion) version.value = r.currentVersion
  switch (r?.status) {
    case 'available':
      status.value = 'available'
      latestVersion.value = r.version || ''
      break
    case 'not-available':
      status.value = 'up-to-date'
      break
    case 'dev':
      status.value = 'dev'
      break
    case 'error':
    default:
      status.value = 'error'
      message.value = r?.message || ''
      break
  }
}

async function download() {
  if (status.value !== 'available') return
  status.value = 'downloading'
  percent.value = 0
  const r = await api?.download()
  if (r?.status === 'error') {
    status.value = 'error'
    message.value = r.message || ''
  }
}

async function install() {
  await api?.install()
}

// Sub-line under the version, describing the last result.
const statusText = computed(() => {
  switch (status.value) {
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return "You're on the latest version"
    case 'available':
      return latestVersion.value
        ? `Version ${latestVersion.value} is available`
        : 'An update is available'
    case 'downloading':
      return `Downloading ${percent.value}%`
    case 'downloaded':
      return 'Restart to finish updating'
    case 'error':
      return message.value ? `Couldn't check: ${message.value}` : "Couldn't check for updates"
    case 'dev':
      return 'Auto-update runs in the installed app'
    default:
      return 'Check whether a newer version is available'
  }
})

onMounted(async () => {
  if (!show.value) return
  unsubscribe = api.onEvent(applyEvent)
  version.value = (await api.getVersion()) || ''
  // If the background checker already found an update, reflect it right away.
  applyEvent(await api.getState())
})

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div v-if="show" class="flex items-center justify-between gap-4 py-3.5">
    <div class="min-w-0">
      <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">Plannr for desktop</p>
      <p
        class="text-[12px] font-mono truncate mt-0.5"
        :class="status === 'error' ? 'text-danger-600 dark:text-danger-400' : 'text-gray-500 dark:text-gray-400'"
      >
        <span v-if="version">Version {{ version }}</span>
        <span v-if="version" class="text-gray-300 dark:text-gray-600" aria-hidden="true"> · </span>{{ statusText }}
      </p>
    </div>

    <!-- Restart into the downloaded update -->
    <Button
      v-if="status === 'downloaded'"
      size="sm"
      class="shrink-0"
      @click="install"
    >
      Restart to update
    </Button>

    <!-- Download the available update -->
    <Button
      v-else-if="status === 'available'"
      size="sm"
      class="shrink-0"
      @click="download"
    >
      Download update
    </Button>

    <!-- Default: manual check (also covers idle / up-to-date / error / dev) -->
    <Button
      v-else
      variant="secondary"
      size="sm"
      class="shrink-0"
      :loading="status === 'checking'"
      :disabled="status === 'checking' || status === 'downloading'"
      @click="checkForUpdates"
    >
      {{ status === 'downloading' ? 'Downloading…' : 'Check for updates' }}
    </Button>
  </div>
</template>
