<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'info',
    validator: (v) => ['info', 'success', 'warning', 'error'].includes(v)
  },
  duration: {
    type: Number,
    default: 3000
  },
  position: {
    type: String,
    default: 'bottom-right',
    validator: (v) => ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center', 'bottom-center'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue', 'close'])

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

const positionClasses = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2'
}

let timer = null

watch(() => props.modelValue, (val) => {
  if (val && props.duration > 0) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      close()
    }, props.duration)
  }
})

function close() {
  emit('update:modelValue', false)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div 
        v-if="modelValue"
        class="fixed z-50 max-w-sm"
        :class="positionClasses[position]"
      >
        <div 
          class="flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg shadow-gray-900/8 backdrop-blur-md"
          :class="colors[type]"
        >
          <svg 
            class="w-5 h-5 flex-shrink-0"
            :class="iconColors[type]"
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="icons[type]" />
          </svg>
          
          <p class="text-sm font-medium flex-1">{{ message }}</p>
          
          <button 
            @click="close"
            class="p-1 hover:bg-black/5 rounded-lg transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
