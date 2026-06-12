<script setup>
/**
 * Custom window title bar for the Electron (frameless) build. The bar itself is
 * a drag region (move the window by it; double-click maximizes); the buttons
 * opt out of dragging via the global `no-drag` rule in style.css. Inert in the
 * browser build — App.vue only mounts this when `isElectron` is true.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'

const api = typeof window !== 'undefined' ? window.electronAPI?.window : null

const isMaximized = ref(false)
let unsubscribe = null

function minimize() {
  api?.minimize()
}

async function toggleMaximize() {
  const next = await api?.toggleMaximize()
  if (typeof next === 'boolean') isMaximized.value = next
}

function close() {
  api?.close()
}

onMounted(async () => {
  if (!api) return
  isMaximized.value = await api.isMaximized()
  // Stay in sync when maximize state changes outside our button (bar
  // double-click, Aero Snap, keyboard shortcuts).
  unsubscribe = api.onMaximizeChange((value) => {
    isMaximized.value = value
  })
})

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div class="app-titlebar">
    <div class="app-titlebar__controls">
      <!-- Minimize -->
      <button
        type="button"
        class="titlebar-btn"
        aria-label="Minimize"
        title="Minimize"
        @click="minimize"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <path d="M6 12h12" />
        </svg>
      </button>

      <!-- Maximize / Restore -->
      <button
        type="button"
        class="titlebar-btn"
        :aria-label="isMaximized ? 'Restore' : 'Maximize'"
        :title="isMaximized ? 'Restore' : 'Maximize'"
        @click="toggleMaximize"
      >
        <svg v-if="isMaximized" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
          <path d="M9 9V7.5A1.5 1.5 0 0 1 10.5 6h6A1.5 1.5 0 0 1 18 7.5v6a1.5 1.5 0 0 1-1.5 1.5H15" />
          <rect x="6" y="9" width="9" height="9" rx="1.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      </button>

      <!-- Close -->
      <button
        type="button"
        class="titlebar-btn titlebar-btn--close"
        aria-label="Close"
        title="Close"
        @click="close"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </div>
  </div>
</template>
