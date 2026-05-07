<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'
import { useProfileStore } from '../../stores/profile'
import { useAuthStore } from '../../stores/auth'
import { isSupabaseConfigured } from '../../lib/supabase'

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

function handleSearch() {
  if (searchQuery.value.trim()) {
    console.log('Searching:', searchQuery.value)
  }
}
</script>

<template>
  <header class="sticky top-0 z-30 bg-white/75 backdrop-blur-xl border-b border-gray-200/70 supports-[backdrop-filter]:bg-white/65">
    <div class="flex items-center justify-between h-14 sm:h-16 px-4 lg:px-6">
      <div class="flex items-center gap-4">
        <!-- Mobile menu button -->
        <button
          @click="$emit('open-mobile-sidebar')"
            class="lg:hidden p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 rounded-lg transition-colors"
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
                class="text-gray-500 hover:text-gray-800 transition-colors"
                :class="{ 'font-medium text-gray-900': index === breadcrumbs.length - 1 }"
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
          <h1 class="text-lg sm:text-xl font-semibold text-gray-900 tracking-tight">{{ pageTitle }}</h1>
        </div>
        
        <!-- Mobile Title -->
        <h1 class="sm:hidden text-base font-semibold text-gray-900 tracking-tight">{{ pageTitle }}</h1>
      </div>

      <div class="flex items-center gap-2 lg:gap-4">
        <!-- Search -->
        <div class="relative">
          <button 
            @click="showSearch = !showSearch"
            class="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 rounded-xl transition-colors"
            :class="{ 'bg-gray-100/90 text-gray-900': showSearch }"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          
          <!-- Search Dropdown -->
          <Transition name="dropdown">
            <div 
              v-if="showSearch"
              class="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-lg shadow-gray-900/8 border border-gray-200/80 p-3"
            >
              <div class="relative">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search assignments, tasks..."
                  class="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:bg-white focus:border-primary-200/80"
                  @keyup.enter="handleSearch"
                  @keyup.esc="showSearch = false"
                />
              </div>
              <div class="mt-3 pt-3 border-t border-gray-100">
                <p class="text-xs text-gray-500 mb-2">Quick Links</p>
                <div class="space-y-1">
                  <button 
                    type="button"
                    @click="router.push('/planner'); showSearch = false"
                    class="w-full text-left px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Weekly planner
                  </button>
                  <button 
                    @click="router.push('/assignments'); showSearch = false"
                    class="w-full text-left px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    📋 Add Assignment
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Quick Stats (Desktop) -->
        <div class="hidden lg:flex items-center gap-3 px-3.5 py-2 bg-gray-100/70 rounded-full border border-gray-200/50">
          <div class="flex items-center gap-1.5 text-[13px]">
            <span class="w-1.5 h-1.5 rounded-full bg-primary-700 ring-2 ring-primary-200/80"></span>
            <span class="text-gray-600">
              <span class="font-medium text-gray-900">{{ todayStats.completed }}</span>/{{ todayStats.tasks }} today
            </span>
          </div>
          
          <div class="w-px h-3.5 bg-gray-300/80"></div>
          
          <div 
            v-if="todayStats.overdue > 0" 
            class="flex items-center gap-1.5 text-sm"
          >
            <span class="w-2 h-2 rounded-full bg-danger-500 animate-pulse"></span>
            <span class="text-danger-600 font-medium">{{ todayStats.overdue }} overdue</span>
          </div>
          <div v-else class="flex items-center gap-1.5 text-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200/80"></span>
            <span class="text-emerald-700 font-medium">On track</span>
          </div>
        </div>

        <!-- Notifications -->
        <div class="relative">
          <button 
            @click="showNotifications = !showNotifications"
            class="relative p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 rounded-xl transition-colors"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span 
              v-if="notifications.length > 0"
              class="absolute top-1 right-1 w-2 h-2 bg-danger-500 rounded-full animate-pulse"
            ></span>
          </button>

          <!-- Notifications Dropdown -->
          <Transition name="dropdown">
            <div 
              v-if="showNotifications"
              class="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-lg shadow-gray-900/8 border border-gray-200/80 overflow-hidden"
            >
              <div class="px-4 py-3 border-b border-gray-100/80 flex items-center justify-between">
                <h3 class="text-[15px] font-semibold text-gray-900 tracking-tight">Notifications</h3>
                <span v-if="notifications.length" class="text-xs text-gray-500">{{ notifications.length }} new</span>
              </div>
              
              <div v-if="notifications.length === 0" class="p-6 text-center">
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg class="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p class="text-gray-500 text-sm">All caught up!</p>
              </div>

              <div v-else class="max-h-64 overflow-y-auto">
                <div 
                  v-for="notification in notifications"
                  :key="notification.id"
                  class="px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <div class="flex items-start gap-3">
                    <div 
                      class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                      :class="notification.type === 'danger' ? 'bg-danger-100' : 'bg-warning-100'"
                    >
                      <svg 
                        class="w-4 h-4"
                        :class="notification.type === 'danger' ? 'text-danger-600' : 'text-warning-600'"
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="notification.icon" />
                      </svg>
                    </div>
                    <div>
                      <p class="text-sm font-medium text-gray-900">{{ notification.title }}</p>
                      <p class="text-xs text-gray-500">{{ notification.message }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div class="px-4 py-3 border-t border-gray-100/80 bg-gray-50/50">
                <button 
                  type="button"
                  @click="router.push('/planner'); showNotifications = false"
                  class="w-full text-center text-sm font-semibold text-gray-800 hover:text-primary-900 transition-colors"
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
          class="flex items-center gap-3 pl-3 border-l border-gray-200/70 hover:opacity-90 transition-opacity cursor-pointer rounded-r-lg"
        >
          <div class="hidden sm:block text-right">
            <p class="text-[13px] font-semibold text-gray-900 tracking-tight">{{ userName }}</p>
            <p class="text-[11px] text-gray-500">{{ currentDate.split(',')[0] }}</p>
          </div>
          <div class="w-9 h-9 rounded-full bg-primary-900 flex items-center justify-center ring-2 ring-white shadow-sm shadow-gray-900/10">
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
