<script setup>
import { useToast } from '../../composables/useToast'

const { toasts, remove } = useToast()

const icons = {
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
}

const colors = {
  info: 'bg-primary-50 border-primary-200/80 text-primary-900',
  success: 'bg-emerald-50 border-emerald-200/80 text-emerald-900',
  warning: 'bg-warning-50 border-warning-200/80 text-warning-900',
  error: 'bg-danger-50 border-danger-200/80 text-danger-900'
}

const iconColors = {
  info: 'text-primary-600',
  success: 'text-emerald-600',
  warning: 'text-warning-600',
  error: 'text-danger-600'
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <TransitionGroup name="toast-list">
        <div 
          v-for="toast in toasts"
          :key="toast.id"
          class="flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg shadow-gray-900/8 backdrop-blur-md max-w-sm"
          :class="colors[toast.type]"
        >
          <svg 
            class="w-5 h-5 flex-shrink-0"
            :class="iconColors[toast.type]"
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="icons[toast.type]" />
          </svg>
          
          <p class="text-sm font-medium flex-1">{{ toast.message }}</p>
          
          <button 
            @click="remove(toast.id)"
            class="p-1 hover:bg-black/5 rounded-lg transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-list-enter-active,
.toast-list-leave-active {
  transition: all 0.3s ease;
}

.toast-list-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-list-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-list-move {
  transition: transform 0.3s ease;
}
</style>
