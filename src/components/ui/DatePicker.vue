<script setup>
/**
 * Custom date picker  a styled, in-app replacement for `<input type="date">`,
 * whose native popup can't be themed. Drop-in compatible: v-models a
 * `YYYY-MM-DD` string (same value the native input produces) or '' when empty.
 *
 * The calendar popover is teleported to <body> and positioned `fixed` against
 * the trigger so it's never clipped by an ancestor's `overflow` (e.g. the modal
 * body is `overflow-y-auto`), and flips above the field when there's no room
 * below. All date math is local-timezone (never toISOString) to avoid UTC drift.
 */
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' }, // 'YYYY-MM-DD' | ''
  placeholder: { type: String, default: 'Select a date' },
  clearable: { type: Boolean, default: true },
  size: { type: String, default: 'md', validator: (v) => ['sm', 'md'].includes(v) },
})

const emit = defineEmits(['update:modelValue', 'change'])

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// ── local-date helpers (never toISOString → avoids UTC drift) ───────────────
const pad = (n) => String(n).padStart(2, '0')
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseKey = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const isValidKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

const today = new Date()
const todayKey = toKey(today)

const open = ref(false)
const view = ref('days') // 'days' | 'months'
const triggerRef = ref(null)
const panelRef = ref(null)

// Month shown in the grid + the day the keyboard cursor sits on.
const anchor = ref(new Date(today.getFullYear(), today.getMonth(), 1))
const activeKey = ref(todayKey)

const selectedKey = computed(() => (isValidKey(props.modelValue) ? props.modelValue : ''))

const displayValue = computed(() => {
  if (!selectedKey.value) return ''
  const d = parseKey(selectedKey.value)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
})

const headerLabel = computed(() => `${MONTHS_LONG[anchor.value.getMonth()]} ${anchor.value.getFullYear()}`)
const yearLabel = computed(() => String(anchor.value.getFullYear()))

const cells = computed(() => {
  const y = anchor.value.getFullYear()
  const m = anchor.value.getMonth()
  const startPad = new Date(y, m, 1).getDay() // week starts Sunday
  const gridStart = new Date(y, m, 1 - startPad)
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const key = toKey(d)
    out.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: key === todayKey,
      isSelected: key === selectedKey.value,
      isActive: key === activeKey.value,
    })
  }
  return out
})

const monthCells = computed(() => {
  const sel = selectedKey.value ? parseKey(selectedKey.value) : null
  const y = anchor.value.getFullYear()
  return MONTHS_SHORT.map((label, idx) => ({
    label,
    idx,
    isToday: idx === today.getMonth() && y === today.getFullYear(),
    isSelected: !!sel && sel.getMonth() === idx && sel.getFullYear() === y,
  }))
})

// ── positioning (teleported, fixed, flips up when cramped) ──────────────────
const PANEL_W = 304
const PANEL_H = 376
const panelStyle = ref({})

function reposition() {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const margin = 8
  let left = Math.min(r.left, window.innerWidth - PANEL_W - margin)
  left = Math.max(margin, left)
  const spaceBelow = window.innerHeight - r.bottom
  const openUp = spaceBelow < PANEL_H + margin && r.top > spaceBelow
  const top = openUp ? Math.max(margin, r.top - PANEL_H - margin) : r.bottom + margin
  panelStyle.value = { position: 'fixed', top: `${top}px`, left: `${left}px`, width: `${PANEL_W}px` }
}

function openPicker() {
  view.value = 'days'
  const base = selectedKey.value ? parseKey(selectedKey.value) : today
  anchor.value = new Date(base.getFullYear(), base.getMonth(), 1)
  activeKey.value = selectedKey.value || todayKey
  open.value = true
  nextTick(reposition)
}
function closePicker(focusTrigger = false) {
  open.value = false
  if (focusTrigger) triggerRef.value?.focus()
}
function toggle() { open.value ? closePicker() : openPicker() }

// ── selection / nav ─────────────────────────────────────────────────────────
function selectKey(key) {
  emit('update:modelValue', key)
  emit('change', key)
  closePicker(true)
}
function selectToday() {
  anchor.value = new Date(today.getFullYear(), today.getMonth(), 1)
  selectKey(todayKey)
}
function clear() {
  emit('update:modelValue', '')
  emit('change', '')
  closePicker(true)
}
function shiftMonth(delta) {
  const d = new Date(anchor.value)
  d.setMonth(d.getMonth() + delta)
  anchor.value = new Date(d.getFullYear(), d.getMonth(), 1)
}
function shiftYear(delta) {
  const d = new Date(anchor.value)
  d.setFullYear(d.getFullYear() + delta)
  anchor.value = new Date(d.getFullYear(), d.getMonth(), 1)
}
function pickMonth(idx) {
  anchor.value = new Date(anchor.value.getFullYear(), idx, 1)
  view.value = 'days'
}

// ── keyboard navigation across the day grid ─────────────────────────────────
const dayRefs = new Map()
function setDayRef(key, el) { if (el) dayRefs.set(key, el); else dayRefs.delete(key) }
async function focusActive() { await nextTick(); dayRefs.get(activeKey.value)?.focus() }

function onGridKeydown(e) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  if (e.key in step) {
    e.preventDefault()
    const d = parseKey(activeKey.value)
    d.setDate(d.getDate() + step[e.key])
    activeKey.value = toKey(d)
    if (d.getMonth() !== anchor.value.getMonth() || d.getFullYear() !== anchor.value.getFullYear()) {
      anchor.value = new Date(d.getFullYear(), d.getMonth(), 1)
    }
    focusActive()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    selectKey(activeKey.value)
  } else if (e.key === 'PageUp') {
    e.preventDefault(); shiftMonth(-1)
  } else if (e.key === 'PageDown') {
    e.preventDefault(); shiftMonth(1)
  }
}

// ── outside-click / escape / reflow on scroll+resize ────────────────────────
function onDocMousedown(e) {
  if (!open.value) return
  if (triggerRef.value?.contains(e.target)) return
  if (panelRef.value?.contains(e.target)) return
  open.value = false
}
function onDocKeydown(e) {
  if (e.key === 'Escape' && open.value) { e.preventDefault(); closePicker(true) }
}
function onWinChange() { if (open.value) reposition() }

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('resize', onWinChange)
  window.addEventListener('scroll', onWinChange, true)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('resize', onWinChange)
  window.removeEventListener('scroll', onWinChange, true)
})

const triggerClasses = computed(() => [
  'w-full flex items-center justify-between gap-2 rounded-xl border bg-surface dark:bg-gray-800 text-left tracking-tight',
  'transition-[border-color,box-shadow,background-color] duration-200 ease-out cursor-pointer',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 dark:focus-visible:ring-primary-500/30',
  props.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-[15px]',
  open.value
    ? 'border-primary-300/80 dark:border-primary-600/75 ring-2 ring-primary-500/20'
    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300/90 dark:hover:border-gray-600',
])

function dayClasses(cell) {
  if (cell.isSelected) return 'bg-primary-600 text-white font-semibold shadow-sm shadow-primary-900/20'
  if (cell.isToday) return 'text-primary-700 dark:text-primary-400 font-semibold ring-1 ring-inset ring-primary-500/45 hover:bg-paper-line/60 dark:hover:bg-gray-700/50'
  if (!cell.inMonth) return 'text-gray-300 dark:text-gray-600 hover:bg-paper-line/40 dark:hover:bg-gray-700/30'
  return 'text-gray-700 dark:text-gray-300 hover:bg-paper-line/60 dark:hover:bg-gray-700/50'
}
</script>

<template>
  <div class="relative">
    <!-- Trigger -->
    <button
      ref="triggerRef"
      type="button"
      :class="triggerClasses"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <span :class="displayValue ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'">
        {{ displayValue || placeholder }}
      </span>
      <svg
        class="shrink-0 text-gray-400 w-[18px] h-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </button>

    <!-- Calendar popover (teleported so it escapes modal overflow clipping) -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="open"
          ref="panelRef"
          :style="panelStyle"
          role="dialog"
          aria-label="Choose date"
          class="z-[60] rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-surface dark:bg-gray-800 p-3.5 shadow-[0_12px_36px_rgba(28,25,23,0.16),0_2px_8px_rgba(28,25,23,0.08)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.45)]"
        >
          <!-- Header -->
          <div class="flex items-center justify-between gap-2 mb-3">
            <button
              type="button"
              class="font-serif text-[15px] text-gray-900 dark:text-gray-100 hover:text-primary-700 dark:hover:text-primary-400 transition-colors rounded-lg px-1.5 -mx-1.5 py-0.5"
              @click="view = view === 'days' ? 'months' : 'days'"
            >
              {{ view === 'days' ? headerLabel : yearLabel }}
            </button>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-paper-line/60 dark:hover:bg-gray-700/50 transition-colors"
                :aria-label="view === 'days' ? 'Previous month' : 'Previous year'"
                @click="view === 'days' ? shiftMonth(-1) : shiftYear(-1)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button
                type="button"
                class="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-paper-line/60 dark:hover:bg-gray-700/50 transition-colors"
                :aria-label="view === 'days' ? 'Next month' : 'Next year'"
                @click="view === 'days' ? shiftMonth(1) : shiftYear(1)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>

          <!-- Days view -->
          <template v-if="view === 'days'">
            <div class="grid grid-cols-7 mb-1">
              <span
                v-for="(d, i) in WEEKDAYS"
                :key="`wd-${i}`"
                class="text-center font-mono text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 py-1"
              >{{ d }}</span>
            </div>

            <div class="grid grid-cols-7 gap-y-0.5" @keydown="onGridKeydown">
              <button
                v-for="cell in cells"
                :key="cell.key"
                :ref="(el) => setDayRef(cell.key, el)"
                type="button"
                :tabindex="cell.isActive ? 0 : -1"
                :aria-current="cell.isToday ? 'date' : undefined"
                :aria-pressed="cell.isSelected"
                class="h-9 flex items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
                :class="dayClasses(cell)"
                @click="selectKey(cell.key)"
              >
                {{ cell.day }}
              </button>
            </div>
          </template>

          <!-- Months view -->
          <div v-else class="grid grid-cols-3 gap-1.5">
            <button
              v-for="mc in monthCells"
              :key="mc.idx"
              type="button"
              class="h-11 flex items-center justify-center rounded-lg text-[13px] font-medium transition-colors"
              :class="mc.isSelected
                ? 'bg-primary-600 text-white shadow-sm shadow-primary-900/20'
                : mc.isToday
                  ? 'text-primary-700 dark:text-primary-400 ring-1 ring-inset ring-primary-500/45 hover:bg-paper-line/60 dark:hover:bg-gray-700/50'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-paper-line/60 dark:hover:bg-gray-700/50'"
              @click="pickMonth(mc.idx)"
            >
              {{ mc.label }}
            </button>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between mt-3 pt-2.5 border-t border-paper-line dark:border-gray-700/60">
            <button
              v-if="clearable"
              type="button"
              class="text-[12.5px] font-medium text-gray-400 hover:text-rust-600 dark:hover:text-rust-500 transition-colors"
              @click="clear"
            >
              Clear
            </button>
            <span v-else />
            <button
              type="button"
              class="text-[12.5px] font-medium text-primary-700 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 transition-colors"
              @click="selectToday"
            >
              Today
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
