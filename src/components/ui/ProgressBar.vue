<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: {
    type: Number,
    default: 0,
    validator: (v) => v >= 0 && v <= 100
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'success', 'warning', 'danger', 'gradient'].includes(v)
  },
  showLabel: {
    type: Boolean,
    default: false
  },
  animated: {
    type: Boolean,
    default: false
  }
})

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3'
}

const variantClasses = {
  primary: 'bg-primary-700',
  success: 'bg-emerald-600',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  gradient: 'bg-gradient-to-r from-primary-800 to-primary-950'
}

const progressColor = computed(() => {
  if (props.variant === 'gradient') return variantClasses.gradient
  
  if (props.value === 100) return variantClasses.success
  if (props.value >= 75) return variantClasses.primary
  if (props.value >= 50) return variantClasses.warning
  if (props.value >= 25) return variantClasses.warning
  return variantClasses.danger
})
</script>

<template>
  <div class="w-full">
    <div v-if="showLabel" class="flex items-center justify-between mb-1">
      <slot name="label">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-400">Progress</span>
      </slot>
      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ value }}%</span>
    </div>
    
    <div
      class="w-full bg-gray-200/90 dark:bg-gray-700 rounded-full overflow-hidden ring-1 ring-inset ring-gray-200/50 dark:ring-gray-600/50"
      :class="sizeClasses[size]"
    >
      <div 
        class="h-full rounded-full transition-all duration-500 ease-out"
        :class="[
          variant === 'gradient' ? variantClasses.gradient : variantClasses[variant],
          animated ? 'animate-pulse' : ''
        ]"
        :style="{ width: `${value}%` }"
      ></div>
    </div>
  </div>
</template>
