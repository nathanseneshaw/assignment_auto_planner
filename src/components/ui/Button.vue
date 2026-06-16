<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'danger', 'ghost', 'outline'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  loading: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  icon: {
    type: Boolean,
    default: false
  },
  block: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

const variantClasses = {
  primary: 'bg-primary-900 text-white hover:bg-primary-800 focus-visible:ring-primary-500/35 shadow-sm shadow-primary-900/15',
  secondary: 'bg-surface text-gray-800 border border-gray-200/90 hover:bg-gray-50 hover:border-gray-300 focus-visible:ring-gray-400/25 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-700 dark:hover:border-gray-600',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500/35 shadow-sm shadow-danger-600/15',
  ghost: 'bg-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 focus-visible:ring-gray-400/20',
  outline: 'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50/90 hover:border-gray-400 focus-visible:ring-gray-400/25'
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base'
}

const iconSizeClasses = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3'
}

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-xl font-semibold text-[13px] transition-[color,background-color,box-shadow,border-color,transform] duration-200 ease-out',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
  // Disabled: a clean, warm-neutral fill rather than a washed-out tint of the
  // variant color (a 50%-opacity emerald read as muddy sage over white panels).
  'disabled:cursor-not-allowed disabled:pointer-events-none disabled:bg-gray-100 dark:disabled:bg-gray-700/50 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:border-transparent disabled:shadow-none active:scale-[0.98]',
  variantClasses[props.variant],
  props.icon ? iconSizeClasses[props.size] : sizeClasses[props.size],
  props.block ? 'w-full' : '',
  props.loading ? 'relative text-transparent' : ''
])

function handleClick(e) {
  if (!props.loading && !props.disabled) {
    emit('click', e)
  }
}
</script>

<template>
  <button 
    :class="classes"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <!-- Loading Spinner -->
    <span 
      v-if="loading" 
      class="absolute inset-0 flex items-center justify-center"
    >
      <svg class="w-5 h-5 animate-spin text-current" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </span>
    
    <slot />
  </button>
</template>
