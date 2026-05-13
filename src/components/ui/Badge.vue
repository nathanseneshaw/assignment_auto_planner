<script setup>
defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'primary', 'success', 'warning', 'danger'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  dot: {
    type: Boolean,
    default: false
  },
  removable: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['remove'])

const variantClasses = {
  default: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
  primary: 'bg-primary-100 dark:bg-primary-900/50 text-primary-800 dark:text-primary-300',
  success: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  warning: 'bg-warning-100 dark:bg-warning-900/40 text-warning-800 dark:text-warning-300',
  danger: 'bg-danger-100 dark:bg-danger-900/40 text-danger-800 dark:text-danger-300'
}

const dotColors = {
  default: 'bg-gray-500',
  primary: 'bg-primary-500',
  success: 'bg-green-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500'
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-xs',
  lg: 'px-3 py-1 text-sm'
}
</script>

<template>
  <span 
    class="inline-flex items-center gap-1.5 font-medium rounded-full"
    :class="[variantClasses[variant], sizeClasses[size]]"
  >
    <span 
      v-if="dot" 
      class="w-1.5 h-1.5 rounded-full"
      :class="dotColors[variant]"
    ></span>
    
    <slot />
    
    <button 
      v-if="removable"
      @click.stop="emit('remove')"
      class="ml-0.5 -mr-1 p-0.5 rounded-full hover:bg-black/10 transition-colors"
    >
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </span>
</template>
