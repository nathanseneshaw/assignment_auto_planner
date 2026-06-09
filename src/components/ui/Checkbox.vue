<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  label: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue'])

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6'
}

const toggle = () => {
  if (!props.disabled) {
    emit('update:modelValue', !props.modelValue)
  }
}
</script>

<template>
  <label 
    class="inline-flex items-center gap-2 cursor-pointer"
    :class="{ 'opacity-50 cursor-not-allowed': disabled }"
    @click.prevent="toggle"
  >
    <span 
      class="relative flex items-center justify-center rounded-full border-2 transition-all duration-200"
      :class="[
        sizeClasses[size],
        modelValue 
          ? 'bg-primary-600 border-primary-600' 
          : 'border-gray-300 hover:border-primary-400 bg-surface'
      ]"
    >
      <svg 
        v-if="modelValue"
        class="w-3/4 h-3/4 text-white" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
        stroke-width="3"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
    <span v-if="label" class="text-gray-700 select-none">{{ label }}</span>
    <slot />
  </label>
</template>
