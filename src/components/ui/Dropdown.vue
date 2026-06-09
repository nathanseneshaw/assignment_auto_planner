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
const triggerRef = ref(null)

const selectedLabel = computed(
  () => props.options.find((o) => String(o.value) === String(props.modelValue))?.label ?? '',
)

function select(value) {
  emit('update:modelValue', value)
  emit('change', value)
  open.value = false
  triggerRef.value?.focus()
}

function onOutsideClick(e) {
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    open.value = false
  }
}

function onKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    triggerRef.value?.focus()
  }
}

onMounted(() => document.addEventListener('mousedown', onOutsideClick))
onUnmounted(() => document.removeEventListener('mousedown', onOutsideClick))

const triggerClasses = computed(() => [
  'w-full flex items-center justify-between gap-2 rounded-xl border bg-surface dark:bg-gray-800 text-left font-medium tracking-tight text-gray-900 dark:text-gray-100',
  'transition-[border-color,box-shadow,background-color] duration-200 ease-out',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 dark:focus-visible:ring-primary-500/30 cursor-pointer',
  props.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-[15px]',
  open.value
    ? 'border-primary-300/80 dark:border-primary-600/75 ring-2 ring-primary-500/20'
    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300/90 dark:hover:border-gray-600',
])

const chevronSize = computed(() => (props.size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]'))
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" class="block text-sm font-medium text-gray-600 dark:text-gray-400">
      {{ label }}
      <span v-if="required" class="text-danger-500">*</span>
    </label>

    <div ref="containerRef" class="relative" @keydown="onKeydown">
      <button
        ref="triggerRef"
        type="button"
        :aria-expanded="open"
        aria-haspopup="listbox"
        :class="triggerClasses"
        @click="open = !open"
      >
        <span class="truncate">{{ selectedLabel }}</span>
        <svg
          :class="[chevronSize, 'shrink-0 text-gray-400 transition-transform duration-200', open ? 'rotate-180' : '']"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

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
          role="listbox"
          class="absolute left-0 right-0 mt-1.5 z-50 rounded-xl border border-gray-200/80 dark:border-gray-700 bg-surface dark:bg-gray-800 py-1 shadow-[0_4px_20px_rgba(28,25,23,0.10),0_1px_4px_rgba(28,25,23,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.35)]"
          style="max-height: 280px; overflow-y: auto;"
        >
          <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            role="option"
            :aria-selected="String(opt.value) === String(modelValue)"
            class="w-full flex items-center justify-between gap-2 text-left font-medium tracking-tight transition-colors duration-100"
            :class="[
              size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-3.5 py-2 text-[14px]',
              String(opt.value) === String(modelValue)
                ? 'bg-gray-100/80 dark:bg-gray-700/70 text-gray-900 dark:text-gray-100'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100',
            ]"
            @click="select(opt.value)"
          >
            <span class="truncate">{{ opt.label }}</span>
            <svg
              v-if="String(opt.value) === String(modelValue)"
              class="w-4 h-4 shrink-0 text-primary-700 dark:text-primary-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>
