<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTasksStore } from '../../stores/tasks'

const route = useRoute()
const tasksStore = useTasksStore()

const navItems = [
  {
    name: 'Focus',
    path: '/dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'
  },
  {
    name: 'Agenda',
    path: '/tasks',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'
  },
  {
    name: 'Assignments',
    path: '/assignments',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01'
  },
  {
    name: 'Week',
    path: '/planner',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
  },
]

const overdueCount = computed(() => tasksStore.overdueTasks.length)

const isActive = (path) => {
  if (path === '/dashboard') {
    return route.path === '/dashboard'
  }
  return route.path.startsWith(path)
}
</script>

<template>
  <nav class="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-paper/90 dark:bg-gray-900/90 backdrop-blur-xl border-t border-paper-line dark:border-gray-700/70 safe-area-pb">
    <div class="flex items-center justify-around px-1 py-1.5">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="relative flex flex-col items-center justify-center w-[4.25rem] py-1.5 rounded-2xl transition-[color,background-color] duration-200 ease-out"
        :class="[
          isActive(item.path)
            ? 'text-primary-900'
            : 'text-gray-500 hover:text-gray-800',
          isActive(item.path) ? 'bg-gray-100/90' : ''
        ]"
      >
        <div class="relative">
          <svg 
            class="w-6 h-6" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            :stroke-width="isActive(item.path) ? 2.5 : 2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
          </svg>
          <!-- Badge for overdue tasks -->
          <span 
            v-if="item.path === '/tasks' && overdueCount > 0"
            class="absolute -top-1 -right-1 w-4 h-4 bg-danger-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
          >
            {{ overdueCount > 9 ? '9+' : overdueCount }}
          </span>
        </div>
        <span 
          class="text-[10px] mt-0.5 font-semibold tracking-wide uppercase"
          :class="isActive(item.path) ? 'text-primary-900' : 'text-gray-500'"
        >
          {{ item.name }}
        </span>
        <!-- Active Indicator -->
        <div 
          v-if="isActive(item.path)"
          class="absolute bottom-1 w-5 h-0.5 bg-primary-900 rounded-full opacity-90"
        ></div>
      </router-link>
    </div>
  </nav>
</template>

<style scoped>
.safe-area-pb {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
