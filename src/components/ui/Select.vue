<script setup>
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: '',
  },
  label: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: '',
  },
  hint: {
    type: String,
    default: '',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  required: {
    type: Boolean,
    default: false,
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md'].includes(v),
  },
})

const emit = defineEmits(['update:modelValue', 'change', 'focus', 'blur'])

const attrs = useAttrs()

const selectClasses = computed(() => {
  const size =
    props.size === 'sm'
      ? ['pl-3 pr-12 py-2 text-sm']
      : ['pl-4 pr-14 py-2.5 text-[15px]']

  return [
      'w-full rounded-2xl border bg-white text-gray-900 font-medium tracking-tight antialiased',
      'shadow-[0_1px_2px_rgba(28,25,23,0.04),0_1px_3px_rgba(28,25,23,0.06)]',
      'transition-[border-color,box-shadow] duration-200 ease-out',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/25 focus-visible:ring-offset-0',
      'hover:border-gray-300 hover:shadow-[0_2px_6px_-2px_rgba(28,25,23,0.07),0_1px_2px_rgba(28,25,23,0.05)]',
      'active:shadow-[0_1px_2px_rgba(28,25,23,0.05)]',
      'appearance-none cursor-pointer',
      'disabled:cursor-not-allowed disabled:border-gray-200/70 disabled:bg-gray-50 disabled:text-gray-500 disabled:shadow-none disabled:hover:border-gray-200/70 disabled:hover:shadow-none',
      props.error
        ? 'border-danger-300/90 bg-danger-50/35 focus-visible:border-danger-400 focus-visible:ring-danger-500/20'
        : 'border-gray-200/90 focus-visible:border-primary-400/75',
      ...size,
    ]
})

const chevronWrapClasses = computed(() => {
  const base =
    'pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-lg border transition-[border-color,background-color,color,box-shadow] duration-200 ease-out'
  const dim = props.size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  if (props.disabled) {
    return [base, dim, 'border-transparent bg-gray-100/90 text-gray-400']
  }
  if (props.error) {
    return [
      base,
      dim,
      'border-danger-200/70 bg-white/80 text-danger-500 group-focus-within:border-danger-300 group-focus-within:bg-danger-50/80',
    ]
  }
  return [
    base,
    dim,
    'border-gray-200/80 bg-gradient-to-b from-white to-gray-100/95 text-gray-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.85)]',
    'group-focus-within:border-primary-200/90 group-focus-within:bg-gradient-to-b group-focus-within:from-primary-50/90 group-focus-within:to-primary-100/50 group-focus-within:text-primary-700 group-focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]',
  ]
})

const chevronSize = computed(() => (props.size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'))

function onChange(e) {
  const v = e.target.value
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" class="block text-sm font-medium text-gray-600">
      {{ label }}
      <span v-if="required" class="text-danger-500">*</span>
    </label>

    <div class="group relative">
      <select
        :value="modelValue === null || modelValue === undefined ? '' : modelValue"
        :disabled="disabled"
        :required="required"
        :class="selectClasses"
        v-bind="attrs"
        @change="onChange"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
      >
        <slot />
      </select>
      <span :class="chevronWrapClasses" aria-hidden="true">
        <svg
          :class="chevronSize"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </div>

    <p v-if="error" class="text-sm text-danger-600 flex items-center gap-1">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {{ error }}
    </p>

    <p v-else-if="hint" class="text-sm text-gray-500">
      {{ hint }}
    </p>
  </div>
</template>

<style scoped>
/* Slightly nicer native option list where supported */
select option {
  font-weight: 500;
  padding: 0.5rem 0.75rem;
}
</style>
