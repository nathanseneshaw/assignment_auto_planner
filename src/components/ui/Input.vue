<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: ''
  },
  type: {
    type: String,
    default: 'text'
  },
  label: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  error: {
    type: String,
    default: ''
  },
  hint: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  required: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'focus', 'blur'])

const inputClasses = computed(() => [
  'w-full px-4 py-2.5 rounded-xl border bg-white transition-[border-color,box-shadow,background-color] duration-200',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20',
  'placeholder:text-gray-400',
  'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed',
  props.error 
    ? 'border-danger-300 focus-visible:ring-danger-500/25 bg-danger-50/50' 
    : 'border-gray-200 hover:border-gray-300/90 focus-visible:border-primary-300/80'
])

function handleInput(e) {
  emit('update:modelValue', e.target.value)
}
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" class="block text-sm font-medium text-gray-600">
      {{ label }}
      <span v-if="required" class="text-danger-500">*</span>
    </label>
    
    <div class="relative">
      <slot name="prefix" />
      
      <input
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :class="inputClasses"
        @input="handleInput"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
      />
      
      <slot name="suffix" />
    </div>

    <p v-if="error" class="text-sm text-danger-600 flex items-center gap-1">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {{ error }}
    </p>
    
    <p v-else-if="hint" class="text-sm text-gray-500">
      {{ hint }}
    </p>
  </div>
</template>
