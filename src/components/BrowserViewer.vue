<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { apiUrl } from '../services/apiBase.js'
import { sendBrowserInput } from '../services/blackboardBrowserService.js'

const props = defineProps({
  sessionId: { type: String, required: true },
  viewport: { type: Object, default: () => ({ width: 1280, height: 720 }) },
})

const imgRef = ref(null)
const screenshotSrc = ref('')
const loading = ref(true)
let pollTimer = null

function refresh() {
  screenshotSrc.value =
    apiUrl(`/api/blackboard/session-screenshot/${props.sessionId}`) + '?t=' + Date.now()
}

async function onClick(e) {
  const rect = imgRef.value.getBoundingClientRect()
  const x = Math.round(((e.clientX - rect.left) / rect.width) * props.viewport.width)
  const y = Math.round(((e.clientY - rect.top) / rect.height) * props.viewport.height)
  await sendBrowserInput(props.sessionId, { type: 'click', x, y })
  setTimeout(refresh, 300)
}

async function onKeyDown(e) {
  const specials = [
    'Enter', 'Backspace', 'Tab', 'Escape', 'Delete',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ]
  if (specials.includes(e.key)) {
    e.preventDefault()
    await sendBrowserInput(props.sessionId, { type: 'key', key: e.key })
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    await sendBrowserInput(props.sessionId, { type: 'type', text: e.key })
  }
  setTimeout(refresh, 200)
}

onMounted(() => {
  refresh()
  pollTimer = setInterval(refresh, 1000)
})

onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <div
    tabindex="0"
    class="outline-none w-full focus:ring-2 focus:ring-primary-400 rounded-xl"
    @keydown="onKeyDown"
  >
    <div class="relative w-full bg-gray-900 rounded-xl overflow-hidden border border-gray-700">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-gray-900">
        <svg class="w-6 h-6 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
      <img
        ref="imgRef"
        :src="screenshotSrc"
        class="w-full cursor-pointer select-none block"
        @click="onClick"
        @load="loading = false"
        alt="Live browser session"
      />
    </div>
    <p class="text-xs text-gray-400 mt-1.5 text-center">
      Click to interact · Type to enter text · Enter / Backspace / Tab work normally
    </p>
  </div>
</template>
