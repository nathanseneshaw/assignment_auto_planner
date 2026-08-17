<script setup>
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import MainLayout from './components/layouts/MainLayout.vue'
import TitleBar from './components/common/TitleBar.vue'
import ToastContainer from './components/ui/ToastContainer.vue'
import { useCoursesStore } from './stores/courses'
import { useAssignmentsStore } from './stores/assignments'
import { useTasksStore } from './stores/tasks'
import { useSubtasksStore } from './stores/subtasks'
import { useAuthStore } from './stores/auth'
import { useProfileStore } from './stores/profile'
import { isSupabaseConfigured } from './lib/supabase'
import { isElectron, isMacElectron } from './lib/platform'
import { hydrateLmsStoresFromSupabase } from './services/lmsSupabaseHydration'
import { useSupabaseStoreSync } from './composables/useSupabaseStoreSync'
import { useSupabaseRealtimeSync } from './composables/useSupabaseRealtimeSync'
import { useIcsAutoSync } from './composables/useIcsAutoSync'

const route = useRoute()

// Desktop only: tag <html> so the Electron title-bar drag styles activate
// (the web build never gets this class, so the browser app is untouched).
if (isElectron && typeof document !== 'undefined') {
  document.documentElement.classList.add('is-electron')
  // macOS draws the traffic lights top-LEFT, where the sidebar logo sits in
  // the Windows layout - .is-mac shifts the logo row down below them.
  if (isMacElectron) document.documentElement.classList.add('is-mac')
}

const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()
const tasksStore = useTasksStore()
const subtasksStore = useSubtasksStore()
const authStore = useAuthStore()
const profileStore = useProfileStore()

useSupabaseStoreSync()
useSupabaseRealtimeSync()
useIcsAutoSync()

function applyTheme(dark) {
  const isPublicPage = route.meta.authPage || route.meta.landingPage
  const effectiveDark = !!dark && !isPublicPage
  document.documentElement.classList.toggle('dark', effectiveDark)
  // Desktop: re-tint the native window-controls overlay (min/max/close) so it
  // matches the title-bar background. Colors mirror --color-paper/--color-gray-900
  // and their text counterparts in style.css.
  if (isElectron) {
    window.electronAPI?.window?.setTitleBarOverlay?.(
      effectiveDark
        ? { color: '#1c1917', symbolColor: '#e7e5e4' }
        : { color: '#e9e6dd', symbolColor: '#1c1917' }
    )
  }
}

// Apply persisted theme immediately before first render
applyTheme(profileStore.profile.darkMode)

watch(() => profileStore.profile.darkMode, applyTheme)

// Re-evaluate theme on every navigation (e.g. sign-out lands on /login → strip dark)
watch(() => route.meta, () => applyTheme(profileStore.profile.darkMode))

onMounted(async () => {
  if (isSupabaseConfigured && authStore.user) {
    await hydrateLmsStoresFromSupabase()
  }
})

watch(
  () => authStore.user,
  async (user, previous) => {
    if (user && isSupabaseConfigured) {
      await hydrateLmsStoresFromSupabase()
    } else if (!user && previous) {
      coursesStore.clearAll()
      assignmentsStore.clearAll()
      tasksStore.clearAll()
      subtasksStore.clearAll()
    }
  }
)

</script>

<template>
  <!-- Electron only: draggable title-bar strip under the native min/max/close
       overlay. The app layout below is offset by its height (--titlebar-h). -->
  <TitleBar v-if="isElectron" />

  <template v-if="route.meta.authPage || route.meta.landingPage">
    <RouterView v-slot="{ Component, route: r }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="r.path" />
      </Transition>
    </RouterView>
  </template>
  <MainLayout v-else>
    <RouterView v-slot="{ Component, route }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </MainLayout>

  <ToastContainer />
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
