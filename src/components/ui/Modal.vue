<script setup>
import { watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg', 'xl', 'full'].includes(v)
  },
  closable: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue', 'close'])

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl'
}

function close() {
  if (props.closable) {
    emit('update:modelValue', false)
    emit('close')
  }
}

function handleEscape(e) {
  if (e.key === 'Escape' && props.modelValue) {
    close()
  }
}

watch(() => props.modelValue, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <!-- z-[100] = the dialog layer, above every piece of app chrome
           (see the layer scale in src/style.css). In Electron the sidebar sits
           at z-index 70 and the title-bar strip at 60, so anything lower gets
           painted over whenever the window is narrow enough for the two to
           overlap. -->
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        <!-- Backdrop -->
        <div 
          class="absolute inset-0 bg-stone-950/50 backdrop-blur-[3px]"
          @click="close"
        ></div>
        
        <!-- Modal Content
             Capped at the viewport height (minus the wrapper's p-4) and laid
             out as a column so a tall body shrinks and scrolls instead of
             pushing the header/footer off-screen on short windows. -->
        <div
          class="relative bg-surface dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700/80 shadow-[0_24px_48px_-12px_rgba(28,25,23,0.18)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)] w-full max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
          :class="sizeClasses[size]"
          @click.stop
        >
          <!-- Header -->
          <div v-if="title || $slots.header" class="shrink-0 flex items-center justify-between px-6 py-4 border-b border-paper-line/70 dark:border-gray-700/80">
            <slot name="header">
              <h3 class="text-[17px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{{ title }}</h3>
            </slot>
            <button
              v-if="closable"
              type="button"
              @click="close"
              class="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 rounded-xl transition-colors"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Body: min-h-0 lets it shrink below its content inside the
               column so the scroll happens here, not on the whole dialog. -->
          <div class="px-6 py-4 max-h-[70vh] min-h-0 overflow-y-auto">
            <slot />
          </div>

          <!-- Footer -->
          <div v-if="$slots.footer" class="shrink-0 px-6 py-4 border-t border-paper-line/70 dark:border-gray-700/80 bg-paper/40 dark:bg-gray-800/50">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}
</style>
