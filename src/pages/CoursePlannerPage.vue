<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useCoursePlannerStore } from '../stores/coursePlanner'
import { useProfileStore } from '../stores/profile'
import { Button, Dropdown, Modal } from '../components/ui'
import { listSchools } from '../services/coursePlannerApi.js'
import { schoolLogo } from '../lib/schoolLogos'

const planner = useCoursePlannerStore()
const profileStore = useProfileStore()

// Friendly label for the user's current school (fetched once from the API).
const schoolName = ref('')
const supportedSchools = ref([])

onMounted(async () => {
  try {
    supportedSchools.value = await listSchools()
  } catch {
    // Falls back to the bare school code in the header — non-fatal.
  }
  if (planner.schoolCode) {
    planner.loadTerms()
  }
})

watch(
  () => planner.schoolCode,
  (school) => {
    if (school) planner.loadTerms()
  }
)

watch(supportedSchools, (list) => {
  const m = list.find((s) => s.code === planner.schoolCode)
  schoolName.value = m ? m.name : ''
})

const currentSchoolMeta = computed(() =>
  supportedSchools.value.find((s) => s.code === planner.schoolCode) || null
)

// Bundled logo for the current school, '' when none (drives the hero badge).
const schoolLogoUrl = computed(() => schoolLogo(planner.schoolCode))

// --- Dropdown option arrays ---
const termOptions = computed(() => [
  { value: '', label: 'Select a term' },
  ...planner.terms.map((t) => ({ value: t.code, label: t.label })),
])

const subjectOptions = computed(() => [
  { value: '', label: 'Select a subject' },
  ...planner.subjects.map((s) => ({ value: s.code, label: `${s.code} · ${s.label}` })),
])

const subjectDisabled = computed(
  () => !planner.selectedTermCode || planner.loading.subjects
)

// --- Section list filtering ---
const filterQuery = ref('')
const filteredSections = computed(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return planner.sections
  return planner.sections.filter((s) => {
    return (
      s.title.toLowerCase().includes(q) ||
      s.courseNumber.toLowerCase().includes(q) ||
      s.sectionNumber.toLowerCase().includes(q) ||
      s.instructors.join(' ').toLowerCase().includes(q)
    )
  })
})

// --- Weekly calendar grid ---
// Slots run 7am–10pm; each row = 30 minutes; we position blocks absolutely
// inside a per-day column.
const DAYS = [
  { code: 'M', label: 'Mon' },
  { code: 'T', label: 'Tue' },
  { code: 'W', label: 'Wed' },
  { code: 'R', label: 'Thu' },
  { code: 'F', label: 'Fri' },
  { code: 'S', label: 'Sat' },
  { code: 'U', label: 'Sun' },
]
const HOUR_START = 7
const HOUR_END = 22
const ROW_HEIGHT_PX = 28 // per 30-min slot

const hourMarkers = computed(() => {
  const out = []
  for (let h = HOUR_START; h <= HOUR_END; h++) {
    out.push({
      hour: h,
      label: formatHour(h),
      topPx: (h - HOUR_START) * ROW_HEIGHT_PX * 2,
    })
  }
  return out
})

// Extra padding below the final hour so the last label (centered on the edge) isn't clipped.
const gridHeightPx = computed(() => (HOUR_END - HOUR_START) * ROW_HEIGHT_PX * 2 + 12)

// Neutral slate so "Work" blocks read as a different category from the
// pastel-colored course blocks.
const WORK_COLOR = {
  bg: 'bg-slate-200/80 dark:bg-slate-700/50',
  text: 'text-slate-700 dark:text-slate-200',
  border: 'border-l-slate-500 dark:border-l-slate-400',
}

/** Position + size a block within the visible grid, clamping to the 7am–10pm window. */
function makeBlock(b) {
  const startMin = toMinutes(b.startTime)
  const endMin = toMinutes(b.endTime)
  const gridTop = HOUR_START * 60
  const gridBot = HOUR_END * 60
  const start = Math.max(startMin, gridTop)
  const end = Math.min(endMin, gridBot)
  const topPx = ((start - gridTop) / 30) * ROW_HEIGHT_PX
  const heightPx = Math.max(((end - start) / 30) * ROW_HEIGHT_PX, 22)
  return { ...b, startMin, endMin, topPx, heightPx, leftPct: 0, widthPct: 100 }
}

/**
 * Assign side-by-side columns to overlapping blocks within one day so they
 * don't stack on top of each other. Mutates each block's leftPct/widthPct.
 */
function layoutColumn(blocks) {
  if (blocks.length < 2) return blocks
  blocks.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    if (!cluster.length) return
    const colEnds = []
    for (const blk of cluster) {
      let col = colEnds.findIndex((endMin) => endMin <= blk.startMin)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(blk.endMin)
      } else {
        colEnds[col] = blk.endMin
      }
      blk._col = col
    }
    const n = colEnds.length
    for (const blk of cluster) {
      blk.widthPct = 100 / n
      blk.leftPct = (blk._col * 100) / n
    }
    cluster = []
    clusterEnd = -1
  }
  for (const blk of blocks) {
    if (cluster.length && blk.startMin >= clusterEnd) flush()
    cluster.push(blk)
    clusterEnd = Math.max(clusterEnd, blk.endMin)
  }
  flush()
  return blocks
}

/** Course meetings + work shifts, grouped by day with overlap layout applied. */
const dayBlocks = computed(() => {
  const byDay = Object.fromEntries(DAYS.map((d) => [d.code, []]))

  for (const section of planner.savedSections) {
    for (const m of section.meetings || []) {
      if (!m.startTime || !m.endTime) continue
      const base = makeBlock({
        kind: 'course',
        key: `c-${section.crn}`,
        startTime: m.startTime,
        endTime: m.endTime,
        section,
        meeting: m,
        color: colorFor(section),
      })
      for (const d of m.days || []) {
        if (byDay[d]) byDay[d].push({ ...base, key: `${base.key}-${d}` })
      }
    }
  }

  for (const shift of planner.workShifts) {
    if (!shift.startTime || !shift.endTime) continue
    const base = makeBlock({
      kind: 'work',
      key: `w-${shift.id}`,
      startTime: shift.startTime,
      endTime: shift.endTime,
      color: WORK_COLOR,
    })
    for (const d of shift.days || []) {
      if (byDay[d]) byDay[d].push({ ...base, key: `${base.key}-${d}` })
    }
  }

  for (const d of DAYS) layoutColumn(byDay[d.code])
  return byDay
})

const unscheduledSaved = computed(() =>
  planner.savedSections.filter((s) => !s.meetings.some((m) => m.startTime && m.endTime && m.days.length))
)

// --- Conflict detection ---
// Finds all pairs of saved blocks (course↔course, course↔work, work↔work) that
// overlap in time on at least one shared day. Uses original (unclamped) minutes.
const conflicts = computed(() => {
  const pairMap = new Map()
  for (const d of DAYS) {
    const blocks = dayBlocks.value[d.code]
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i]
        const b = blocks[j]
        if (a.startMin < b.endMin && b.startMin < a.endMin) {
          const aBase = a.key.replace(/-[MTWRFSU]$/, '')
          const bBase = b.key.replace(/-[MTWRFSU]$/, '')
          const pairKey = [aBase, bBase].sort().join('|')
          if (!pairMap.has(pairKey)) pairMap.set(pairKey, { a, b, days: [] })
          pairMap.get(pairKey).days.push(d.code)
        }
      }
    }
  }
  return [...pairMap.values()]
})

const conflictedBaseKeys = computed(() => {
  const keys = new Set()
  for (const c of conflicts.value) {
    keys.add(c.a.key.replace(/-[MTWRFSU]$/, ''))
    keys.add(c.b.key.replace(/-[MTWRFSU]$/, ''))
  }
  return keys
})

function isConflicted(block) {
  return conflictedBaseKeys.value.has(block.key.replace(/-[MTWRFSU]$/, ''))
}

function conflictLabel(block) {
  if (block.kind === 'work') return 'Work'
  return `${block.section.subjectCode} ${block.section.courseNumber}`
}

function conflictDaysLabel(dayCodes) {
  const map = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' }
  return dayCodes.map((c) => map[c] || c).join(', ')
}

// One-line summary under the "Your week" heading.
const weekSummary = computed(() => {
  const c = planner.savedSections.length
  const w = planner.workShifts.length
  const parts = []
  if (c) parts.push(`${c} ${c === 1 ? 'course' : 'courses'}`)
  if (w) parts.push(`${w} work ${w === 1 ? 'shift' : 'shifts'}`)
  return parts.join(' · ') || 'Nothing scheduled yet'
})

// --- Helpers ---

function formatHour(h) {
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hh}${h < 12 ? 'am' : 'pm'}`
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

function meetingSummary(meetings) {
  if (!meetings || !meetings.length) return 'TBA'
  return meetings
    .filter((m) => m.startTime && m.endTime)
    .map((m) => `${(m.days || []).map(dayLong).join(',')}, ${formatClock(m.startTime)}–${formatClock(m.endTime)}`)
    .join(' • ') || 'TBA'
}

function dayLong(c) {
  return { M: 'M', T: 'Tu', W: 'W', R: 'Th', F: 'F', S: 'Sa', U: 'Su' }[c] || c
}

function formatClock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  const suf = h < 12 ? 'am' : 'pm'
  return `${hh}:${String(m).padStart(2, '0')}${suf}`
}

const PALETTE = [
  { bg: 'bg-blue-50 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-200', border: 'border-l-blue-400 dark:border-l-blue-500' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-l-emerald-400 dark:border-l-emerald-500' },
  { bg: 'bg-amber-50 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-200', border: 'border-l-amber-400 dark:border-l-amber-500' },
  { bg: 'bg-violet-50 dark:bg-violet-900/40', text: 'text-violet-800 dark:text-violet-200', border: 'border-l-violet-400 dark:border-l-violet-500' },
  { bg: 'bg-rose-50 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-200', border: 'border-l-rose-400 dark:border-l-rose-500' },
  { bg: 'bg-teal-50 dark:bg-teal-900/40', text: 'text-teal-800 dark:text-teal-200', border: 'border-l-teal-400 dark:border-l-teal-500' },
  { bg: 'bg-orange-50 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-200', border: 'border-l-orange-400 dark:border-l-orange-500' },
  { bg: 'bg-cyan-50 dark:bg-cyan-900/40', text: 'text-cyan-800 dark:text-cyan-200', border: 'border-l-cyan-400 dark:border-l-cyan-500' },
]

function colorFor(section) {
  // Deterministic per-CRN — switching subjects doesn't reshuffle saved blocks.
  let hash = 0
  const key = `${section.school}:${section.crn}`
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/** Status chip styling for a result row (color follows the open/closed convention). */
function statusPill(section) {
  if (section.status === 'open') {
    return { text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500', label: 'Open' }
  }
  if (section.status === 'closed') {
    return { text: 'text-rust-600 dark:text-rust-500', dot: 'bg-rust-500', label: 'Closed' }
  }
  return { text: 'text-gray-400 dark:text-gray-500', dot: 'bg-gray-400 dark:bg-gray-500', label: 'Status unknown' }
}

/** Returns 'closed', 'full', or null. */
function unavailableReason(section) {
  if (section.status === 'closed') return 'closed'
  const enr = section.enrollment || {}
  if (enr.available != null && enr.available <= 0) return 'full'
  if (enr.max != null && enr.current != null && enr.current >= enr.max) return 'full'
  return null
}

function isSectionUnavailable(section) {
  return unavailableReason(section) !== null
}

// Per-day calendar tinting: weekends recede a touch from the weekday columns.
function dayColumnClass(d) {
  if (d.code === 'S' || d.code === 'U') return 'bg-paper/40 dark:bg-gray-900/30'
  return 'bg-surface/40 dark:bg-gray-800/20'
}

function dayHeaderClass(d) {
  if (d.code === 'S' || d.code === 'U') return 'text-gray-300 dark:text-gray-600'
  return 'text-gray-500 dark:text-gray-400'
}

function onTermChange(code) {
  const term = planner.terms.find((t) => t.code === code)
  planner.setTerm(code, term?.label || '')
}

function onSubjectChange(code) {
  const subject = planner.subjects.find((s) => s.code === code)
  planner.setSubject(code, subject?.label || '')
}

// --- Work schedule modal ---
// The modal edits a local draft of the weekly shifts; nothing touches the
// store (or the calendar) until the user hits Save.
const workModalOpen = ref(false)
const workDraft = ref([])

function newShift() {
  return {
    id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    days: [],
    startTime: '09:00',
    endTime: '17:00',
  }
}

function openWorkModal() {
  workDraft.value = planner.workShifts.map((s) => ({
    id: s.id,
    days: [...(s.days || [])],
    startTime: s.startTime || '',
    endTime: s.endTime || '',
  }))
  if (!workDraft.value.length) workDraft.value.push(newShift())
  workModalOpen.value = true
}

function addDraftShift() {
  workDraft.value.push(newShift())
}

function removeDraftShift(idx) {
  workDraft.value.splice(idx, 1)
}

function toggleDraftDay(shift, dayCode) {
  const i = shift.days.indexOf(dayCode)
  if (i === -1) shift.days.push(dayCode)
  else shift.days.splice(i, 1)
}

function shiftError(s) {
  if (!s.days.length) return 'Pick at least one day.'
  if (!s.startTime || !s.endTime) return 'Set a start and end time.'
  if (toMinutes(s.endTime) <= toMinutes(s.startTime)) return 'End time must be after the start time.'
  return ''
}

const workDraftValid = computed(() => workDraft.value.every((s) => !shiftError(s)))

function saveWork() {
  if (!workDraftValid.value) return
  planner.setWorkShifts(
    workDraft.value.map((s) => ({
      id: s.id,
      days: [...s.days],
      startTime: s.startTime,
      endTime: s.endTime,
    }))
  )
  workModalOpen.value = false
}
</script>

<template>
  <div class="pb-12">
    <!-- ══ Hero ════════════════════════════════════════════════════════════ -->
    <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
      <div class="min-w-0">
        <p class="eyebrow text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
          <img
            v-if="schoolLogoUrl"
            :src="schoolLogoUrl"
            :alt="schoolName"
            class="w-4 h-4 rounded object-cover bg-white ring-1 ring-black/5 dark:ring-white/10 shrink-0"
          />
          {{ schoolName || 'Course catalog' }}
        </p>
        <h1 class="display mt-1.5 text-4xl sm:text-5xl text-gray-900 dark:text-gray-50">
          Course Planner
        </h1>
        <p class="mt-3 max-w-2xl font-serif text-lg leading-relaxed text-gray-600 dark:text-gray-300">
          Search live course offerings and build your weekly schedule.
        </p>
      </div>
      <div class="shrink-0 text-left sm:text-right">
        <p class="display text-4xl text-gray-900 dark:text-gray-50 leading-none tabular-nums">
          {{ planner.savedSections.length }}
        </p>
        <p class="eyebrow text-gray-400 dark:text-gray-500 mt-1.5">in your plan</p>
      </div>
    </header>

    <!-- ══ No school selected ══════════════════════════════════════════════ -->
    <div
      v-if="!planner.schoolCode"
      class="mt-10 rounded-2xl border border-dashed border-paper-line dark:border-gray-700/60 bg-surface/40 dark:bg-gray-800/30 px-6 py-16 text-center"
    >
      <div class="w-14 h-14 mx-auto mb-4 rounded-2xl bg-primary-100/80 dark:bg-primary-900/30 ring-1 ring-primary-200/60 dark:ring-primary-800/50 flex items-center justify-center">
        <svg class="w-7 h-7 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <h3 class="display text-xl text-gray-900 dark:text-gray-100">Pick your university first</h3>
      <p class="mt-2 font-serif text-[15px] text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
        Choose which school's catalog to search from your profile.
      </p>
      <button
        type="button"
        @click="$router.push('/profile#university')"
        class="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
      >
        Open Profile
      </button>
    </div>

    <template v-else>
      <!-- ══ Filters ═══════════════════════════════════════════════════════ -->
      <div class="mt-8 rounded-2xl border border-paper-line dark:border-gray-700/60 bg-surface/40 dark:bg-gray-800/30 p-5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Term -->
          <div>
            <div :class="planner.loading.terms ? 'opacity-55 pointer-events-none' : ''">
              <Dropdown
                label="Term"
                :model-value="planner.selectedTermCode"
                :options="termOptions"
                @change="onTermChange"
              />
            </div>
            <p
              v-if="planner.errors.terms"
              class="mt-1.5 font-mono text-[11px] text-rust-600 dark:text-rust-500"
            >{{ planner.errors.terms }}</p>
            <p
              v-else-if="planner.loading.terms"
              class="mt-1.5 font-mono text-[11px] text-gray-400 dark:text-gray-500"
            >Loading terms…</p>
          </div>

          <!-- Subject -->
          <div>
            <div :class="subjectDisabled ? 'opacity-55 pointer-events-none' : ''">
              <Dropdown
                label="Subject"
                :model-value="planner.selectedSubjectCode"
                :options="subjectOptions"
                @change="onSubjectChange"
              />
            </div>
            <p
              v-if="planner.errors.subjects"
              class="mt-1.5 font-mono text-[11px] text-rust-600 dark:text-rust-500"
            >{{ planner.errors.subjects }}</p>
            <p
              v-else-if="planner.loading.subjects"
              class="mt-1.5 font-mono text-[11px] text-gray-400 dark:text-gray-500"
            >Loading subjects…</p>
            <p
              v-else-if="!planner.selectedTermCode"
              class="mt-1.5 font-mono text-[11px] text-gray-400 dark:text-gray-500"
            >Pick a term first</p>
          </div>

          <!-- Filter results -->
          <div class="space-y-1.5">
            <label class="block text-sm font-medium text-gray-600 dark:text-gray-400">Filter results</label>
            <div class="relative">
              <svg
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                v-model="filterQuery"
                type="text"
                placeholder="Title, course #, instructor…"
                :disabled="!planner.sections.length"
                class="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-surface dark:bg-gray-800 text-[15px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 dark:focus-visible:border-primary-600/60 hover:border-gray-300/90 dark:hover:border-gray-600 transition-[border-color,box-shadow] duration-200 disabled:bg-gray-100 dark:disabled:bg-gray-800/50 disabled:text-gray-400 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>
        <p
          v-if="currentSchoolMeta && !currentSchoolMeta.enrollmentDataAvailable"
          class="text-xs text-gray-500 dark:text-gray-400 mt-3"
        >
          {{ currentSchoolMeta.name }} does not expose exact seat counts publicly. Only open / closed status is shown.
        </p>
      </div>

      <!-- ══ Conflict alert ════════════════════════════════════════════════ -->
      <div
        v-if="conflicts.length"
        class="mt-4 rounded-2xl border border-warning-300/60 dark:border-warning-500/25 bg-warning-50/80 dark:bg-warning-500/[0.07] px-5 py-4"
      >
        <div class="flex items-center gap-2 mb-2.5">
          <svg class="w-4 h-4 shrink-0 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p class="eyebrow text-warning-700 dark:text-warning-400">
            {{ conflicts.length }} Schedule {{ conflicts.length === 1 ? 'Conflict' : 'Conflicts' }} Detected
          </p>
        </div>
        <ul class="space-y-1.5">
          <li
            v-for="(conflict, i) in conflicts"
            :key="i"
            class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[12px] text-warning-800 dark:text-warning-300"
          >
            <span class="w-1 h-1 rounded-full bg-warning-500 shrink-0" />
            <span class="font-semibold">{{ conflictLabel(conflict.a) }}</span>
            <span class="text-warning-500/80 dark:text-warning-500/60">overlaps</span>
            <span class="font-semibold">{{ conflictLabel(conflict.b) }}</span>
            <span class="text-warning-600/55 dark:text-warning-400/45">· {{ conflictDaysLabel(conflict.days) }}</span>
          </li>
        </ul>
      </div>

      <!-- ══ Calendar-forward layout: results rail + large weekly grid ═════ -->
      <div class="mt-6 grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6">

        <!-- LEFT: results rail -->
        <div class="min-w-0 flex flex-col">
          <div class="flex items-baseline justify-between border-b border-paper-line dark:border-gray-700/60 pb-2.5">
            <p class="eyebrow text-gray-400 dark:text-gray-500">
              Results
              <span v-if="filteredSections.length" class="text-gray-300 dark:text-gray-600">· {{ filteredSections.length }}</span>
            </p>
          </div>

          <!-- States -->
          <div v-if="planner.loading.sections" class="py-14 text-center font-mono text-[12px] text-gray-400 dark:text-gray-500">
            Loading sections…
          </div>
          <div v-else-if="planner.errors.sections" class="py-14 text-center text-sm text-rust-600 dark:text-rust-500">
            {{ planner.errors.sections }}
          </div>
          <div v-else-if="!planner.selectedSubjectCode" class="py-14 text-center">
            <p class="font-serif italic text-base text-gray-500 dark:text-gray-400">Pick a term + subject to see sections.</p>
          </div>
          <div v-else-if="filteredSections.length === 0" class="py-14 text-center">
            <p class="font-serif italic text-base text-gray-500 dark:text-gray-400">No sections match.</p>
          </div>

          <!-- List -->
          <div v-else class="mt-3 flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5">
            <div
              v-for="section in filteredSections"
              :key="section.crn"
              class="rounded-xl border border-paper-line dark:border-gray-700/60 bg-surface/50 dark:bg-gray-800/30 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-surface dark:hover:bg-gray-800/60 transition-colors p-3.5"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1">
                    <span class="font-semibold text-[14px] text-gray-900 dark:text-gray-100">
                      {{ section.subjectCode }} {{ section.courseNumber }}
                    </span>
                    <span class="font-mono text-[11px] text-gray-400 dark:text-gray-500">{{ section.sectionNumber }}</span>
                    <span class="inline-flex items-center gap-1.5 eyebrow" :class="statusPill(section).text">
                      <span class="w-1.5 h-1.5 rounded-full" :class="statusPill(section).dot" />
                      {{ statusPill(section).label }}
                    </span>
                  </div>
                  <p class="font-serif text-[14px] leading-snug text-gray-800 dark:text-gray-200 line-clamp-1">{{ section.title }}</p>
                  <p class="mt-1 font-mono text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {{ meetingSummary(section.meetings) }}
                  </p>
                  <p v-if="section.instructors.length" class="font-mono text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                    {{ section.instructors.join(', ') }}
                  </p>
                  <p
                    v-if="section.enrollment.max !== null && section.enrollment.current !== null"
                    class="font-mono text-[10.5px] text-gray-400 dark:text-gray-500 mt-1"
                  >
                    {{ section.enrollment.current }} / {{ section.enrollment.max }} enrolled
                    <span v-if="section.enrollment.available !== null">· {{ section.enrollment.available }} open</span>
                  </p>
                </div>

                <!-- Action -->
                <Button
                  v-if="planner.isSaved(section)"
                  variant="secondary"
                  size="sm"
                  class="shrink-0"
                  @click="planner.removeSection(section)"
                >
                  Remove
                </Button>
                <span
                  v-else-if="isSectionUnavailable(section)"
                  class="shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-danger-50 dark:bg-danger-900/30 text-danger-600 dark:text-danger-300 border border-danger-200 dark:border-danger-800/60 cursor-not-allowed select-none"
                  :title="unavailableReason(section) === 'full' ? 'This section is at capacity. Registration is closed.' : 'This section is closed. Registration is not available.'"
                >
                  {{ unavailableReason(section) === 'full' ? 'Full' : 'Closed' }}
                </span>
                <Button
                  v-else
                  variant="primary"
                  size="sm"
                  class="shrink-0"
                  @click="planner.addSection(section)"
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT: weekly grid (the page hero) -->
        <div class="min-w-0 rounded-2xl border border-paper-line dark:border-gray-700/60 bg-surface/40 dark:bg-gray-800/30 overflow-hidden">
          <!-- Panel header -->
          <div class="px-5 py-4 flex items-center justify-between gap-3 border-b border-paper-line dark:border-gray-700/60">
            <div class="min-w-0">
              <h2 class="display text-xl text-gray-900 dark:text-gray-100 leading-tight">Your week</h2>
              <p class="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-gray-500">{{ weekSummary }}</p>
            </div>
            <Button variant="secondary" size="sm" class="shrink-0" @click="openWorkModal">
              <svg class="w-4 h-4 mr-1.5 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {{ planner.workShifts.length ? 'Edit work hours' : 'Add work hours' }}
            </Button>
          </div>

          <div class="overflow-x-auto">
            <div class="grid grid-cols-[3.25rem_repeat(7,minmax(5rem,1fr))] min-w-[44rem]">
              <!-- Day header row -->
              <div class="h-9 border-b border-r border-paper-line dark:border-gray-700/60"></div>
              <div
                v-for="d in DAYS"
                :key="d.code"
                class="flex items-center justify-center h-9 border-b border-r border-paper-line dark:border-gray-700/60 px-2 eyebrow"
                :class="dayHeaderClass(d)"
              >
                {{ d.label }}
              </div>

              <!-- Time gutter -->
              <div class="relative border-r border-paper-line dark:border-gray-700/60" :style="{ height: gridHeightPx + 'px' }">
                <div
                  v-for="h in hourMarkers"
                  :key="h.hour"
                  class="absolute right-1.5 text-[10px] text-gray-400 dark:text-gray-500 leading-none font-medium tabular-nums"
                  :class="h.hour === HOUR_START ? 'top-1' : '-translate-y-1/2'"
                  :style="h.hour === HOUR_START ? {} : { top: h.topPx + 'px' }"
                >
                  {{ h.label }}
                </div>
              </div>

              <!-- Day columns -->
              <div
                v-for="d in DAYS"
                :key="d.code"
                class="border-r border-paper-line dark:border-gray-700/60 relative"
                :class="dayColumnClass(d)"
                :style="{ height: gridHeightPx + 'px' }"
              >
                <!-- Hour lines -->
                <div
                  v-for="h in hourMarkers"
                  :key="h.hour"
                  class="absolute left-0 right-0 border-t border-paper-line/80 dark:border-gray-700/50"
                  :style="{ top: h.topPx + 'px' }"
                />
                <!-- Half-hour lines -->
                <div
                  v-for="h in hourMarkers"
                  :key="'hh-' + h.hour"
                  class="absolute left-0 right-0 border-t border-dashed border-paper-line/50 dark:border-gray-700/30"
                  :style="{ top: (h.topPx + ROW_HEIGHT_PX) + 'px' }"
                />

                <!-- Course + work blocks -->
                <div
                  v-for="block in dayBlocks[d.code]"
                  :key="block.key"
                  class="absolute rounded-md p-1.5 text-[11px] font-medium overflow-hidden border-l-4 shadow-sm z-10"
                  :class="[
                    block.kind === 'course' && isSectionUnavailable(block.section)
                      ? 'bg-danger-50 dark:bg-danger-900/30 text-danger-700 dark:text-danger-300 border-l-danger-400 dark:border-l-danger-500 opacity-90'
                      : [block.color.bg, block.color.text, block.color.border],
                    isConflicted(block) ? 'ring-2 ring-warning-400 dark:ring-warning-500' : '',
                  ]"
                  :style="{
                    top: block.topPx + 'px',
                    height: block.heightPx + 'px',
                    left: `calc(${block.leftPct}% + 2px)`,
                    width: `calc(${block.widthPct}% - 4px)`,
                  }"
                  :title="block.kind === 'work'
                    ? `Work · ${formatClock(block.startTime)}–${formatClock(block.endTime)}`
                    : isSectionUnavailable(block.section)
                      ? `${block.section.subjectCode} ${block.section.courseNumber} · ${unavailableReason(block.section) === 'full' ? 'Full (at capacity)' : 'Closed'}`
                      : `${block.section.subjectCode} ${block.section.courseNumber} · ${block.section.title} · ${formatClock(block.startTime)}–${formatClock(block.endTime)}`"
                >
                  <div class="font-bold leading-tight truncate">
                    <template v-if="block.kind === 'work'">Work</template>
                    <template v-else>{{ block.section.subjectCode }} {{ block.section.courseNumber }}</template>
                  </div>
                  <div
                    v-if="block.kind === 'work' && block.heightPx >= 38"
                    class="mt-0.5 text-[9px] opacity-80 leading-none tabular-nums"
                  >
                    {{ formatClock(block.startTime) }}–{{ formatClock(block.endTime) }}
                  </div>
                  <div
                    v-else-if="block.kind === 'course' && isSectionUnavailable(block.section)"
                    class="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-danger-600 dark:text-danger-400 leading-none"
                  >
                    {{ unavailableReason(block.section) === 'full' ? 'Full' : 'Closed' }}
                  </div>
                  <div
                    v-else-if="block.kind === 'course' && block.heightPx >= 38"
                    class="mt-0.5 text-[9px] opacity-75 leading-none tabular-nums"
                  >
                    {{ formatClock(block.startTime) }}–{{ formatClock(block.endTime) }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Unscheduled (TBA) saved sections -->
          <div v-if="unscheduledSaved.length" class="px-5 py-4 border-t border-paper-line dark:border-gray-700/60">
            <p class="eyebrow text-gray-400 dark:text-gray-500 mb-2.5">Saved · no meeting time</p>
            <ul class="space-y-2">
              <li
                v-for="s in unscheduledSaved"
                :key="s.crn"
                class="flex items-center justify-between gap-2 text-sm"
              >
                <span class="truncate flex items-center gap-1.5 min-w-0">
                  <span class="font-semibold text-gray-900 dark:text-gray-100">{{ s.subjectCode }} {{ s.courseNumber }}</span>
                  <span class="text-gray-500 dark:text-gray-400 truncate">{{ s.sectionNumber }} · {{ s.title }}</span>
                  <span
                    v-if="isSectionUnavailable(s)"
                    class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-danger-50 dark:bg-danger-900/30 text-danger-600 dark:text-danger-300 border border-danger-200 dark:border-danger-800/60"
                  >
                    {{ unavailableReason(s) === 'full' ? 'Full' : 'Closed' }}
                  </span>
                </span>
                <button
                  class="text-xs font-medium text-rust-600 dark:text-rust-500 hover:underline shrink-0"
                  @click="planner.removeSection(s)"
                >
                  Remove
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- ══ Work schedule modal ═══════════════════════════════════════════ -->
      <Modal v-model="workModalOpen" size="lg">
        <template #header>
          <h3 class="display text-xl text-gray-900 dark:text-gray-100">Weekly work schedule</h3>
        </template>

        <div class="space-y-5">
          <p class="font-serif italic text-[15px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Add the shifts you work each week. They'll appear on your weekly grid as
            <span class="not-italic font-semibold text-gray-700 dark:text-gray-300">Work</span> blocks so you can plan classes around them.
          </p>

          <div
            v-for="(shift, idx) in workDraft"
            :key="shift.id"
            class="rounded-2xl border border-paper-line dark:border-gray-700/60 p-4 space-y-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
          >
            <div class="flex items-center justify-between">
              <span class="eyebrow text-gray-500 dark:text-gray-400">Shift {{ idx + 1 }}</span>
              <button
                type="button"
                class="p-1.5 text-gray-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 rounded-xl transition-colors"
                title="Remove shift"
                @click="removeDraftShift(idx)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            <!-- Day selector -->
            <div class="space-y-1.5">
              <label class="eyebrow text-gray-500 dark:text-gray-400">Days</label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="d in DAYS"
                  :key="d.code"
                  type="button"
                  class="px-3 py-1.5 rounded-xl text-[12px] font-semibold tracking-wide border transition-all duration-150 active:scale-[0.97]"
                  :class="shift.days.includes(d.code)
                    ? 'bg-primary-900 text-white border-primary-900 shadow-sm shadow-primary-900/15'
                    : 'bg-surface dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100'"
                  @click="toggleDraftDay(shift, d.code)"
                >
                  {{ d.label }}
                </button>
              </div>
            </div>

            <!-- Times -->
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="eyebrow text-gray-500 dark:text-gray-400">Start</label>
                <input
                  v-model="shift.startTime"
                  type="time"
                  class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-surface dark:bg-gray-800 text-[15px] font-medium tracking-tight text-gray-900 dark:text-gray-100 dark:[color-scheme:dark] hover:border-gray-300/90 dark:hover:border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 dark:focus-visible:border-primary-600/60 transition-[border-color,box-shadow] duration-200"
                />
              </div>
              <div class="space-y-1.5">
                <label class="eyebrow text-gray-500 dark:text-gray-400">End</label>
                <input
                  v-model="shift.endTime"
                  type="time"
                  class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-surface dark:bg-gray-800 text-[15px] font-medium tracking-tight text-gray-900 dark:text-gray-100 dark:[color-scheme:dark] hover:border-gray-300/90 dark:hover:border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 dark:focus-visible:border-primary-600/60 transition-[border-color,box-shadow] duration-200"
                />
              </div>
            </div>

            <p v-if="shiftError(shift)" class="font-mono text-[11px] text-danger-600 dark:text-danger-400 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {{ shiftError(shift) }}
            </p>
          </div>

          <Button variant="secondary" size="sm" block @click="addDraftShift">
            + Add another shift
          </Button>
        </div>

        <template #footer>
          <div class="flex items-center justify-between gap-3">
            <button
              v-if="workDraft.length"
              type="button"
              class="eyebrow text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 transition-colors"
              @click="workDraft = []"
            >
              Clear all
            </button>
            <span v-else></span>
            <div class="flex gap-3">
              <Button variant="secondary" @click="workModalOpen = false">Cancel</Button>
              <Button variant="primary" :disabled="!workDraftValid" @click="saveWork">
                Save schedule
              </Button>
            </div>
          </div>
        </template>
      </Modal>
    </template>
  </div>
</template>
