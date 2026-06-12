<script setup>
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import MainLayout from './components/layouts/MainLayout.vue'
import TitleBar from './components/common/TitleBar.vue'
import ToastContainer from './components/ui/ToastContainer.vue'
import { useCoursesStore } from './stores/courses'
import { useAssignmentsStore } from './stores/assignments'
import { useTasksStore } from './stores/tasks'
import { useAuthStore } from './stores/auth'
import { useProfileStore } from './stores/profile'
import { isSupabaseConfigured } from './lib/supabase'
import { isElectron } from './lib/platform'
import { hydrateLmsStoresFromSupabase } from './services/lmsSupabaseHydration'
import { useSupabaseStoreSync } from './composables/useSupabaseStoreSync'
import { useIcsAutoSync } from './composables/useIcsAutoSync'

const route = useRoute()

// Desktop only: tag <html> so the Electron title-bar drag styles activate
// (the web build never gets this class, so the browser app is untouched).
if (isElectron && typeof document !== 'undefined') {
  document.documentElement.classList.add('is-electron')
}

const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()
const tasksStore = useTasksStore()
const authStore = useAuthStore()
const profileStore = useProfileStore()

useSupabaseStoreSync()
useIcsAutoSync()

function applyTheme(dark) {
  const isPublicPage = route.meta.authPage || route.meta.landingPage
  document.documentElement.classList.toggle('dark', !!dark && !isPublicPage)
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
    }
  }
)

</script>

<template>
  <!-- Electron only: custom title bar with our own min/max/close buttons. The
       app layout below is offset by its height (--titlebar-h) in style.css. -->
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
