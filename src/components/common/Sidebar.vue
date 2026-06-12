<script setup>
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { COURSE_PLANNER } from '../../config/featureFlags.js'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'
import { useCoursesStore } from '../../stores/courses'
import { useProfileStore } from '../../stores/profile'
import { useAuthStore } from '../../stores/auth'
import { isSupabaseConfigured } from '../../lib/supabase'

defineProps({
  mobileOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['closeMobile'])

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()
const profileStore = useProfileStore()
const authStore = useAuthStore()

watch(() => route.path, () => {
  emit('closeMobile')
})

/** Local `YYYY-MM-DD` key (timezone-safe  never toISOString). */
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Count of tasks scheduled within the current Mon–Sun week. */
const weekTaskCount = computed(() => {
  const now = new Date()
  const day = now.getDay() // 0 = Sun
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const start = localDateKey(monday)
  const end = localDateKey(sunday)
  return tasksStore.tasks.filter(t => t.scheduledDate >= start && t.scheduledDate <= end).length
})

// Sidebar items grouped exactly like the mockup, but limited to routes that
// actually exist in the app (no Inbox / Syllabi / Archive  those have no page).
const sections = computed(() => [
  {
    label: 'Today',
    items: [
      { name: 'Focus', path: '/dashboard' },
      { name: 'Agenda', path: '/tasks', count: tasksStore.todaysTasks.filter(t => !t.completed).length },
    ],
  },
  {
    label: 'Plan',
    items: [
      { name: 'Assignments', path: '/assignments', count: assignmentsStore.upcomingAssignments.length },
      { name: 'Week', path: '/planner', count: weekTaskCount.value },
      ...(COURSE_PLANNER
        ? [{ name: 'Courses', path: '/course-planner', count: coursesStore.courses.length }]
        : []),
    ],
  },
])

const userName = computed(() => {
  if (isSupabaseConfigured && authStore.user) {
    return (
      authStore.user.user_metadata?.full_name ||
      authStore.user.user_metadata?.name ||
      authStore.user.email?.split('@')[0] ||
      'Student'
    )
  }
  return profileStore.profile.name || 'Student'
})

const userInitials = computed(() => {
  const name = userName.value
  if (!name || name === 'Student') {
    if (isSupabaseConfigured && authStore.user?.email) {
      return authStore.user.email.slice(0, 2).toUpperCase()
    }
    return 'S'
  }
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
})

const userSubtitle = computed(() => {
  if (isSupabaseConfigured && authStore.user?.email) return authStore.user.email
  return profileStore.profile.email || 'Student planner'
})

const isActive = (path) => {
  if (path === '/dashboard') return route.path === '/dashboard'
  if (route.path === path) return true
  return route.path.startsWith(path + '/')
}
</script>

<template>
  <!-- Mobile Overlay -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="mobileOpen"
        class="fixed inset-0 bg-stone-950/30 backdrop-blur-[2px] z-40 lg:hidden"
        @click="emit('closeMobile')"
      ></div>
    </Transition>
  </Teleport>

  <!-- Sidebar -->
  <aside
    class="app-sidebar fixed top-0 left-0 z-50 h-screen w-64 bg-paper dark:bg-gray-900/95 backdrop-blur-xl border-r border-paper-line dark:border-gray-700/80 flex flex-col transition-transform duration-300 ease-in-out"
    :class="mobileOpen ? 'w-72 translate-x-0' : '-translate-x-full lg:translate-x-0'"
  >
    <!-- Logo -->
    <div class="flex items-center justify-between h-16 px-5 flex-shrink-0">
      <div class="flex items-center gap-2.5">
        <img src="/plannr-icon-light.svg" alt="" class="w-7 h-7 block dark:hidden" />
        <img src="/plannr-icon-dark.svg" alt="" class="w-7 h-7 hidden dark:block" />
        <span class="text-[15px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Plannr</span>
      </div>

      <!-- Mobile Close Button -->
      <button
        @click="emit('closeMobile')"
        class="lg:hidden p-2 -mr-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 rounded-lg transition-colors"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 px-5 py-2 overflow-y-auto">
      <div v-for="section in sections" :key="section.label" class="mb-7">
        <p class="eyebrow text-gray-400 dark:text-gray-500 mb-2.5 px-0.5">{{ section.label }}</p>
        <div class="space-y-0.5">
          <router-link
            v-for="item in section.items"
            :key="item.path"
            :to="item.path"
            class="group flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors duration-150"
            :class="isActive(item.path)
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'"
          >
            <span
              class="w-1 h-1 rounded-full bg-primary-700 transition-opacity"
              :class="isActive(item.path) ? 'opacity-100' : 'opacity-0'"
              aria-hidden="true"
            />
            <span
              class="flex-1 text-[13.5px] tracking-tight"
              :class="isActive(item.path) ? 'font-semibold' : 'font-medium'"
            >
              {{ item.name }}
            </span>
            <span
              v-if="item.count"
              class="font-mono text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500"
            >
              {{ item.count }}
            </span>
          </router-link>
        </div>
      </div>
    </nav>

    <!-- User profile (pinned bottom, mirrors the mockup) -->
    <button
      type="button"
      @click="router.push('/profile')"
      class="flex items-center gap-3 px-5 py-4 m-2 rounded-xl text-left hover:bg-gray-900/[0.03] dark:hover:bg-gray-100/[0.04] transition-colors"
    >
      <div class="w-9 h-9 rounded-full bg-primary-900 flex items-center justify-center flex-shrink-0">
        <span class="text-[11px] font-semibold text-white tracking-wide">{{ userInitials }}</span>
      </div>
      <div class="min-w-0">
        <p class="text-[13px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight truncate">{{ userName }}</p>
        <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">{{ userSubtitle }}</p>
      </div>
    </button>
  </aside>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
