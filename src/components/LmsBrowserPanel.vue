<script setup>
import { ref, computed, onMounted } from 'vue'
import { apiUrl } from '../services/apiBase.js'

const props = defineProps({
  lmsType: { type: String, required: true }, // 'blackboard' | 'canvas'
  defaultUrl: { type: String, default: '' },
  onSuccess: { type: Function, required: true },
})

const PARTITION = 'persist:lms-session'

const navInput = ref(
  props.defaultUrl ||
    (props.lmsType === 'canvas'
      ? 'https://canvas.instructure.com'
      : 'https://blackboard.com')
)
const webviewRef = ref(null)
const isExtracting = ref(false)
const isLoading = ref(true)
const error = ref('')

const lmsLabel = computed(() => (props.lmsType === 'canvas' ? 'Canvas' : 'Blackboard'))

function go() {
  let target = navInput.value.trim()
  if (!target) return
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`
  navInput.value = target
  if (webviewRef.value) webviewRef.value.src = target
}

function onDidNavigate(url) {
  navInput.value = url
}

function onLoadStart() {
  isLoading.value = true
}

function onLoadStop() {
  isLoading.value = false
}

onMounted(() => {
  const wv = webviewRef.value
  if (!wv) return
  wv.addEventListener('did-navigate', (e) => onDidNavigate(e.url))
  wv.addEventListener('did-navigate-in-page', (e) => onDidNavigate(e.url))
  wv.addEventListener('did-start-loading', onLoadStart)
  wv.addEventListener('did-stop-loading', onLoadStop)
})

async function extractAndSync() {
  if (!window.electronAPI?.isElectron) {
    error.value = 'Embedded browser is only available in the desktop app.'
    return
  }
  isExtracting.value = true
  error.value = ''
  try {
    const origin = (() => {
      try { return new URL(navInput.value).origin } catch { return navInput.value }
    })()
    const cookies = await window.electronAPI.extractLmsCookies(origin, PARTITION)
    const res = await fetch(apiUrl(`/api/${props.lmsType}/import-cookies`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: origin, cookies }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || `Import failed (${res.status})`)
    props.onSuccess(data.sessionId)
  } catch (e) {
    error.value = e.message || 'Failed to sync'
  } finally {
    isExtracting.value = false
  }
}

async function clearSession() {
  if (!window.electronAPI?.isElectron) return
  await window.electronAPI.clearLmsSession(PARTITION)
  if (webviewRef.value) webviewRef.value.reload()
}
</script>

<template>
  <div class="flex flex-col" style="height: 520px">
    <!-- URL bar -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
      <div class="w-2 h-2 rounded-full flex-shrink-0" :class="isLoading ? 'bg-amber-400 animate-pulse' : 'bg-green-400'" />
      <input
        v-model="navInput"
        type="url"
        class="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 min-w-0"
        :placeholder="`Your school's ${lmsLabel} URL`"
        @keydown.enter="go"
      />
      <button
        @click="go"
        class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-white flex-shrink-0"
      >
        Go
      </button>
      <button
        @click="clearSession"
        title="Clear saved session and reload"
        class="px-2 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-white flex-shrink-0"
      >
        Reset
      </button>
    </div>

    <!-- Embedded browser -->
    <webview
      ref="webviewRef"
      :src="navInput"
      :partition="PARTITION"
      class="flex-1 w-full"
      allowpopups
    />

    <!-- Footer -->
    <div class="flex-shrink-0 px-4 py-3 border-t border-gray-200 bg-gray-50 space-y-2">
      <p class="text-xs text-gray-500">
        Log into {{ lmsLabel }} above, then click <strong>Import</strong> to sync your courses and assignments.
      </p>
      <div v-if="error" class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
        {{ error }}
      </div>
      <button
        @click="extractAndSync"
        :disabled="isExtracting"
        class="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50 transition-colors"
      >
        {{ isExtracting ? 'Importing…' : `I'm logged in — Import from ${lmsLabel}` }}
      </button>
    </div>
  </div>
</template>
