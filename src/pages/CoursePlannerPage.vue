<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useCoursePlannerStore } from '../stores/coursePlanner'
import { useProfileStore } from '../stores/profile'
import { Card, Button, Select, Input, Badge, EmptyState } from '../components/ui'
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
    // Falls back to the bare school code in the header — non-fatal.
  }
  if (planner.schoolCode) {
    planner.loadTerms()
  }
})

watch(
  () => planner.schoolCode,
  (school) => {
    planner.resetForSchoolChange()
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
  ...planner.subjects.map((s) => ({ value: s.code, label: `${s.code} — ${s.label}` })),
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

/** Returns array of { section, meeting, day, topPx, heightPx, color } per day. */
const calendarBlocks = computed(() => {
  const byDay = Object.fromEntries(DAYS.map((d) => [d.code, []]))
  for (const section of planner.savedSections) {
    for (const m of section.meetings || []) {
      if (!m.startTime || !m.endTime) continue
      const startMin = toMinutes(m.startTime)
      const endMin = toMinutes(m.endTime)
      const top = ((startMin - HOUR_START * 60) / 30) * ROW_HEIGHT_PX
      const height = Math.max(((endMin - startMin) / 30) * ROW_HEIGHT_PX, 22)
      for (const d of m.days || []) {
        if (!byDay[d]) continue
        byDay[d].push({
          section,
          meeting: m,
          day: d,
          topPx: top,
          heightPx: height,
          color: colorFor(section),
        })
      }
    }
  }
  return byDay
})

const unscheduledSaved = computed(() =>
  planner.savedSections.filter((s) => !s.meetings.some((m) => m.startTime && m.endTime && m.days.length))
)

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
  { bg: 'bg-blue-100', text: 'text-blue-900', ring: 'ring-blue-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-900', ring: 'ring-emerald-300' },
  { bg: 'bg-amber-100', text: 'text-amber-900', ring: 'ring-amber-300' },
  { bg: 'bg-violet-100', text: 'text-violet-900', ring: 'ring-violet-300' },
  { bg: 'bg-rose-100', text: 'text-rose-900', ring: 'ring-rose-300' },
  { bg: 'bg-teal-100', text: 'text-teal-900', ring: 'ring-teal-300' },
  { bg: 'bg-orange-100', text: 'text-orange-900', ring: 'ring-orange-300' },
  { bg: 'bg-cyan-100', text: 'text-cyan-900', ring: 'ring-cyan-300' },
]

function colorFor(section) {
  // Deterministic per-CRN — switching subjects doesn't reshuffle saved blocks.
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

function onTermChange(code) {
  const term = planner.terms.find((t) => t.code === code)
  planner.setTerm(code, term?.label || '')
}

function onSubjectChange(code) {
  const subject = planner.subjects.find((s) => s.code === code)
  planner.setSubject(code, subject?.label || '')
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
          <span v-if="schoolName" class="font-medium text-gray-700">— {{ schoolName }}</span>
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
          {{ currentSchoolMeta.name }} does not expose exact seat counts publicly —
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
                <Button
                  :variant="planner.isSaved(section) ? 'secondary' : 'primary'"
                  size="sm"
                  @click="planner.isSaved(section) ? planner.removeSection(section) : planner.addSection(section)"
                >
                  {{ planner.isSaved(section) ? 'Remove' : 'Add' }}
                </Button>
              </div>
            </Card>
          </div>
        </div>

        <!-- RIGHT: weekly grid -->
        <Card class="lg:col-span-3 min-w-0">
          <div class="flex items-baseline justify-between mb-3">
            <h2 class="text-lg font-semibold text-gray-900">Your week</h2>
            <p v-if="planner.savedSections.length === 0" class="text-xs text-gray-500">
              Add sections to build your schedule.
            </p>
          </div>
          <div class="overflow-x-auto">
            <div class="grid grid-cols-[3rem_repeat(7,minmax(6rem,1fr))] min-w-180 border-l border-t border-gray-200 rounded-md overflow-hidden">
              <!-- Time gutter header -->
              <div class="border-r border-b border-gray-200 bg-gray-50"></div>
              <!-- Day headers -->
              <div
                v-for="d in DAYS"
                :key="d.code"
                class="border-r border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-700 text-center"
              >
                {{ d.label }}
              </div>
              <!-- Time gutter + day columns -->
              <div class="border-r border-gray-200 relative" :style="{ height: gridHeightPx + 'px' }">
                <div
                  v-for="h in hourMarkers"
                  :key="h.hour"
                  class="absolute left-0 right-0 text-[10px] text-gray-400 px-1 -translate-y-1/2"
                  :style="{ top: h.topPx + 'px' }"
                >
                  {{ h.label }}
                </div>
              </div>
              <div
                v-for="d in DAYS"
                :key="d.code"
                class="border-r border-gray-200 relative"
                :style="{ height: gridHeightPx + 'px' }"
              >
                <!-- Hour-line grid -->
                <div
                  v-for="h in hourMarkers"
                  :key="h.hour"
                  class="absolute left-0 right-0 border-t border-gray-100"
                  :style="{ top: h.topPx + 'px' }"
                />
                <!-- Section blocks -->
                <div
                  v-for="(block, idx) in calendarBlocks[d.code]"
                  :key="`${block.section.crn}-${idx}`"
                  class="absolute left-1 right-1 rounded-md p-1.5 text-[11px] font-medium ring-1 overflow-hidden shadow-sm"
                  :class="[block.color.bg, block.color.text, block.color.ring]"
                  :style="{ top: block.topPx + 'px', height: block.heightPx + 'px' }"
                  :title="`${block.section.subjectCode} ${block.section.courseNumber} · ${block.section.title} · ${formatClock(block.meeting.startTime)}–${formatClock(block.meeting.endTime)}`"
                >
                  <div class="font-bold leading-tight">
                    {{ block.section.subjectCode }} {{ block.section.courseNumber }}
                  </div>
                  <div class="leading-tight truncate opacity-80">
                    {{ formatClock(block.meeting.startTime) }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Unscheduled (TBA) saved sections -->
          <div v-if="unscheduledSaved.length" class="mt-4 border-t border-gray-100 pt-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Saved with no meeting time
            </p>
            <ul class="space-y-1.5">
              <li
                v-for="s in unscheduledSaved"
                :key="s.crn"
                class="flex items-center justify-between gap-2 text-sm"
              >
                <span class="truncate">
                  <span class="font-semibold">{{ s.subjectCode }} {{ s.courseNumber }}</span>
                  <span class="text-gray-500"> {{ s.sectionNumber }} · {{ s.title }}</span>
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
    </template>
  </div>
</template>
