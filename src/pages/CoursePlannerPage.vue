<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useCoursePlannerStore } from '../stores/coursePlanner'
import { useProfileStore } from '../stores/profile'
import { Card, Button, Select, Input, Badge, EmptyState, Modal } from '../components/ui'
import { listSchools } from '../services/coursePlannerApi.js'

const planner = useCoursePlannerStore()
const profileStore = useProfileStore()

// Friendly label for the user's current school (fetched once from the API).
const schoolName = ref('')
const supportedSchools = ref([])
onMounted(async () => {
  try {
    supportedSchools.value = await listSchools()
  } catch {
    // Falls back to the bare school code in the header  non-fatal.
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

// --- Dropdown option arrays ---
const termOptions = computed(() => [
  { value: '', label: 'Select a term' },
  ...planner.terms.map((t) => ({ value: t.code, label: t.label })),
])

const subjectOptions = computed(() => [
  { value: '', label: 'Select a subject' },
  ...planner.subjects.map((s) => ({ value: s.code, label: `${s.code}  ${s.label}` })),
])

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
  { code: 'M', label: 'M' },
  { code: 'T', label: 'Tu' },
  { code: 'W', label: 'W' },
  { code: 'R', label: 'Th' },
  { code: 'F', label: 'F' },
  { code: 'S', label: 'Sa' },
  { code: 'U', label: 'Su' },
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
const WORK_COLOR = { bg: 'bg-slate-200/80', text: 'text-slate-700', border: 'border-l-slate-500' }

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

// One-line summary under the "Your week" heading.
const weekSummary = computed(() => {
  const c = planner.savedSections.length
  const w = planner.workShifts.length
  const parts = []
  if (c) parts.push(`${c} ${c === 1 ? 'course' : 'courses'}`)
  if (w) parts.push(`${w} work ${w === 1 ? 'shift' : 'shifts'}`)
  return parts.join(' · ')
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
  { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-l-blue-400' },
  { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-l-emerald-400' },
  { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-l-amber-400' },
  { bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-l-violet-400' },
  { bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-l-rose-400' },
  { bg: 'bg-teal-50', text: 'text-teal-800', border: 'border-l-teal-400' },
  { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-l-orange-400' },
  { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-l-cyan-400' },
]

function colorFor(section) {
  // Deterministic per-CRN  switching subjects doesn't reshuffle saved blocks.
  let hash = 0
  const key = `${section.school}:${section.crn}`
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function statusBadge(status) {
  if (status === 'open') return { variant: 'success', label: 'Open' }
  if (status === 'closed') return { variant: 'danger', label: 'Closed' }
  return { variant: 'default', label: 'Status unknown' }
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
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Course Planner</h1>
        <p class="text-gray-500 mt-1">
          Search live course offerings and build your weekly schedule.
          <span v-if="schoolName" class="font-medium text-gray-700"> {{ schoolName }}</span>
        </p>
      </div>
      <div class="text-sm text-gray-500">
        <span class="font-semibold text-gray-900 text-lg">{{ planner.savedSections.length }}</span>
        in your plan
      </div>
    </div>

    <!-- No school selected -->
    <Card v-if="!planner.schoolCode" padding="none">
      <EmptyState
        icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        title="Pick your university first"
        description="Go to Profile to choose which school's catalog to search."
        action-label="Open Profile"
        @action="$router.push('/profile')"
      />
    </Card>

    <template v-else>
      <!-- Filters toolbar -->
      <Card>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Select
            label="Term"
            :model-value="planner.selectedTermCode"
            :options="termOptions"
            @change="onTermChange"
            :disabled="planner.loading.terms"
            :hint="planner.loading.terms ? 'Loading terms…' : ''"
            :error="planner.errors.terms"
          />

          <Select
            label="Subject"
            :model-value="planner.selectedSubjectCode"
            :options="subjectOptions"
            @change="onSubjectChange"
            :disabled="!planner.selectedTermCode || planner.loading.subjects"
            :hint="
              planner.loading.subjects
                ? 'Loading subjects…'
                : !planner.selectedTermCode
                  ? 'Pick a term first'
                  : ''
            "
            :error="planner.errors.subjects"
          />

          <Input
            label="Filter results"
            v-model="filterQuery"
            placeholder="Title, course #, instructor…"
            :disabled="!planner.sections.length"
          />
        </div>
        <p v-if="currentSchoolMeta && !currentSchoolMeta.enrollmentDataAvailable" class="text-xs text-gray-500 mt-3">
          {{ currentSchoolMeta.name }} does not expose exact seat counts publicly
          only open / closed status is shown.
        </p>
      </Card>

      <!-- Two-column layout: results + weekly grid -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <!-- LEFT: section list -->
        <div class="lg:col-span-2 space-y-3 min-w-0">
          <div v-if="planner.loading.sections" class="text-center text-gray-500 py-12">
            Loading sections…
          </div>
          <div v-else-if="planner.errors.sections" class="text-center text-danger-600 py-12">
            {{ planner.errors.sections }}
          </div>
          <div v-else-if="!planner.selectedSubjectCode" class="text-center text-gray-500 py-12">
            Pick a term + subject to see sections.
          </div>
          <div v-else-if="filteredSections.length === 0" class="text-center text-gray-500 py-12">
            No sections match.
          </div>
          <div
            v-else
            class="space-y-3 max-h-[70vh] overflow-y-auto pr-1"
          >
            <Card
              v-for="section in filteredSections"
              :key="section.crn"
              padding="md"
              class="hover:border-gray-300 transition-colors"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold text-gray-900">
                      {{ section.subjectCode }} {{ section.courseNumber }}
                    </span>
                    <span class="text-gray-400 text-sm">{{ section.sectionNumber }}</span>
                    <Badge :variant="statusBadge(section.status).variant" size="sm">
                      {{ statusBadge(section.status).label }}
                    </Badge>
                  </div>
                  <p class="text-sm text-gray-800 font-medium line-clamp-1 mb-1">{{ section.title }}</p>
                  <p class="text-xs text-gray-500 truncate">
                    {{ meetingSummary(section.meetings) }}
                  </p>
                  <p v-if="section.instructors.length" class="text-xs text-gray-500 truncate mt-0.5">
                    {{ section.instructors.join(', ') }}
                  </p>
                  <p
                    v-if="
                      section.enrollment.max !== null &&
                      section.enrollment.current !== null
                    "
                    class="text-[11px] text-gray-500 mt-1"
                  >
                    {{ section.enrollment.current }} / {{ section.enrollment.max }} enrolled
                    <span v-if="section.enrollment.available !== null">
                      · {{ section.enrollment.available }} open
                    </span>
                  </p>
                </div>
                <!-- Already saved → Remove -->
                <Button
                  v-if="planner.isSaved(section)"
                  variant="secondary"
                  size="sm"
                  @click="planner.removeSection(section)"
                >
                  Remove
                </Button>
                <!-- Closed or full → disabled pill -->
                <span
                  v-else-if="isSectionUnavailable(section)"
                  class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-danger-50 text-danger-600 border border-danger-200 cursor-not-allowed select-none"
                  :title="unavailableReason(section) === 'full' ? 'This section is at capacity — registration is closed.' : 'This section is closed — registration is not available.'"
                >
                  {{ unavailableReason(section) === 'full' ? 'Full' : 'Closed' }}
                </span>
                <!-- Open → Add -->
                <Button
                  v-else
                  variant="primary"
                  size="sm"
                  @click="planner.addSection(section)"
                >
                  Add
                </Button>
              </div>
            </Card>
          </div>
        </div>

        <!-- RIGHT: weekly grid -->
        <Card class="lg:col-span-3 min-w-0 overflow-hidden" padding="none">
          <!-- Card header -->
          <div class="px-5 py-4 flex items-center justify-between gap-3 border-b border-gray-100">
            <div class="min-w-0">
              <h2 class="text-[15px] font-semibold text-gray-900 tracking-tight leading-tight">Your week</h2>
            </div>
            <Button variant="secondary" size="sm" class="shrink-0" @click="openWorkModal">
              <svg class="w-4 h-4 mr-1.5 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {{ planner.workShifts.length ? 'Edit work hours' : 'Add work hours' }}
            </Button>
          </div>

          <div class="overflow-x-auto">
            <div class="grid grid-cols-[3rem_repeat(7,minmax(5.5rem,1fr))] min-w-[46rem]">
              <!-- Day header row -->
              <div class="bg-surface border-b border-b-gray-200 border-r border-r-gray-100 h-9"></div>
              <div
                v-for="d in DAYS"
                :key="d.code"
                class="flex items-center justify-center h-9 border-b border-b-gray-200 border-r border-r-gray-100 px-2 text-[11px] font-semibold tracking-widest uppercase"
                :class="(d.code === 'S' || d.code === 'U') ? 'bg-gray-50/70 text-gray-400' : 'bg-surface text-gray-500'"
              >
                {{ d.label }}
              </div>

              <!-- Time gutter -->
              <div class="relative border-t border-r border-gray-100" :style="{ height: gridHeightPx + 'px' }">
                <div
                  v-for="h in hourMarkers"
                  :key="h.hour"
                  class="absolute right-1.5 text-[10px] text-gray-400 leading-none font-medium tabular-nums"
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
                class="border-t border-r border-gray-100 relative"
                :class="(d.code === 'S' || d.code === 'U') ? 'bg-gray-50/70' : 'bg-surface'"
                :style="{ height: gridHeightPx + 'px' }"
              >
                <!-- Hour lines -->
                <div
                  v-for="h in hourMarkers"
                  :key="h.hour"
                  class="absolute left-0 right-0 border-t border-gray-100"
                  :style="{ top: h.topPx + 'px' }"
                />
                <!-- Half-hour lines -->
                <div
                  v-for="h in hourMarkers"
                  :key="'hh-' + h.hour"
                  class="absolute left-0 right-0 border-t border-dashed border-gray-100/80"
                  :style="{ top: (h.topPx + ROW_HEIGHT_PX) + 'px' }"
                />
                <!-- Course + work blocks -->
                <div
                  v-for="block in dayBlocks[d.code]"
                  :key="block.key"
                  class="absolute rounded-md p-1.5 text-[11px] font-medium overflow-hidden border-l-4 shadow-sm"
                  :class="block.kind === 'course' && isSectionUnavailable(block.section)
                    ? 'bg-danger-50 text-danger-700 border-l-danger-400 opacity-80'
                    : [block.color.bg, block.color.text, block.color.border]"
                  :style="{
                    top: block.topPx + 'px',
                    height: block.heightPx + 'px',
                    left: `calc(${block.leftPct}% + 2px)`,
                    width: `calc(${block.widthPct}% - 4px)`,
                  }"
                  :title="block.kind === 'work'
                    ? `Work · ${formatClock(block.startTime)}–${formatClock(block.endTime)}`
                    : isSectionUnavailable(block.section)
                      ? `${block.section.subjectCode} ${block.section.courseNumber} · ${unavailableReason(block.section) === 'full' ? 'Full — at capacity' : 'Closed'}`
                      : `${block.section.subjectCode} ${block.section.courseNumber} · ${block.section.title} · ${formatClock(block.startTime)}–${formatClock(block.endTime)}`"
                >
                  <div class="font-bold leading-tight truncate">
                    <template v-if="block.kind === 'work'">Work</template>
                    <template v-else>{{ block.section.subjectCode }} {{ block.section.courseNumber }}</template>
                  </div>
                  <!-- Closed/full badge on the block -->
                  <div
                    v-if="block.kind === 'course' && isSectionUnavailable(block.section)"
                    class="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-danger-600 leading-none"
                  >
                    {{ unavailableReason(block.section) === 'full' ? 'Full' : 'Closed' }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Unscheduled (TBA) saved sections -->
          <div v-if="unscheduledSaved.length" class="px-5 py-4 border-t border-gray-100">
            <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Saved · no meeting time
            </p>
            <ul class="space-y-1.5">
              <li
                v-for="s in unscheduledSaved"
                :key="s.crn"
                class="flex items-center justify-between gap-2 text-sm"
              >
                <span class="truncate flex items-center gap-1.5 min-w-0">
                  <span class="font-semibold">{{ s.subjectCode }} {{ s.courseNumber }}</span>
                  <span class="text-gray-500"> {{ s.sectionNumber }} · {{ s.title }}</span>
                  <span
                    v-if="isSectionUnavailable(s)"
                    class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-danger-50 text-danger-600 border border-danger-200"
                  >
                    {{ unavailableReason(s) === 'full' ? 'Full' : 'Closed' }}
                  </span>
                </span>
                <button
                  class="text-xs text-danger-600 hover:underline shrink-0"
                  @click="planner.removeSection(s)"
                >
                  Remove
                </button>
              </li>
            </ul>
          </div>
        </Card>
      </div>

      <!-- Work schedule modal -->
      <Modal v-model="workModalOpen" title="Weekly work schedule" size="lg">
        <div class="space-y-4">
          <p class="text-sm text-gray-500">
            Add the shifts you work each week. They'll appear on your weekly grid as
            <span class="font-medium text-gray-700">Work</span> blocks so you can plan classes around them.
          </p>

          <div
            v-for="(shift, idx) in workDraft"
            :key="shift.id"
            class="rounded-xl border border-gray-200 p-4 space-y-3"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-gray-700">Shift {{ idx + 1 }}</span>
              <button
                type="button"
                class="p-1 text-gray-400 hover:text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
                title="Remove shift"
                @click="removeDraftShift(idx)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            <!-- Day selector -->
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="d in DAYS"
                :key="d.code"
                type="button"
                class="px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors"
                :class="shift.days.includes(d.code)
                  ? 'bg-primary-900 text-white border-primary-900'
                  : 'bg-surface text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'"
                @click="toggleDraftDay(shift, d.code)"
              >
                {{ d.label }}
              </button>
            </div>

            <!-- Times -->
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-gray-600">Start</label>
                <input
                  v-model="shift.startTime"
                  type="time"
                  class="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-surface text-gray-900 hover:border-gray-300/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 transition-[border-color,box-shadow] duration-200"
                />
              </div>
              <div class="space-y-1.5">
                <label class="block text-sm font-medium text-gray-600">End</label>
                <input
                  v-model="shift.endTime"
                  type="time"
                  class="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-surface text-gray-900 hover:border-gray-300/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 transition-[border-color,box-shadow] duration-200"
                />
              </div>
            </div>

            <p v-if="shiftError(shift)" class="text-xs text-danger-600 flex items-center gap-1">
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {{ shiftError(shift) }}
            </p>
          </div>

          <Button variant="outline" size="sm" block @click="addDraftShift">
            + Add another shift
          </Button>
        </div>

        <template #footer>
          <div class="flex items-center justify-between gap-3">
            <button
              v-if="workDraft.length"
              type="button"
              class="text-sm font-medium text-danger-600 hover:underline"
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
