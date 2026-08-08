<script setup>
/**
 * Time picker combobox - a styled replacement for `<input type="time">`.
 * v-models the SAME value the native input produces: a 24-hour 'HH:MM'
 * string ('09:00', '18:30') or '' when empty, so it's a drop-in swap.
 *
 * Interaction is type-or-pick (Google Calendar style): the field is a real
 * text input that accepts loose formats ('9', '930p', '9:30 pm', '21:15')
 * and parses on Enter/blur. The panel splits selection into two axes: a
 * scrollable column of 12-hour times (12:00 ... 11:30, half the entries of
 * a full-day list) and an AM/PM toggle pinned beside it. The committed value
 * is the picked number combined with the current meridiem, so switching AM/PM
 * re-times an already-chosen number without reopening the list.
 *
 * The value commits only on Enter, blur, an option/meridiem click, or Clear -
 * never per keystroke - so bound stores don't churn while the user is
 * mid-edit. Invalid text reverts on blur/Escape; emptying the field clears.
 *
 * The panel is teleported to <body> and positioned fixed against the trigger
 * (same scheme as Dropdown.vue) so ancestor overflow never clips it.
 */
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' }, // 'HH:MM' (24h) | ''
  placeholder: { type: String, default: 'Select a time' },
  clearable: { type: Boolean, default: true },
  size: { type: String, default: 'md', validator: (v) => ['sm', 'md'].includes(v) },
  minuteStep: { type: Number, default: 30 },
})

const emit = defineEmits(['update:modelValue', 'change'])

const pad = (n) => String(n).padStart(2, '0')

/** 'HH:MM' -> '9:30 AM' for display; '' for empty/invalid. */
function format(hhmm) {
  if (!/^\d{1,2}:\d{2}$/.test(String(hhmm))) return ''
  const [h, m] = String(hhmm).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * Loose text -> 'HH:MM' | null. Accepts '9', '09', '930', '9:30', '9.30',
 * with an optional a/am/p/pm suffix. Bare hours without a meridiem read as
 * 24-hour ('13' -> 13:00).
 */
function parseTime(input) {
  const cleaned = String(input).toLowerCase().replace(/[\s.]/g, '')
  const m = /^(\d{1,2})(?::?([0-5]\d))?(a|am|p|pm)?$/.exec(cleaned)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const mer = m[3] ? m[3][0] : ''
  if (mer) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (mer === 'p' ? 12 : 0)
  } else if (h > 23) {
    return null
  }
  return `${pad(h)}:${pad(min)}`
}

/** Typed text -> { digits, mer } for prefix-filtering the list; null if unfilterable. */
function splitQuery(input) {
  const cleaned = String(input).toLowerCase().replace(/[\s.:]/g, '')
  const m = /^(\d{1,4})(a|am|p|pm)?$/.exec(cleaned)
  if (!m) return null
  return { digits: m[1].replace(/^0+(?=\d)/, ''), mer: m[2] ? m[2][0] : '' }
}

/** 'HH:MM' -> { h12, m, mer } | null. */
function parseSelected(hhmm) {
  if (!/^\d{1,2}:\d{2}$/.test(String(hhmm))) return null
  const [h, m] = String(hhmm).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return { h12: h % 12 === 0 ? 12 : h % 12, m, mer: h < 12 ? 'AM' : 'PM' }
}

/** (12-hour number, meridiem) -> 24-hour 'HH:MM'. */
function toValue(h12, m, mer) {
  const h = (h12 % 12) + (mer === 'PM' ? 12 : 0)
  return `${pad(h)}:${pad(m)}`
}

// Preset numbers across a single 12-hour cycle (12:00, 12:30, 1:00 ... 11:30).
// `digits` is the label without punctuation so typed prefixes match naturally.
const timeOptions = computed(() => {
  const step = props.minuteStep > 0 ? props.minuteStep : 30
  const out = []
  for (let h = 0; h < 12; h++) {
    const h12 = h === 0 ? 12 : h
    for (let m = 0; m < 60; m += step) {
      out.push({ h12, m, label: `${h12}:${pad(m)}`, digits: `${h12}${pad(m)}` })
    }
  }
  return out
})

const open = ref(false)
const focused = ref(false)
const editing = ref(false) // true once the user has typed since focusing
const text = ref('')
const highlight = ref(-1) // keyboard highlight within `filtered`
const meridiem = ref('AM') // 'AM' | 'PM'

const inputRef = ref(null)
const wrapperRef = ref(null)
const panelRef = ref(null)
const listRef = ref(null)

const displayValue = computed(() => format(props.modelValue))

watch(displayValue, (v) => {
  if (!editing.value) text.value = v
}, { immediate: true })

// Keep the meridiem toggle in sync with the bound value.
watch(() => props.modelValue, (v) => {
  const s = parseSelected(v)
  if (s) meridiem.value = s.mer
}, { immediate: true })

// While typing, narrow to prefix matches; an unmatchable query shows the
// full list rather than an empty panel.
const queryMatches = computed(() => {
  if (!editing.value || !text.value.trim()) return []
  const q = splitQuery(text.value)
  if (!q || !q.digits) return []
  return timeOptions.value.filter((o) => o.digits.startsWith(q.digits))
})
const filtered = computed(() =>
  queryMatches.value.length ? queryMatches.value : timeOptions.value
)

const selected = computed(() => parseSelected(props.modelValue))
function isSelected(opt) {
  const s = selected.value
  return !!s && s.h12 === opt.h12 && s.m === opt.m && s.mer === meridiem.value
}

// ── positioning (teleported, fixed, flips up when cramped) ──────────────────
const PANEL_MAX = 264
const ITEM_H = 32
const MARGIN = 8
const panelStyle = ref({})

function reposition() {
  const el = wrapperRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const estimated = Math.min(PANEL_MAX, Math.max(filtered.value.length * ITEM_H + 8, 132))
  const spaceBelow = window.innerHeight - r.bottom - MARGIN
  const spaceAbove = r.top - MARGIN
  const openUp = spaceBelow < estimated && spaceAbove > spaceBelow
  const available = Math.max(120, Math.min(PANEL_MAX, openUp ? spaceAbove : spaceBelow))
  const height = Math.min(estimated, available)
  const top = openUp ? r.top - height - MARGIN : r.bottom + MARGIN
  panelStyle.value = {
    position: 'fixed',
    top: `${Math.max(MARGIN, top)}px`,
    left: `${r.left}px`,
    width: `${Math.max(r.width, 208)}px`,
    maxHeight: `${available}px`,
  }
}

function scrollOptionIntoView(idx, center = false) {
  const list = listRef.value
  const el = list?.querySelector(`[data-idx="${idx}"]`)
  if (!list || !el) return
  if (center) {
    list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
  } else if (el.offsetTop < list.scrollTop) {
    list.scrollTop = el.offsetTop
  } else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight
  }
}

function openList() {
  if (open.value) return
  open.value = true
  highlight.value = -1
  nextTick(() => {
    reposition()
    // Land on the bound value, or a sane morning anchor when unset.
    const sel = filtered.value.findIndex(isSelected)
    const anchor = sel >= 0 ? sel : filtered.value.findIndex((o) => o.h12 === 8 && o.m === 0)
    if (anchor >= 0) scrollOptionIntoView(anchor, true)
  })
}

function closeList() {
  open.value = false
  highlight.value = -1
}

// ── committing ──────────────────────────────────────────────────────────────

function emitValue(val) {
  if (val !== props.modelValue) {
    emit('update:modelValue', val)
    emit('change', val)
  }
  text.value = format(val)
}

function commitValue(val) {
  editing.value = false
  emitValue(val)
  closeList()
}

/** Pick a number: combine with the current meridiem and close. */
function selectTime(opt) {
  commitValue(toValue(opt.h12, opt.m, meridiem.value))
}

/** Toggle AM/PM: re-time an existing value in place, keeping the panel open. */
function selectMeridiem(mer) {
  editing.value = false
  meridiem.value = mer
  const s = selected.value
  if (s) emitValue(toValue(s.h12, s.m, mer))
  inputRef.value?.focus()
}

/** Parse whatever is in the field: empty clears, invalid reverts. */
function commitTyped() {
  const t = text.value.trim()
  if (!t) {
    commitValue('')
    return
  }
  const parsed = parseTime(t)
  if (parsed) {
    commitValue(parsed)
  } else {
    editing.value = false
    text.value = displayValue.value
    closeList()
  }
}

function clear() {
  commitValue('')
}

// ── input events ────────────────────────────────────────────────────────────

function onFocus(e) {
  focused.value = true
  e.target.select()
  openList()
}

function onBlur() {
  focused.value = false
  commitTyped()
}

function onInput() {
  editing.value = true
  if (!open.value) openList()
  const q = splitQuery(text.value)
  if (q && q.mer) meridiem.value = q.mer === 'a' ? 'AM' : 'PM'
  highlight.value = queryMatches.value.length ? 0 : -1
  nextTick(() => {
    reposition()
    scrollOptionIntoView(Math.max(0, highlight.value))
  })
}

function onKeydown(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) {
      openList()
      return
    }
    const n = filtered.value.length
    if (!n) return
    const delta = e.key === 'ArrowDown' ? 1 : -1
    const base = highlight.value >= 0 ? highlight.value : filtered.value.findIndex(isSelected)
    const next =
      base < 0
        ? delta > 0 ? 0 : n - 1
        : Math.min(n - 1, Math.max(0, base + delta))
    highlight.value = next
    scrollOptionIntoView(next)
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && open.value && !editing.value) {
    // With the list open and nothing being typed, flip the meridiem.
    e.preventDefault()
    selectMeridiem(e.key === 'ArrowLeft' ? 'AM' : 'PM')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (open.value && highlight.value >= 0 && filtered.value[highlight.value]) {
      selectTime(filtered.value[highlight.value])
    } else {
      commitTyped()
    }
  } else if (e.key === 'Escape' && open.value) {
    // Swallow it so a containing Modal doesn't also close.
    e.preventDefault()
    e.stopPropagation()
    editing.value = false
    text.value = displayValue.value
    closeList()
  }
}

// Clicking anywhere in the field (icon, padding) focuses the input without
// stealing focus to the wrapper; the clear button still receives its click.
function onWrapperMousedown(e) {
  if (e.target === inputRef.value) return
  e.preventDefault()
  inputRef.value?.focus()
  openList()
}

// ── outside-click safety net + reflow on scroll/resize ──────────────────────
function onDocMousedown(e) {
  if (!open.value) return
  if (wrapperRef.value?.contains(e.target)) return
  if (panelRef.value?.contains(e.target)) return
  closeList()
}
function onWinChange() {
  if (open.value) reposition()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown)
  window.addEventListener('resize', onWinChange)
  window.addEventListener('scroll', onWinChange, true)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  window.removeEventListener('resize', onWinChange)
  window.removeEventListener('scroll', onWinChange, true)
})

const wrapperClasses = computed(() => [
  'w-full flex items-center gap-2 rounded-xl border bg-surface dark:bg-gray-800 cursor-text',
  'transition-[border-color,box-shadow,background-color] duration-200 ease-out',
  props.size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-[15px]',
  open.value || focused.value
    ? 'border-primary-300/80 dark:border-primary-600/75 ring-2 ring-primary-500/20'
    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300/90 dark:hover:border-gray-600',
])
</script>

<template>
  <div class="relative">
    <div ref="wrapperRef" :class="wrapperClasses" @mousedown="onWrapperMousedown">
      <input
        ref="inputRef"
        v-model="text"
        type="text"
        role="combobox"
        :aria-expanded="open"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-label="Time"
        autocomplete="off"
        spellcheck="false"
        :placeholder="placeholder"
        class="flex-1 min-w-0 bg-transparent border-none p-0 font-medium tracking-tight text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        v-if="clearable && modelValue"
        type="button"
        class="shrink-0 p-0.5 rounded text-gray-400 hover:text-rust-600 dark:hover:text-rust-500 transition-colors"
        aria-label="Clear time"
        @click="clear"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <svg
        class="shrink-0 text-gray-400"
        :class="size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]'"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>

    <!-- Options panel (teleported so it escapes overflow clipping) -->
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
          class="tp-panel z-[60] flex rounded-xl border border-gray-200/80 dark:border-gray-700 bg-surface dark:bg-gray-800 overflow-hidden shadow-[0_4px_20px_rgba(28,25,23,0.10),0_1px_4px_rgba(28,25,23,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.35)]"
        >
          <!-- Numbers -->
          <div
            ref="listRef"
            role="listbox"
            aria-label="Preset times"
            class="tp-list flex-1 min-w-0 overflow-y-auto py-1"
          >
            <button
              v-for="(opt, i) in filtered"
              :key="opt.label"
              type="button"
              role="option"
              :data-idx="i"
              :aria-selected="isSelected(opt)"
              class="w-full flex items-center justify-between gap-2 text-left font-medium tracking-tight tabular-nums transition-colors duration-100"
              :class="[
                size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-3.5 py-1.5 text-[14px]',
                i === highlight || isSelected(opt)
                  ? 'bg-gray-100/80 dark:bg-gray-700/70 text-gray-900 dark:text-gray-100'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100',
              ]"
              @mousedown.prevent
              @click="selectTime(opt)"
            >
              <span class="truncate">{{ opt.label }}</span>
              <svg
                v-if="isSelected(opt)"
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

          <!-- AM / PM -->
          <div
            class="shrink-0 flex flex-col gap-1 p-1.5 border-l border-gray-200/80 dark:border-gray-700"
            role="group"
            aria-label="AM or PM"
          >
            <button
              v-for="mer in ['AM', 'PM']"
              :key="mer"
              type="button"
              :aria-pressed="meridiem === mer"
              class="px-3 py-1.5 rounded-lg text-[13px] font-semibold tracking-wide transition-colors duration-100"
              :class="
                meridiem === mer
                  ? 'bg-primary-600 text-white shadow-sm dark:bg-primary-500'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
              "
              @mousedown.prevent
              @click="selectMeridiem(mer)"
            >
              {{ mer }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.tp-list {
  scrollbar-width: thin;
  scrollbar-color: var(--color-paper-line) transparent;
}
.tp-list::-webkit-scrollbar {
  width: 6px;
}
.tp-list::-webkit-scrollbar-thumb {
  background: var(--color-paper-line);
  border-radius: 9999px;
}
.tp-list::-webkit-scrollbar-track {
  background: transparent;
}
</style>
