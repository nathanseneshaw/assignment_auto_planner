<script setup>
import { computed, ref, onMounted, onUnmounted, useAttrs } from 'vue'

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
  // When provided, renders a custom styled dropdown instead of native <select>
  options: {
    type: Array,
    default: null,
  },
  placeholder: {
    type: String,
    default: 'Select…',
  },
})

const emit = defineEmits(['update:modelValue', 'change', 'focus', 'blur'])
const attrs = useAttrs()

// ── Custom dropdown state ────────────────────────────────────────────────────
const open = ref(false)
const containerRef = ref(null)
const triggerRef = ref(null)

const selectedOption = computed(() => {
  if (!props.options) return null
  return props.options.find((o) => String(o.value) === String(props.modelValue)) || null
})

const displayLabel = computed(() => selectedOption.value?.label ?? '')

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

function selectOption(option) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  open.value = false
  triggerRef.value?.focus()
}

function onClickOutside(e) {
  if (!containerRef.value?.contains(e.target)) open.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    triggerRef.value?.focus()
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))

// ── Native <select> helpers (fallback mode) ──────────────────────────────────
const selectClasses = computed(() => {
  const size = props.size === 'sm' ? ['pl-3 pr-10 py-2 text-sm'] : ['pl-4 pr-11 py-2.5 text-[15px]']
  return [
    'w-full rounded-xl border bg-white text-gray-900 font-medium tracking-tight',
    'transition-[border-color,box-shadow,background-color] duration-200',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20',
    'appearance-none cursor-pointer',
    'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed',
    props.error
      ? 'border-danger-300 bg-danger-50/50 focus-visible:ring-danger-500/25'
      : 'border-gray-200 hover:border-gray-300/90 focus-visible:border-primary-300/80',
    ...size,
  ]
})

const chevronSize = computed(() => (props.size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]'))

function onNativeChange(e) {
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

    <!-- ── Custom dropdown (when options prop is provided) ── -->
    <div
      v-if="options !== null"
      ref="containerRef"
      class="relative"
      @keydown="onKeydown"
    >
      <!-- Trigger -->
      <button
        ref="triggerRef"
        type="button"
        :disabled="disabled"
        :aria-expanded="open"
        aria-haspopup="listbox"
        class="w-full flex items-center justify-between gap-2 rounded-xl border bg-white text-left font-medium tracking-tight transition-[border-color,box-shadow,background-color] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
        :class="[
          size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-[15px]',
          error
            ? 'border-danger-300 bg-danger-50/50 focus-visible:ring-danger-500/25'
            : open
              ? 'border-primary-300/80 ring-2 ring-primary-500/20'
              : 'border-gray-200 hover:border-gray-300/90',
          displayLabel ? 'text-gray-900' : 'text-gray-400',
        ]"
        @click="toggle"
        @focus="emit('focus', $event)"
        @blur="!open && emit('blur', $event)"
      >
        <span class="truncate">{{ displayLabel || placeholder }}</span>
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

      <!-- Dropdown panel -->
      <Transition name="dropdown">
        <div
          v-if="open"
          role="listbox"
          class="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200/80 bg-white py-1 shadow-[0_4px_16px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04)]"
          style="max-height: 280px; overflow-y: auto;"
        >
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            role="option"
            :aria-selected="String(option.value) === String(modelValue)"
            class="w-full flex items-center justify-between gap-2 text-left font-medium tracking-tight transition-colors"
            :class="[
              size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-3.5 py-2 text-[14px]',
              option.disabled
                ? 'cursor-not-allowed text-gray-400'
                : String(option.value) === String(modelValue)
                  ? 'bg-gray-100/80 text-gray-900 cursor-pointer'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 cursor-pointer',
            ]"
            :disabled="option.disabled"
            @click="selectOption(option)"
          >
            <span class="truncate">{{ option.label }}</span>
            <svg
              v-if="String(option.value) === String(modelValue)"
              class="w-4 h-4 shrink-0 text-primary-700"
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

    <!-- ── Native select fallback (no options prop) ── -->
    <div v-else class="relative">
      <select
        :value="modelValue === null || modelValue === undefined ? '' : modelValue"
        :disabled="disabled"
        :required="required"
        :class="selectClasses"
        v-bind="attrs"
        @change="onNativeChange"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
      >
        <slot />
      </select>
      <svg
        :class="[chevronSize, 'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400']"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>

    <p v-if="error" class="text-sm text-danger-600 flex items-center gap-1">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {{ error }}
    </p>
    <p v-else-if="hint" class="text-sm text-gray-500">{{ hint }}</p>
  </div>
</template>

<style scoped>
select option {
  font-weight: 500;
  padding: 0.5rem 0.75rem;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
