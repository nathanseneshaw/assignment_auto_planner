<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'
import { useProfileStore } from '../../stores/profile'
import { useAuthStore } from '../../stores/auth'
import { isSupabaseConfigured } from '../../lib/supabase'
import UpdateButton from './UpdateButton.vue'

defineProps({
  sidebarOpen: Boolean
})

const emit = defineEmits(['toggle-sidebar', 'open-mobile-sidebar'])

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const assignmentsStore = useAssignmentsStore()
const profileStore = useProfileStore()
const authStore = useAuthStore()

const userInitials = computed(() => {
  const name =
    isSupabaseConfigured && authStore.user
      ? authStore.user.user_metadata?.full_name ||
        authStore.user.user_metadata?.name ||
        profileStore.profile.name
      : profileStore.profile.name
  if (!name) {
    if (isSupabaseConfigured && authStore.user?.email) {
      return authStore.user.email.slice(0, 2).toUpperCase()
    }
    return 'S'
  }
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
})

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

const showSearch = ref(false)
const searchQuery = ref('')
const showNotifications = ref(false)
const dismissedNotifications = ref(new Set())
const notificationsEl = ref(null)

function onNotificationsOutsideClick(e) {
  if (notificationsEl.value && !notificationsEl.value.contains(e.target)) {
    showNotifications.value = false
  }
}

watch(showNotifications, (val) => {
  if (val) {
    nextTick(() => document.addEventListener('click', onNotificationsOutsideClick))
  } else {
    document.removeEventListener('click', onNotificationsOutsideClick)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onNotificationsOutsideClick)
})

const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return { assignments: [], tasks: [] }

  const assignments = assignmentsStore.assignments
    .filter(a =>
      a.title?.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q)
    )
    .slice(0, 4)

  const tasks = tasksStore.tasks
    .filter(t => t.title?.toLowerCase().includes(q))
    .slice(0, 4)

  return { assignments, tasks }
})

const hasResults = computed(() =>
  searchResults.value.assignments.length > 0 || searchResults.value.tasks.length > 0
)

const pageTitle = computed(() => route.meta.title || 'Dashboard')

const breadcrumbs = computed(() => {
  const crumbs = [{ name: 'Home', path: '/dashboard' }]

  if (route.path !== '/dashboard') {
    crumbs.push({ name: pageTitle.value, path: route.path })
  }

  return crumbs
})

const todayStats = computed(() => ({
  tasks: tasksStore.todaysTasks.length,
  completed: tasksStore.todaysTasks.filter(t => t.completed).length,
  overdue: tasksStore.overdueTasks.length,
  upcoming: assignmentsStore.upcomingAssignments.length
}))

const currentDate = computed(() => {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})

const notifications = computed(() => {
  const items = []
  
  if (todayStats.value.overdue > 0) {
    items.push({
      id: 1,
      type: 'danger',
      title: 'Overdue Tasks',
      message: `You have ${todayStats.value.overdue} overdue task${todayStats.value.overdue > 1 ? 's' : ''}`,
      icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
    })
  }
  
  const urgentAssignments = assignmentsStore.upcomingAssignments.filter(a => {
    const days = Math.ceil((new Date(a.dueDate) - new Date()) / (1000 * 60 * 60 * 24))
    return days <= 2
  })
  
  if (urgentAssignments.length > 0) {
    items.push({
      id: 2,
      type: 'warning',
      title: 'Upcoming Deadlines',
      message: `${urgentAssignments.length} assignment${urgentAssignments.length > 1 ? 's' : ''} due in the next 48 hours`,
      icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
    })
  }
  
  return items
})

const visibleNotifications = computed(() =>
  notifications.value.filter(n => !dismissedNotifications.value.has(n.id))
)

function dismissNotification(id) {
  dismissedNotifications.value = new Set([...dismissedNotifications.value, id])
}

function handleSearch() {
  if (searchResults.value.assignments.length > 0) {
    router.push('/assignments')
    showSearch.value = false
  } else if (searchResults.value.tasks.length > 0) {
    router.push('/tasks')
    showSearch.value = false
  }
}

function goToAssignment(assignment) {
  router.push('/assignments')
  showSearch.value = false
  searchQuery.value = ''
}

function goToTask(task) {
  router.push('/tasks')
  showSearch.value = false
  searchQuery.value = ''
}
</script>

<template>
  <header class="sticky top-0 z-30 bg-white/75 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/70 dark:border-gray-700/70 supports-[backdrop-filter]:bg-white/65 dark:supports-[backdrop-filter]:bg-gray-900/70">
    <div class="flex items-center justify-between h-14 sm:h-16 px-4 lg:px-6">
      <div class="flex items-center gap-4">
        <!-- Mobile menu button -->
        <button
          @click="$emit('open-mobile-sidebar')"
          class="lg:hidden p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 rounded-lg transition-colors"
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div class="hidden sm:block">
          <!-- Breadcrumbs -->
          <nav class="flex items-center gap-1.5 text-[13px] mb-0.5">
            <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
              <router-link
                :to="crumb.path"
                class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                :class="{ 'font-medium text-gray-900 dark:text-gray-100': index === breadcrumbs.length - 1 }"
              >
                {{ crumb.name }}
              </router-link>
              <svg 
                v-if="index < breadcrumbs.length - 1" 
                class="w-4 h-4 text-gray-400" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </template>
          </nav>
          <h1 class="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{{ pageTitle }}</h1>
        </div>

        <!-- Mobile Title -->
        <h1 class="sm:hidden text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{{ pageTitle }}</h1>
      </div>

      <div class="flex items-center gap-2 lg:gap-4">
        <!-- Desktop auto-update (Electron only; hidden until an update exists) -->
        <UpdateButton />

        <!-- Search -->
        <div class="relative">
          <button
            @click="showSearch = !showSearch"
            class="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 rounded-xl transition-colors"
            :class="{ 'bg-gray-100/90 dark:bg-gray-700/60 text-gray-900 dark:text-gray-100': showSearch }"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          
          <!-- Search Dropdown -->
          <Transition name="dropdown">
            <div
              v-if="showSearch"
              class="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-900/8 dark:shadow-gray-900/40 border border-gray-200/80 dark:border-gray-700 p-3"
            >
              <div class="relative">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search assignments, tasks..."
                  class="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/60 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:bg-white dark:focus:bg-gray-700 focus:border-primary-300 dark:focus:border-primary-500/60"
                  @keyup.enter="handleSearch"
                  @keyup.esc="showSearch = false"
                  autofocus
                />
              </div>
              <!-- Search results -->
              <div v-if="searchQuery.trim() && hasResults" class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/80 space-y-3">
                <div v-if="searchResults.assignments.length > 0">
                  <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5 px-1">Assignments</p>
                  <div class="space-y-0.5">
                    <button
                      v-for="a in searchResults.assignments"
                      :key="a.id"
                      type="button"
                      @click="goToAssignment(a)"
                      class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                    >
                      <p class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ a.title }}</p>
                      <p v-if="a.dueDate" class="text-[11px] text-gray-400 dark:text-gray-500">Due {{ a.dueDate }}</p>
                    </button>
                  </div>
                </div>
                <div v-if="searchResults.tasks.length > 0">
                  <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5 px-1">Tasks</p>
                  <div class="space-y-0.5">
                    <button
                      v-for="t in searchResults.tasks"
                      :key="t.id"
                      type="button"
                      @click="goToTask(t)"
                      class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <p class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ t.title }}</p>
                      <p v-if="t.scheduledDate" class="text-[11px] text-gray-400 dark:text-gray-500">{{ t.scheduledDate }}</p>
                    </button>
                  </div>
                </div>
              </div>

              <!-- No results -->
              <div v-else-if="searchQuery.trim() && !hasResults" class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/80">
                <p class="text-sm text-center text-gray-400 dark:text-gray-500 py-2">No results for "{{ searchQuery }}"</p>
              </div>

              <!-- Quick links (shown when no query) -->
              <div v-else class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/80">
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Quick Links</p>
                <div class="space-y-1">
                  <button
                    type="button"
                    @click="router.push('/planner'); showSearch = false"
                    class="w-full text-left px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Weekly planner
                  </button>
                  <button
                    type="button"
                    @click="router.push('/assignments'); showSearch = false"
                    class="w-full text-left px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    📋 Add Assignment
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Quick Stats (Desktop) -->
        <div class="hidden lg:flex items-center gap-3 px-3.5 py-2 bg-gray-100/70 dark:bg-gray-800/70 rounded-full border border-gray-200/50 dark:border-gray-700/50">
          <div class="flex items-center gap-1.5 text-[13px]">
            <span class="w-1.5 h-1.5 rounded-full bg-primary-700 ring-2 ring-primary-200/80 dark:ring-primary-900/80"></span>
            <span class="text-gray-600 dark:text-gray-400">
              <span class="font-medium text-gray-900 dark:text-gray-200">{{ todayStats.completed }}</span>/{{ todayStats.tasks }} today
            </span>
          </div>

          <div class="w-px h-3.5 bg-gray-300/80 dark:bg-gray-600/80"></div>

          <div
            v-if="todayStats.overdue > 0"
            class="flex items-center gap-1.5 text-sm"
          >
            <span class="w-2 h-2 rounded-full bg-danger-500 animate-pulse"></span>
            <span class="text-danger-600 dark:text-danger-400 font-medium">{{ todayStats.overdue }} overdue</span>
          </div>
          <div v-else class="flex items-center gap-1.5 text-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200/80 dark:ring-emerald-900/80"></span>
            <span class="text-emerald-700 dark:text-emerald-400 font-medium">On track</span>
          </div>
        </div>

        <!-- Notifications -->
        <div ref="notificationsEl" class="relative">
          <button
            @click="showNotifications = !showNotifications"
            class="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 rounded-xl transition-colors"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span
              v-if="visibleNotifications.length > 0"
              class="absolute top-1 right-1 w-2 h-2 bg-danger-500 rounded-full animate-pulse"
            ></span>
          </button>

          <!-- Notifications Dropdown -->
          <Transition name="dropdown">
            <div
              v-if="showNotifications"
              class="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-900/8 dark:shadow-gray-900/40 border border-gray-200/80 dark:border-gray-700 overflow-hidden"
            >
              <div class="px-4 py-3 border-b border-gray-100/80 dark:border-gray-700/80 flex items-center justify-between">
                <h3 class="text-[15px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Notifications</h3>
                <span v-if="visibleNotifications.length" class="text-xs text-gray-500 dark:text-gray-400">{{ visibleNotifications.length }} new</span>
              </div>

              <div v-if="visibleNotifications.length === 0" class="p-6 text-center">
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg class="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p class="text-gray-500 dark:text-gray-400 text-sm">All caught up!</p>
              </div>

              <div v-else class="max-h-64 overflow-y-auto">
                <div
                  v-for="notification in visibleNotifications"
                  :key="notification.id"
                  class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0 group"
                >
                  <div class="flex items-start gap-3">
                    <div
                      class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                      :class="notification.type === 'danger' ? 'bg-danger-100 dark:bg-danger-900/40' : 'bg-warning-100 dark:bg-warning-900/40'"
                    >
                      <svg
                        class="w-4 h-4"
                        :class="notification.type === 'danger' ? 'text-danger-600 dark:text-danger-400' : 'text-warning-600 dark:text-warning-400'"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="notification.icon" />
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ notification.title }}</p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">{{ notification.message }}</p>
                    </div>
                    <button
                      type="button"
                      @click.stop="dismissNotification(notification.id)"
                      class="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-gray-600/70 transition-all"
                      title="Dismiss"
                    >
                      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div class="px-4 py-3 border-t border-gray-100/80 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/50">
                <button
                  type="button"
                  @click="router.push('/planner'); showNotifications = false"
                  class="w-full text-center text-sm font-semibold text-gray-800 dark:text-gray-300 hover:text-primary-900 dark:hover:text-primary-400 transition-colors"
                >
                  Open weekly planner →
                </button>
              </div>
            </div>
          </Transition>
        </div>

        <!-- User Menu -->
        <button
          type="button"
          @click="router.push('/profile')"
          class="flex items-center gap-3 pl-3 border-l border-gray-200/70 dark:border-gray-700/70 hover:opacity-90 transition-opacity cursor-pointer rounded-r-lg"
        >
          <div class="hidden sm:block text-right">
            <p class="text-[13px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{{ userName }}</p>
            <p class="text-[11px] text-gray-500 dark:text-gray-400">{{ currentDate.split(',')[0] }}</p>
          </div>
          <div class="w-9 h-9 rounded-full bg-primary-900 flex items-center justify-center ring-2 ring-white dark:ring-gray-700 shadow-sm shadow-gray-900/10">
            <span class="text-xs font-semibold text-white">{{ userInitials }}</span>
          </div>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
