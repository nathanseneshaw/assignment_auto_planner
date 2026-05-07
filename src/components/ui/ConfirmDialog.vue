<script setup>
import { ref } from 'vue'
import Button from './Button.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: 'Confirm Action'
  },
  message: {
    type: String,
    default: 'Are you sure you want to proceed?'
  },
  confirmText: {
    type: String,
    default: 'Confirm'
  },
  cancelText: {
    type: String,
    default: 'Cancel'
  },
  variant: {
    type: String,
    default: 'danger',
    validator: (v) => ['danger', 'warning', 'primary'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

const icons = {
  danger: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  primary: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
}

const colors = {
  danger: {
    bg: 'bg-danger-100',
    icon: 'text-danger-600',
    button: 'danger'
  },
  warning: {
    bg: 'bg-warning-100',
    icon: 'text-warning-600',
    button: 'primary'
  },
  primary: {
    bg: 'bg-primary-100',
    icon: 'text-primary-600',
    button: 'primary'
  }
}

function close() {
  emit('update:modelValue', false)
  emit('cancel')
}

function confirm() {
  emit('update:modelValue', false)
  emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div 
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <!-- Backdrop -->
        <div 
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="close"
        ></div>
        
        <!-- Dialog -->
        <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform">
          <div class="p-6">
            <!-- Icon -->
            <div 
              class="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4"
              :class="colors[variant].bg"
            >
              <svg 
                class="w-7 h-7"
                :class="colors[variant].icon"
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" :d="icons[variant]" />
              </svg>
            </div>

            <!-- Content -->
            <div class="text-center">
              <h3 class="text-lg font-semibold text-gray-900 mb-2">
                {{ title }}
              </h3>
              <p class="text-gray-500">
                {{ message }}
              </p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-3 p-4 bg-gray-50 border-t border-gray-100">
            <Button 
              variant="secondary" 
              @click="close"
              class="flex-1"
            >
              {{ cancelText }}
            </Button>
            <Button 
              :variant="colors[variant].button"
              @click="confirm"
              class="flex-1"
            >
              {{ confirmText }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-enter-active,
.confirm-leave-active {
  transition: all 0.2s ease;
}

.confirm-enter-active > div:last-child,
.confirm-leave-active > div:last-child {
  transition: all 0.2s ease;
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}

.confirm-enter-from > div:last-child,
.confirm-leave-to > div:last-child {
  transform: scale(0.95);
  opacity: 0;
}
</style>
