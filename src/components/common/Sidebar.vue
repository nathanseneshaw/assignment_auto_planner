<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'

const props = defineProps({
  open: {
    type: Boolean,
    default: true
  },
  mobileOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggle', 'closeMobile'])

const route = useRoute()

watch(() => route.path, () => {
  emit('closeMobile')
})

const navItems = [
  { 
    name: 'Dashboard', 
    path: '/dashboard', 
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    description: 'Overview & stats'
  },
  { 
    name: 'Assignments', 
    path: '/assignments', 
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    description: 'All assignments'
  },
  { 
    name: 'Planner', 
    path: '/planner', 
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    description: 'Week & month'
  },
  { 
    name: 'Courses', 
    path: '/course', 
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    description: 'Manage courses'
  },
]

const isActive = (path) => {
  if (path === '/dashboard') {
    return route.path === '/dashboard'
  }
  return route.path.startsWith(path)
}
</script>

<template>
  <!-- Mobile Overlay -->
  <Teleport to="body">
    <Transition name="fade">
      <div 
        v-if="mobileOpen"
        class="fixed inset-0 bg-zinc-950/20 backdrop-blur-[2px] z-40 lg:hidden"
        @click="emit('closeMobile')"
      ></div>
    </Transition>
  </Teleport>

  <!-- Sidebar -->
  <aside 
    class="fixed top-0 left-0 z-50 h-screen bg-white/95 backdrop-blur-xl border-r border-gray-200/80 flex flex-col transition-all duration-300 ease-in-out shadow-[1px_0_24px_rgba(15,23,42,0.04)]"
    :class="[
      open ? 'lg:w-64' : 'lg:w-20',
      mobileOpen ? 'w-72 translate-x-0' : '-translate-x-full lg:translate-x-0'
    ]"
  >
    <!-- Logo -->
    <div class="flex items-center justify-between h-14 px-3 sm:px-4 border-b border-gray-100 flex-shrink-0">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-primary-900 flex items-center justify-center ring-1 ring-black/5">
          <svg class="w-[1.125rem] h-[1.125rem] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <div v-if="open || mobileOpen" class="overflow-hidden min-w-0">
          <span class="text-[15px] font-semibold text-gray-900 tracking-tight whitespace-nowrap">
            AutoPlanner
          </span>
          <p class="text-[11px] text-gray-500 font-medium truncate">Student planner</p>
        </div>
      </div>
      
      <!-- Mobile Close Button -->
      <button
        @click="emit('closeMobile')"
        class="lg:hidden p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100/80 rounded-lg transition-colors"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="group relative flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-[color,background-color] duration-200 ease-out"
        :class="[
          isActive(item.path)
            ? 'bg-gray-100/90 text-gray-900'
            : 'text-gray-600 hover:bg-gray-50/90 hover:text-gray-900'
        ]"
      >
        <span
          class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full bg-primary-900 transition-[height,opacity] duration-200"
          :class="isActive(item.path) ? 'h-6 opacity-100' : 'h-0 opacity-0'"
          aria-hidden="true"
        />
        <div 
          class="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          :class="isActive(item.path) 
            ? 'bg-primary-900 text-white' 
            : 'bg-transparent text-gray-500 group-hover:text-gray-700'"
        >
          <svg 
            class="w-[1.125rem] h-[1.125rem]" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
          </svg>
        </div>
        <div v-if="open || mobileOpen" class="flex-1 min-w-0 pl-0.5">
          <p class="text-[13px] font-medium whitespace-nowrap truncate leading-tight">
            {{ item.name }}
          </p>
          <p 
            class="text-[11px] truncate transition-colors mt-0.5 font-normal"
            :class="isActive(item.path) ? 'text-gray-500' : 'text-gray-400'"
          >
            {{ item.description }}
          </p>
        </div>
      </router-link>
    </nav>

    <!-- Desktop Toggle Button -->
    <button
      type="button"
      @click="emit('toggle')"
      class="hidden lg:flex absolute -right-3 top-[4.5rem] w-7 h-7 bg-white border border-gray-200/90 rounded-full items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-all shadow-sm shadow-gray-900/5"
    >
      <svg 
        class="w-4 h-4 transition-transform duration-300" 
        :class="{ 'rotate-180': !open }"
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
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
