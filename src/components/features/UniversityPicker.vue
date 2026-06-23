<script setup>
import { ref, computed } from 'vue'
import { schoolLogo } from '../../lib/schoolLogos'

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const query = ref('')

const BADGE_COLORS = [
  '#1f7f49', // primary green
  '#0d9488', // teal
  '#b4512e', // rust
  '#4f46e5', // indigo
  '#7c3aed', // violet
  '#b45309', // amber
  '#be185d', // rose
  '#0e7490', // cyan
  '#15803d', // emerald
  '#6d28d9', // purple
]

function badgeColor(label) {
  if (!label) return BADGE_COLORS[0]
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xffffffff
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length]
}

function initials(label) {
  if (!label) return '?'
  return label
    .split(/\s+/)
    .filter((w) => /[A-Z]/i.test(w[0]))
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('')
}

// A school's bundled logo wins over the initials badge. If an image 404s or
// fails to decode we record its value and quietly fall back to the badge.
const failedLogos = ref(new Set())

function showLogo(value) {
  return Boolean(schoolLogo(value)) && !failedLogos.value.has(value)
}

function onLogoError(value) {
  // Replace the Set so Vue's reactivity picks up the change.
  failedLogos.value = new Set(failedLogos.value).add(value)
}

// "Not set" carries no code; expose the logo resolver to the template.
const logoFor = schoolLogo

// "Not set" is always the first option (value === '')
const notSetOption = computed(() => props.options.find((o) => o.value === '') || { value: '', label: 'Not set - pick later' })
const schoolOptions = computed(() => props.options.filter((o) => o.value !== ''))

const filteredSchools = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return schoolOptions.value
  return schoolOptions.value.filter((o) => o.label.toLowerCase().includes(q))
})

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue)
  return opt?.label || ''
})

function select(value) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="space-y-3">

    <!-- Selected school chip / summary line -->
    <div class="flex items-center gap-2.5 h-6">
      <template v-if="modelValue && selectedLabel">
        <img
          v-if="showLogo(modelValue)"
          :src="logoFor(modelValue)"
          :alt="selectedLabel"
          class="w-5 h-5 rounded object-cover bg-white ring-1 ring-black/5 dark:ring-white/10 shrink-0"
          @error="onLogoError(modelValue)"
        />
        <div
          v-else
          class="w-4 h-4 rounded shrink-0"
          :style="{ backgroundColor: badgeColor(selectedLabel) }"
          aria-hidden="true"
        />
        <span class="text-sm font-medium text-gray-800 dark:text-gray-200 leading-none">{{ selectedLabel }}</span>
        <span class="eyebrow text-primary-600 dark:text-primary-400">selected</span>
      </template>
      <template v-else>
        <span class="eyebrow text-gray-400 dark:text-gray-500">No university selected</span>
      </template>
    </div>

    <!-- Search -->
    <div class="relative">
      <svg
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
      </svg>
      <input
        v-model="query"
        type="text"
        placeholder="Search universities…"
        class="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-surface dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/25 focus-visible:border-primary-300/80 dark:focus-visible:border-primary-600/60 transition-[border-color,box-shadow] duration-200"
      />
    </div>

    <!-- List -->
    <div
      class="rounded-xl border border-gray-200/80 dark:border-gray-700/60 overflow-hidden"
      :class="loading ? 'opacity-60 pointer-events-none' : ''"
    >
      <!-- Loading skeletons -->
      <template v-if="loading">
        <div v-for="i in 6" :key="i" class="flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/40 last:border-b-0">
          <div class="w-8 h-8 rounded-lg bg-gray-200/70 dark:bg-gray-700/60 animate-pulse shrink-0" />
          <div class="h-3.5 rounded-full bg-gray-200/70 dark:bg-gray-700/60 animate-pulse" :style="{ width: (50 + i * 17) % 120 + 80 + 'px' }" />
        </div>
      </template>

      <template v-else>
        <!-- "Not set" row — always visible, hidden only if query filters it out -->
        <button
          v-if="!query"
          type="button"
          class="group w-full flex items-center gap-3 px-4 py-3 border-b border-gray-200/60 dark:border-gray-700/40 text-left transition-colors duration-150"
          :class="modelValue === ''
            ? 'bg-primary-50/60 dark:bg-primary-950/30'
            : 'bg-surface dark:bg-gray-800/50 hover:bg-gray-50/80 dark:hover:bg-gray-700/40'"
          @click="select('')"
        >
          <!-- Dash badge -->
          <div class="w-8 h-8 rounded-lg border-2 border-dashed flex items-center justify-center shrink-0 transition-colors duration-150"
            :class="modelValue === ''
              ? 'border-primary-400/70 dark:border-primary-600/60'
              : 'border-gray-300/80 dark:border-gray-600/60'"
          >
            <svg class="w-3.5 h-3.5 transition-colors duration-150"
              :class="modelValue === '' ? 'text-primary-500 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
            </svg>
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium leading-tight"
              :class="modelValue === '' ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'"
            >Not set</p>
            <p class="font-mono text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Pick later from the Course Planner</p>
          </div>

          <svg v-if="modelValue === ''" class="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>

        <!-- School rows -->
        <div class="max-h-[320px] overflow-y-auto">
          <template v-if="filteredSchools.length">
            <button
              v-for="(option, i) in filteredSchools"
              :key="option.value"
              type="button"
              class="group w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150"
              :class="[
                i < filteredSchools.length - 1 ? 'border-b border-gray-200/50 dark:border-gray-700/30' : '',
                String(option.value) === String(modelValue)
                  ? 'bg-primary-50/60 dark:bg-primary-950/30'
                  : 'bg-surface dark:bg-gray-800/50 hover:bg-gray-50/80 dark:hover:bg-gray-700/40',
              ]"
              @click="select(option.value)"
            >
              <!-- School badge — real logo when bundled, initials otherwise -->
              <div
                class="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center shrink-0 select-none"
                :class="showLogo(option.value) ? 'bg-white ring-1 ring-black/5 dark:ring-white/10' : ''"
                :style="showLogo(option.value) ? null : { backgroundColor: badgeColor(option.label) }"
              >
                <img
                  v-if="showLogo(option.value)"
                  :src="logoFor(option.value)"
                  :alt="option.label"
                  class="w-full h-full object-cover"
                  loading="lazy"
                  @error="onLogoError(option.value)"
                />
                <span v-else class="text-white text-[10px] font-bold">{{ initials(option.label) }}</span>
              </div>

              <!-- Name -->
              <span
                class="flex-1 min-w-0 text-sm font-medium leading-tight truncate transition-colors duration-150"
                :class="String(option.value) === String(modelValue)
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100'"
              >{{ option.label }}</span>

              <!-- Check -->
              <svg
                v-if="String(option.value) === String(modelValue)"
                class="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </template>

          <!-- Empty search state -->
          <div v-else class="px-4 py-8 text-center">
            <p class="text-sm text-gray-400 dark:text-gray-500">No universities match "<span class="font-medium text-gray-600 dark:text-gray-400">{{ query }}</span>"</p>
          </div>
        </div>
      </template>
    </div>

    <!-- Error -->
    <p v-if="error" class="flex items-center gap-1.5 text-sm text-danger-600 dark:text-danger-400">
      <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {{ error }}
    </p>
  </div>
</template>
