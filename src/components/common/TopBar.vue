<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'
import UpdateButton from './UpdateButton.vue'

const emit = defineEmits(['open-mobile-sidebar'])

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const assignmentsStore = useAssignmentsStore()

const showSearch = ref(false)
const searchQuery = ref('')
const showNotifications = ref(false)
const dismissedNotifications = ref(new Set())
const notificationsEl = ref(null)

// Breadcrumb trail: HOME › <current page>. The page label comes from the route
// meta title (Dashboard, Assignments, …) so it stays in sync with navigation.
const pageTitle = computed(() => route.meta.title || '')

// Live "SAT · JUN 6 · 8:42 PM" clock for the top row. A 20s tick keeps the
// minute accurate without a per-second redraw.
const now = ref(new Date())
let clockTimer = null
onMounted(() => {
  clockTimer = setInterval(() => { now.value = new Date() }, 20_000)
})

const clock = computed(() => {
  const d = now.value
  let h = d.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    date: `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`,
    time: `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`,
  }
})

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
  if (clockTimer) clearInterval(clockTimer)
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

const todayStats = computed(() => ({
  overdue: tasksStore.overdueTasks.length,
}))

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

function goToAssignment() {
  router.push('/assignments')
  showSearch.value = false
  searchQuery.value = ''
}

function goToTask() {
  router.push('/tasks')
  showSearch.value = false
  searchQuery.value = ''
}
</script>

<template>
  <header class="sticky top-0 z-30 bg-paper/75 dark:bg-gray-900/75 backdrop-blur-xl">
    <div class="flex items-center justify-between h-14 px-4 sm:px-8 lg:px-12">
      <div class="flex items-center gap-3 min-w-0">
        <!-- Mobile menu button -->
        <button
          @click="emit('open-mobile-sidebar')"
          class="lg:hidden p-2 -ml-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-lg transition-colors"
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <!-- Breadcrumb: HOME › <page> -->
        <nav class="flex items-center gap-2 min-w-0" aria-label="Breadcrumb">
          <router-link
            to="/dashboard"
            class="eyebrow text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0"
          >
            Home
          </router-link>
          <svg class="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
          <span class="eyebrow text-rust-600 dark:text-rust-500 truncate" aria-current="page">
            {{ pageTitle }}
          </span>
        </nav>
      </div>

      <div class="flex items-center gap-2">
        <!-- Live date · time -->
        <div class="hidden md:flex items-center gap-1.5 eyebrow text-gray-500 dark:text-gray-400 mr-1 select-none">
          <span>{{ clock.weekday }}</span>
          <span class="text-rust-500" aria-hidden="true">·</span>
          <span>{{ clock.date }}</span>
          <span class="text-rust-500" aria-hidden="true">·</span>
          <span class="text-gray-600 dark:text-gray-300">{{ clock.time }}</span>
        </div>

        <!-- Desktop auto-update (Electron only; hidden until an update exists) -->
        <UpdateButton />

        <!-- Search -->
        <div class="relative">
          <button
            @click="showSearch = !showSearch"
            class="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-paper-line dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/60 dark:hover:bg-gray-800/60 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            :class="{ 'bg-surface/70 dark:bg-gray-800/70 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100': showSearch }"
            aria-label="Search"
          >
            <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          <!-- Search Dropdown -->
          <Transition name="dropdown">
            <div
              v-if="showSearch"
              class="absolute right-0 top-full mt-2 w-72 bg-surface dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-900/8 dark:shadow-gray-900/40 border border-gray-200/80 dark:border-gray-700 p-3"
            >
              <div class="relative">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search assignments, tasks…"
                  class="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-paper/60 dark:bg-gray-900/40 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-[border-color,box-shadow] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/25 focus-visible:border-primary-300/80 dark:focus-visible:border-primary-500/60 focus:bg-surface dark:focus:bg-gray-800"
                  @keyup.enter="handleSearch"
                  @keyup.esc="showSearch = false"
                  autofocus
                />
              </div>
              <!-- Search results -->
              <div v-if="searchQuery.trim() && hasResults" class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/80 space-y-3">
                <div v-if="searchResults.assignments.length > 0">
                  <p class="eyebrow text-gray-400 dark:text-gray-500 mb-1.5 px-1">Assignments</p>
                  <div class="space-y-0.5">
                    <button
                      v-for="a in searchResults.assignments"
                      :key="a.id"
                      type="button"
                      @click="goToAssignment(a)"
                      class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                    >
                      <p class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ a.title }}</p>
                      <p v-if="a.dueDate" class="eyebrow text-gray-400 dark:text-gray-500 mt-0.5">Due {{ a.dueDate }}</p>
                    </button>
                  </div>
                </div>
                <div v-if="searchResults.tasks.length > 0">
                  <p class="eyebrow text-gray-400 dark:text-gray-500 mb-1.5 px-1">Tasks</p>
                  <div class="space-y-0.5">
                    <button
                      v-for="t in searchResults.tasks"
                      :key="t.id"
                      type="button"
                      @click="goToTask(t)"
                      class="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <p class="text-sm text-gray-800 dark:text-gray-200 truncate">{{ t.title }}</p>
                      <p v-if="t.scheduledDate" class="eyebrow text-gray-400 dark:text-gray-500 mt-0.5">{{ t.scheduledDate }}</p>
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
                <p class="eyebrow text-gray-400 dark:text-gray-500 mb-2">Quick Links</p>
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
                    Add assignment
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Notifications -->
        <div ref="notificationsEl" class="relative">
          <button
            @click="showNotifications = !showNotifications"
            class="relative w-9 h-9 inline-flex items-center justify-center rounded-lg border border-paper-line dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/60 dark:hover:bg-gray-800/60 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            :class="{ 'bg-surface/70 dark:bg-gray-800/70 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100': showNotifications }"
            aria-label="Notifications"
          >
            <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span
              v-if="visibleNotifications.length > 0"
              class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rust-500 border-2 border-paper dark:border-gray-900 rounded-full"
            ></span>
          </button>

          <!-- Notifications Dropdown -->
          <Transition name="dropdown">
            <div
              v-if="showNotifications"
              class="absolute right-0 top-full mt-2 w-80 bg-surface dark:bg-gray-800 rounded-2xl shadow-lg shadow-gray-900/8 dark:shadow-gray-900/40 border border-gray-200/80 dark:border-gray-700 overflow-hidden"
            >
              <div class="px-4 py-3 border-b border-paper-line dark:border-gray-700/60 flex items-center justify-between">
                <h3 class="display text-lg text-gray-900 dark:text-gray-100">Notifications</h3>
                <span v-if="visibleNotifications.length" class="eyebrow text-rust-600 dark:text-rust-500">{{ visibleNotifications.length }} new</span>
              </div>

              <div v-if="visibleNotifications.length === 0" class="px-6 py-8 text-center">
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <svg class="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p class="font-serif italic text-base text-gray-500 dark:text-gray-400">All caught up!</p>
              </div>

              <div v-else class="max-h-64 overflow-y-auto">
                <div
                  v-for="notification in visibleNotifications"
                  :key="notification.id"
                  class="px-4 py-3 hover:bg-paper/60 dark:hover:bg-gray-700/50 transition-colors border-b border-paper-line/60 dark:border-gray-700/40 last:border-0 group"
                >
                  <div class="flex items-start gap-3">
                    <div
                      class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                      :class="notification.type === 'danger' ? 'bg-rust-100 dark:bg-rust-500/15' : 'bg-warning-100 dark:bg-warning-900/40'"
                    >
                      <svg
                        class="w-4 h-4"
                        :class="notification.type === 'danger' ? 'text-rust-600 dark:text-rust-500' : 'text-warning-600 dark:text-warning-400'"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="notification.icon" />
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ notification.title }}</p>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ notification.message }}</p>
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

              <div class="px-4 py-3 border-t border-paper-line dark:border-gray-700/60 bg-paper/40 dark:bg-gray-800/50">
                <button
                  type="button"
                  @click="router.push('/planner'); showNotifications = false"
                  class="group w-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300 hover:text-primary-700 dark:hover:text-primary-400 transition-colors"
                >
                  Open weekly planner
                  <span class="transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </Transition>
        </div>
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
