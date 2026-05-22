<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: '',
  },
  options: {
    type: Array,
    required: true,
  },
  label: {
    type: String,
    default: '',
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

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const containerRef = ref(null)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)

function select(value) {
  emit('update:modelValue', value)
  emit('change', value)
  open.value = false
}

function onOutsideClick(e) {
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onOutsideClick))
onUnmounted(() => document.removeEventListener('mousedown', onOutsideClick))

const triggerClasses = computed(() => {
  const size =
    props.size === 'sm'
      ? 'pl-3 pr-12 py-2 text-sm'
      : 'pl-4 pr-14 py-2.5 text-[15px]'
  return [
    'w-full rounded-2xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium tracking-tight antialiased text-left truncate',
    'shadow-[0_1px_2px_rgba(28,25,23,0.04),0_1px_3px_rgba(28,25,23,0.06)]',
    'transition-[border-color,box-shadow] duration-200 ease-out',
    'focus:outline-none cursor-pointer',
    open.value
      ? 'border-primary-400/75 dark:border-primary-600/75 ring-2 ring-primary-500/25'
      : 'border-gray-200/90 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-[0_2px_6px_-2px_rgba(28,25,23,0.07),0_1px_2px_rgba(28,25,23,0.05)]',
    size,
  ]
})

const chevronWrapClasses = computed(() => {
  const dim = props.size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const base =
    'pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-lg border transition-[border-color,background-color,color,box-shadow] duration-200 ease-out'
  if (open.value) {
    return [
      base,
      dim,
      'border-primary-200/90 dark:border-primary-700/60 bg-gradient-to-b from-primary-50/90 dark:from-primary-900/40 to-primary-100/50 dark:to-primary-900/20 text-primary-700 dark:text-primary-400',
    ]
  }
  return [
    base,
    dim,
    'border-gray-200/80 dark:border-gray-700 bg-gradient-to-b from-white dark:from-gray-700 to-gray-100/95 dark:to-gray-700/80 text-gray-500 dark:text-gray-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.85)] dark:shadow-none',
  ]
})

const chevronSize = computed(() => (props.size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'))
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" class="block text-sm font-medium text-gray-600 dark:text-gray-400">
      {{ label }}
      <span v-if="required" class="text-danger-500">*</span>
    </label>

    <div ref="containerRef" class="relative">
      <button type="button" :class="triggerClasses" @click="open = !open">
        {{ selectedLabel }}
      </button>

      <span :class="chevronWrapClasses" aria-hidden="true">
        <svg
          :class="[chevronSize, 'transition-transform duration-200', open ? 'rotate-180' : '']"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </span>

      <Transition
        enter-active-class="transition duration-150 ease-out origin-top"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in origin-top"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="open"
          class="absolute left-0 right-0 mt-1.5 z-50 rounded-xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-[0_4px_20px_rgba(28,25,23,0.10),0_1px_4px_rgba(28,25,23,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.35)]"
        >
          <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="w-full text-left px-3 py-2.5 text-sm font-medium transition-colors duration-100 flex items-center justify-between gap-2"
            :class="
              opt.value === modelValue
                ? 'bg-primary-900 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            "
            @click="select(opt.value)"
          >
            {{ opt.label }}
            <svg
              v-if="opt.value === modelValue"
              class="w-3.5 h-3.5 shrink-0 opacity-80"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>
