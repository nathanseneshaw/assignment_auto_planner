<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfileStore } from '../stores/profile'
import { Button, Select } from '../components/ui'
import { useAuthStore } from '../stores/auth'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'
import { isSupabaseConfigured } from '../lib/supabase'
import IcsFeedsManager from '../components/features/IcsFeedsManager.vue'
import SyllabusParser from '../components/SyllabusParser.vue'
import { listSchools } from '../services/coursePlannerApi.js'
import { COURSE_PLANNER } from '../config/featureFlags.js'

const router = useRouter()
const profileStore = useProfileStore()
const authStore = useAuthStore()
const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()

// ── Identity ──────────────────────────────────────────────────────────────────

const accountDisplayName = computed(() => {
  const u = authStore.user
  if (isSupabaseConfigured && u) {
    const meta = u.user_metadata || {}
    return (
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      profileStore.profile.name ||
      ''
    )
  }
  return profileStore.profile.name || ''
})

const accountDisplayEmail = computed(() => {
  if (isSupabaseConfigured && authStore.user?.email) return authStore.user.email
  return profileStore.profile.email || ''
})

function getInitials(name) {
  const n = String(name || '').trim()
  if (!n || n === '') return '?'
  return n.split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2)
}

// Resolve the stored school *code* (e.g. "rice") to its catalog name. Returns
// '' for an empty or unrecognized code so stray values never surface as a chip.
const schoolLabel = computed(() => {
  const code = profileStore.profile.school?.trim()
  if (!code) return ''
  return supportedSchools.value.find((s) => s.code === code)?.name || ''
})

// Header metadata chips  only the bits we actually have a source for. Optional
// profile fields (year / major) render when present; term is derived; school
// name / email are the reliable fallbacks.
const identityChips = computed(() => {
  const p = profileStore.profile
  return [p.year, currentTerm.value.label, p.major, schoolLabel.value, accountDisplayEmail.value]
    .filter((v) => v && v !== '')
})

// ── Stats ─────────────────────────────────────────────────────────────────────

const completedAssignments = computed(() =>
  assignmentsStore.assignments.filter((a) => a.status === 'completed')
)

const onTimeRate = computed(() => {
  const done = completedAssignments.value.filter((a) => a.completedAt && a.dueDate)
  if (!done.length) return null
  const onTime = done.filter((a) => new Date(a.completedAt) <= new Date(a.dueDate)).length
  return Math.round((onTime / done.length) * 100)
})

const onTimeBasis = computed(
  () => completedAssignments.value.filter((a) => a.completedAt && a.dueDate).length
)

const planningStreak = computed(() => {
  const completionDates = new Set(
    completedAssignments.value
      .filter((a) => a.completedAt)
      .map((a) => a.completedAt.slice(0, 10))
  )
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (completionDates.has(key)) {
      streak++
    } else if (i > 0) {
      break
    }
  }
  return streak
})

// Longest historical run of consecutive days with at least one completion.
const personalBestStreak = computed(() => {
  const days = [
    ...new Set(
      completedAssignments.value.filter((a) => a.completedAt).map((a) => a.completedAt.slice(0, 10))
    ),
  ].sort()
  if (!days.length) return 0
  let best = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1] + 'T00:00:00')
    const cur = new Date(days[i] + 'T00:00:00')
    if (Math.round((cur - prev) / 86400000) === 1) {
      run++
      best = Math.max(best, run)
    } else {
      run = 1
    }
  }
  return best
})

// ── Term framing ────────────────────────────────────────────────────────────
// No term is stored on the profile, so derive a sensible one from today's date
// (Spring Jan–May · Summer Jun–Jul · Fall Aug–Dec) for the eyebrow labels.

const currentTerm = computed(() => {
  const d = new Date()
  const m = d.getMonth()
  const y = d.getFullYear()
  let name
  let start
  if (m <= 4) {
    name = 'Spring'
    start = new Date(y, 0, 1)
  } else if (m <= 6) {
    name = 'Summer'
    start = new Date(y, 5, 1)
  } else {
    name = 'Fall'
    start = new Date(y, 7, 1)
  }
  return { name, year: y, label: `${name} ${y}`, start }
})

const completedThisTerm = computed(() => {
  const start = currentTerm.value.start
  return completedAssignments.value.filter((a) => a.completedAt && new Date(a.completedAt) >= start)
    .length
})

const firstActivityLabel = computed(() => {
  const dates = completedAssignments.value
    .map((a) => a.completedAt)
    .filter(Boolean)
    .sort()
  if (!dates.length) return ''
  const d = new Date(dates[0])
  return `Since ${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`
})

const glanceEyebrow = computed(() =>
  firstActivityLabel.value ? `All time · ${firstActivityLabel.value}` : 'All time'
)

// ── Course standing ─────────────────────────────────────────────────────────

const ON_TRACK_THRESHOLD = 50

const onTrackCount = computed(
  () => coursesStore.courses.filter((c) => courseProgress(c.id) >= ON_TRACK_THRESHOLD).length
)

// Editorial "This semester" summary, assembled entirely from real data: the two
// most-active courses, the live streak, and how many courses are on track.
const semester = computed(() => {
  const byActivity = [...coursesStore.courses].sort(
    (a, b) =>
      (assignmentsStore.assignmentsByCourse[b.id]?.length || 0) -
      (assignmentsStore.assignmentsByCourse[a.id]?.length || 0)
  )
  return {
    courses: byActivity.slice(0, 2).map((c) => c.name).filter(Boolean),
    streak: planningStreak.value,
    onTrack: onTrackCount.value,
    total: coursesStore.courses.length,
  }
})

// ── Activity heatmap ──────────────────────────────────────────────────────────

const WEEKS = 14
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const heatmapData = computed(() => {
  const countByDate = {}
  for (const a of completedAssignments.value) {
    if (!a.completedAt) continue
    const key = a.completedAt.slice(0, 10)
    countByDate[key] = (countByDate[key] || 0) + 1
  }

  const today = new Date()
  // End on the Saturday of the current week so the grid is always full columns
  const endDate = new Date(today)
  endDate.setDate(today.getDate() + (6 - today.getDay()))

  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - (WEEKS * 7 - 1))

  const weeks = []
  let currentWeek = []
  const cur = new Date(startDate)
  while (cur <= endDate) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    const isFuture = cur > today
    currentWeek.push({ date: key, count: isFuture ? -1 : (countByDate[key] || 0) })
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    cur.setDate(cur.getDate() + 1)
  }
  if (currentWeek.length) weeks.push(currentWeek)
  return weeks
})

const monthLabelMap = computed(() => {
  const map = {}
  let lastMonth = null
  heatmapData.value.forEach((week, wi) => {
    const firstDay = week[0]
    if (!firstDay) return
    const month = new Date(firstDay.date + 'T00:00:00').getMonth()
    if (month !== lastMonth) {
      map[wi] = MONTH_LABELS[month]
      lastMonth = month
    }
  })
  return map
})

function heatmapCellClass(count) {
  if (count < 0) return 'bg-gray-200/40 dark:bg-gray-700/25'
  if (count === 0) return 'bg-gray-200/70 dark:bg-gray-700/50'
  if (count === 1) return 'bg-primary-200 dark:bg-primary-900'
  if (count === 2) return 'bg-primary-400 dark:bg-primary-700'
  if (count === 3) return 'bg-primary-600 dark:bg-primary-500'
  return 'bg-primary-800 dark:bg-primary-300'
}

// ── Course helpers ─────────────────────────────────────────────────────────────

const colorHexMap = {
  'bg-blue-100': '#3b82f6',
  'bg-green-100': '#22c55e',
  'bg-purple-100': '#a855f7',
  'bg-orange-100': '#f97316',
  'bg-pink-100': '#ec4899',
  'bg-teal-100': '#14b8a6',
  'bg-indigo-100': '#6366f1',
  'bg-red-100': '#ef4444',
}

function courseAccentColor(course) {
  return colorHexMap[course.color?.bg] || '#10b981'
}

function courseInitials(name) {
  return (name || '?').split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

function courseProgress(courseId) {
  const all = assignmentsStore.assignmentsByCourse[courseId] || []
  if (!all.length) return 0
  return Math.round((all.filter((a) => a.status === 'completed').length / all.length) * 100)
}

// Subtitle line under each course name. Prefers real catalog metadata
// (code / units / schedule) when an import provided it, otherwise falls back to
// a live assignment tally so the row never looks empty.
function courseSubtitle(course) {
  const meta = [course.code, course.units ? `${course.units} units` : null, course.schedule].filter(
    Boolean
  )
  if (meta.length) return meta.join('  ·  ')
  const all = assignmentsStore.assignmentsByCourse[course.id] || []
  if (!all.length) return 'No assignments yet'
  const done = all.filter((a) => a.status === 'completed').length
  return `${all.length} assignment${all.length === 1 ? '' : 's'}  ·  ${done} done`
}

function courseNextAssignment(courseId) {
  const today = new Date().toISOString().slice(0, 10)
  return (assignmentsStore.assignmentsByCourse[courseId] || [])
    .filter((a) => a.dueDate >= today && a.status !== 'completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null
}

function formatDueDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dueWeekday(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

function daysUntil(dateStr) {
  if (!dateStr) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff < 7) return `in ${diff} days`
  if (diff < 14) return 'in 1 week'
  return `in ${Math.round(diff / 7)} weeks`
}

// ── School / Course Planner ────────────────────────────────────────────────────

const supportedSchools = ref([])
const schoolsLoading = ref(false)
const schoolsError = ref('')
const selectedSchool = computed({
  get: () => profileStore.profile.school || '',
  set: (v) => profileStore.updateProfile({ school: v }),
})

async function loadSupportedSchools() {
  schoolsLoading.value = true
  schoolsError.value = ''
  try {
    supportedSchools.value = await listSchools()
  } catch (e) {
    schoolsError.value = e?.message || 'Failed to load supported schools.'
  } finally {
    schoolsLoading.value = false
  }
}

const schoolOptions = computed(() =>
  [{ value: '', label: 'Not set  pick later' }].concat(
    supportedSchools.value.map((s) => ({ value: s.code, label: s.name }))
  )
)

// ── Session ───────────────────────────────────────────────────────────────────

const signingOut = ref(false)

async function signOutAccount() {
  signingOut.value = true
  try {
    await authStore.signOut()
    await router.push({ name: 'Login' })
  } finally {
    signingOut.value = false
  }
}

onMounted(loadSupportedSchools)
</script>

<template>
  <div class="max-w-3xl mx-auto">

    <!-- ── Header ── -->
    <header class="flex items-start justify-between gap-4 pb-7">
      <div class="flex items-center gap-4 min-w-0">
        <div
          class="w-14 h-14 rounded-full bg-primary-500 flex items-center justify-center text-white text-xl font-semibold shrink-0 shadow-sm shadow-primary-900/20"
          aria-hidden="true"
        >
          {{ getInitials(accountDisplayName) }}
        </div>
        <div class="min-w-0">
          <h1 class="display text-[26px] text-gray-900 dark:text-gray-100 leading-tight truncate">
            {{ accountDisplayName }}
          </h1>
          <div class="flex items-center gap-x-2 gap-y-1 mt-1.5 flex-wrap">
            <template v-for="(chip, i) in identityChips" :key="i">
              <span v-if="i > 0" class="text-gray-300 dark:text-gray-600 select-none" aria-hidden="true">·</span>
              <span class="eyebrow text-gray-500 dark:text-gray-400">{{ chip }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2.5 shrink-0 pt-1">
        <!-- Dark mode toggle -->
        <button
          type="button"
          role="switch"
          :aria-checked="profileStore.profile.darkMode"
          @click="profileStore.toggleDarkMode()"
          class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:ring-offset-1"
          :class="profileStore.profile.darkMode ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'"
          :title="profileStore.profile.darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <span
            class="inline-block h-3.5 w-3.5 transform rounded-full bg-surface shadow-sm transition-transform duration-200"
            :class="profileStore.profile.darkMode ? 'translate-x-4' : 'translate-x-0.5'"
          />
        </button>

        <template v-if="isSupabaseConfigured">
          <Button v-if="authStore.user" variant="secondary" size="sm" :loading="signingOut" :disabled="signingOut" @click="signOutAccount">
            Sign out
          </Button>
          <router-link v-else to="/login">
            <Button size="sm">Sign in</Button>
          </router-link>
        </template>
      </div>
    </header>

    <!-- ── This semester ── -->
    <section v-if="semester.courses.length" class="py-7 border-t border-paper-line dark:border-gray-700/60">
      <div class="flex items-baseline justify-between gap-4 mb-4">
        <h2 class="display text-[15px] text-gray-900 dark:text-gray-100">This semester</h2>
        <span class="eyebrow text-gray-400 dark:text-gray-500">{{ currentTerm.label }}</span>
      </div>
      <p class="font-serif text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
        <template v-if="semester.courses.length >= 2">Balancing <em class="text-gray-800 dark:text-gray-200">{{ semester.courses[0] }}</em> and <em class="text-gray-800 dark:text-gray-200">{{ semester.courses[1] }}</em> this term.</template>
        <template v-else>Focused on <em class="text-gray-800 dark:text-gray-200">{{ semester.courses[0] }}</em> this term.</template>
        <template v-if="semester.streak > 0"> <span class="font-medium text-gray-800 dark:text-gray-200">{{ semester.streak }} day{{ semester.streak === 1 ? '' : 's' }} into a planning streak.</span></template>
        <template v-if="semester.total"> Aiming to keep all {{ semester.total }} course{{ semester.total === 1 ? '' : 's' }} on track  {{ semester.onTrack }} {{ semester.onTrack === 1 ? 'is' : 'are' }} there now.</template>
      </p>
    </section>

    <!-- ── At a glance ── -->
    <section class="py-7 border-t border-paper-line dark:border-gray-700/60">
      <div class="flex items-baseline justify-between gap-4 mb-4">
        <h2 class="display text-[15px] text-gray-900 dark:text-gray-100">At a glance</h2>
        <span class="eyebrow text-gray-400 dark:text-gray-500">{{ glanceEyebrow }}</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-paper-line dark:border-gray-700/60 overflow-hidden">
        <!-- Completed assignments -->
        <div class="p-4 border-b sm:border-b-0 border-paper-line dark:border-gray-700/60">
          <div class="flex items-baseline gap-1">
            <span class="display text-[28px] leading-none text-gray-900 dark:text-gray-100">{{ completedAssignments.length }}</span>
            <span class="text-[11px] text-gray-400 font-medium">done</span>
          </div>
          <p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">Assignments completed</p>
          <p v-if="completedThisTerm" class="mt-1.5 font-mono text-[10px] text-primary-600 dark:text-primary-400">↑ {{ completedThisTerm }} this term</p>
        </div>

        <!-- Planning streak -->
        <div class="p-4 border-l border-b sm:border-b-0 border-paper-line dark:border-gray-700/60">
          <div class="flex items-baseline gap-1">
            <span class="display text-[28px] leading-none text-gray-900 dark:text-gray-100">{{ planningStreak }}</span>
            <span class="text-[11px] text-gray-400 font-medium">days</span>
          </div>
          <p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">Current planning streak</p>
          <p v-if="personalBestStreak" class="mt-1.5 font-mono text-[10px] text-gray-400 dark:text-gray-500">Personal best · {{ personalBestStreak }}d</p>
        </div>

        <!-- On-time completion rate -->
        <div class="p-4 sm:border-l border-paper-line dark:border-gray-700/60">
          <div class="flex items-baseline gap-0.5">
            <span class="display text-[28px] leading-none text-gray-900 dark:text-gray-100">{{ onTimeRate !== null ? onTimeRate : '' }}</span>
            <span v-if="onTimeRate !== null" class="text-[11px] text-gray-400 font-medium">%</span>
          </div>
          <p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">On-time completion rate</p>
          <p v-if="onTimeBasis" class="mt-1.5 font-mono text-[10px] text-gray-400 dark:text-gray-500">across {{ onTimeBasis }} graded</p>
        </div>

        <!-- Active courses -->
        <div class="p-4 border-l border-paper-line dark:border-gray-700/60">
          <div class="flex items-baseline gap-1">
            <span class="display text-[28px] leading-none text-gray-900 dark:text-gray-100">{{ coursesStore.courses.length }}</span>
          </div>
          <p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">Active courses</p>
          <p v-if="coursesStore.courses.length" class="mt-1.5 font-mono text-[10px] text-gray-400 dark:text-gray-500">{{ onTrackCount }} of {{ coursesStore.courses.length }} on track</p>
        </div>
      </div>
    </section>

    <!-- ── Activity heatmap ── -->
    <section class="py-7 border-t border-paper-line dark:border-gray-700/60">
      <div class="flex items-baseline justify-between gap-4 mb-4">
        <h2 class="display text-[15px] text-gray-900 dark:text-gray-100">Activity</h2>
        <span class="eyebrow text-gray-400 dark:text-gray-500">Past {{ WEEKS }} weeks</span>
      </div>
      <div class="overflow-x-auto">
        <!-- Month labels row -->
        <div class="flex gap-1 mb-1.5 ml-8">
          <div
            v-for="(week, wi) in heatmapData"
            :key="wi"
            class="w-3 shrink-0 text-[9px] text-gray-400 dark:text-gray-500 font-mono leading-none"
          >
            {{ monthLabelMap[wi] || '' }}
          </div>
        </div>
        <!-- Grid body -->
        <div class="flex gap-1">
          <!-- Day labels -->
          <div class="flex flex-col gap-1 mr-1 shrink-0">
            <div
              v-for="(label, i) in DAY_LABELS"
              :key="i"
              class="h-3 w-6 text-[9px] text-gray-400 dark:text-gray-500 font-mono leading-3 select-none"
            >
              {{ i % 2 === 1 ? label : '' }}
            </div>
          </div>
          <!-- Week columns -->
          <div
            v-for="(week, wi) in heatmapData"
            :key="wi"
            class="flex flex-col gap-1"
          >
            <div
              v-for="(day, di) in week"
              :key="di"
              class="w-3 h-3 rounded-sm transition-colors"
              :class="heatmapCellClass(day.count)"
              :title="day.count >= 0 ? `${day.date}: ${day.count} completed` : day.date"
            />
          </div>
        </div>
        <!-- Legend -->
        <div class="flex items-center gap-1 mt-3 ml-8">
          <span class="text-[9px] text-gray-400 dark:text-gray-500 font-mono mr-0.5">Less</span>
          <div class="w-3 h-3 rounded-sm bg-gray-200/70 dark:bg-gray-700/50" />
          <div class="w-3 h-3 rounded-sm bg-primary-200 dark:bg-primary-900" />
          <div class="w-3 h-3 rounded-sm bg-primary-400 dark:bg-primary-700" />
          <div class="w-3 h-3 rounded-sm bg-primary-600 dark:bg-primary-500" />
          <div class="w-3 h-3 rounded-sm bg-primary-800 dark:bg-primary-300" />
          <span class="text-[9px] text-gray-400 dark:text-gray-500 font-mono ml-0.5">More</span>
        </div>
      </div>
    </section>

    <!-- ── Courses ── -->
    <section v-if="coursesStore.courses.length" class="py-7 border-t border-paper-line dark:border-gray-700/60">
      <div class="flex items-baseline justify-between gap-4 mb-1">
        <h2 class="display text-[15px] text-gray-900 dark:text-gray-100">Courses</h2>
        <span class="eyebrow text-gray-400 dark:text-gray-500">{{ coursesStore.courses.length }} enrolled</span>
      </div>
      <div class="divide-y divide-paper-line dark:divide-gray-700/50">
        <div
          v-for="course in coursesStore.coursesSorted"
          :key="course.id"
          class="flex items-center gap-3.5 py-3.5"
        >
          <!-- Colored badge -->
          <div
            class="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 select-none"
            :style="{ backgroundColor: courseAccentColor(course) }"
          >
            {{ courseInitials(course.name) }}
          </div>

          <!-- Name + subtitle -->
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug">{{ course.name }}</p>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">{{ courseSubtitle(course) }}</p>
          </div>

          <!-- Progress -->
          <div class="hidden sm:flex items-center gap-2 w-36 shrink-0">
            <div class="flex-1 h-[3px] rounded-full bg-gray-200/70 dark:bg-gray-700">
              <div
                class="h-[3px] rounded-full transition-all duration-300"
                :style="{ width: courseProgress(course.id) + '%', backgroundColor: courseAccentColor(course) }"
              />
            </div>
            <span class="text-[10px] text-gray-400 dark:text-gray-500 font-mono shrink-0 tabular-nums">
              {{ courseProgress(course.id) }}%
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Connected integrations ── -->
    <section class="py-7 border-t border-paper-line dark:border-gray-700/60">
      <div class="flex items-baseline justify-between gap-4 mb-3">
        <h2 class="display text-[15px] text-gray-900 dark:text-gray-100">Connected integrations</h2>
        <span class="eyebrow text-gray-400 dark:text-gray-500">Manage sources</span>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
        Pull assignments in automatically. Subscribe to one calendar feed (Canvas, Brightspace,
        Blackboard) or import a syllabus. Re-open a connected source any time to re-sync.
      </p>
      <div>
        <IcsFeedsManager />
        <SyllabusParser />
      </div>
    </section>

    <!-- ── University (Course Planner) ── -->
    <section v-if="COURSE_PLANNER" class="py-7 border-t border-paper-line dark:border-gray-700/60">
      <div class="flex items-baseline justify-between gap-4 mb-4">
        <h2 class="display text-[15px] text-gray-900 dark:text-gray-100">Your university</h2>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
        Selects which university's live course catalog the Course Planner searches.
      </p>
      <Select
        v-model="selectedSchool"
        label="University"
        :options="schoolOptions"
        :disabled="schoolsLoading || supportedSchools.length === 0"
        :hint="schoolsLoading ? 'Loading…' : schoolsError || ''"
        :error="schoolsError"
      />
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-3">
        Schools marked "limited enrollment data" expose only open / closed status, not exact seat counts.
      </p>
    </section>

  </div>
</template>
