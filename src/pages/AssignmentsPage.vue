<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'
import { Modal, Input, Dropdown, DatePicker, Button, ConfirmDialog } from '../components/ui'
import { resolveAssignmentCourseName, importSourceLabel } from '../utils/assignmentDisplay.js'

const route = useRoute()
const router = useRouter()
const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()

// ── Add / edit modal + delete dialog state ───────────────────────────────
const showModal = ref(false)
const isEditing = ref(false)
const editingAssignmentId = ref(null)
const showDeleteConfirm = ref(false)
const assignmentToDelete = ref(null)

const formData = ref({
  title: '',
  description: '',
  courseId: '',
  dueDate: ''
})

// ── View state: status tab + course filter ───────────────────────────────
/** 'all' | 'upcoming' | 'overdue' | 'completed' */
const activeTab = ref('all')
/** 'all' | <courseId> */
const filterCourse = ref('all')

const modalCourseOptions = computed(() => [
  { value: '', label: 'Select a course' },
  ...coursesStore.courses.map((c) => ({ value: c.id, label: c.name })),
])

const modalTitle = computed(() => (isEditing.value ? 'Edit Assignment' : 'Add New Assignment'))

// ── Date helpers (local-time safe, no UTC drift) ─────────────────────────
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function localDateKey(d) {
  const dt = d || new Date()
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function parseDateLocal(dateString) {
  if (!dateString) return new Date()
  const datePart = String(dateString).slice(0, 10)
  const [y, m, d] = datePart.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "May 15"  month abbreviation + day, no year (matches the editorial layout). */
function shortDate(dateString) {
  const d = parseDateLocal(dateString)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

// ── Status classification ────────────────────────────────────────────────
// Archived = removed from its ICS feed (Pillar A). It gets its own bucket and is
// kept out of the active overdue/upcoming/completed lists, but its completion is
// preserved and still counts toward the semester total on the dashboard.
function isArchived(a) {
  return a.feedStatus === 'archived'
}
function isCompleted(a) {
  return !isArchived(a) && a.status === 'completed'
}
function isOverdue(a) {
  return !isArchived(a) && a.status !== 'completed' && a.dueDate < localDateKey()
}
function sevenDaysFromNow() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return localDateKey(d)
}

function isUpcoming(a) {
  return !isArchived(a) && a.status !== 'completed' && a.dueDate >= localDateKey() && a.dueDate <= sevenDaysFromNow()
}

function byDueDate(list) {
  return [...list].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
}

// Everything below the top-bar / tabs / overview respects the active course.
const courseFiltered = computed(() => {
  if (filterCourse.value === 'all') return assignmentsStore.assignments
  return assignmentsStore.assignments.filter((a) => a.courseId === filterCourse.value)
})

const overdueList = computed(() => byDueDate(courseFiltered.value.filter(isOverdue)))
const upcomingList = computed(() => byDueDate(courseFiltered.value.filter(isUpcoming)))
const completedList = computed(() => byDueDate(courseFiltered.value.filter(isCompleted)))
// Most-recently-due first — the items a student is most likely looking for.
const archivedList = computed(() =>
  [...courseFiltered.value.filter(isArchived)].sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))
)

const counts = computed(() => ({
  all: courseFiltered.value.length,
  overdue: overdueList.value.length,
  upcoming: upcomingList.value.length,
  completed: completedList.value.length,
  archived: archivedList.value.length,
}))

// The Archived tab only appears once there's something archived — no empty noise.
const tabs = computed(() => {
  const base = [
    { key: 'all', label: 'All', count: counts.value.all },
    { key: 'upcoming', label: 'Upcoming', count: counts.value.upcoming },
    { key: 'overdue', label: 'Overdue', count: counts.value.overdue },
    { key: 'completed', label: 'Completed', count: counts.value.completed },
  ]
  if (counts.value.archived) base.push({ key: 'archived', label: 'Archived', count: counts.value.archived })
  return base
})

// Grouped sections rendered for the active tab.
const sections = computed(() => {
  const out = []
  const tab = activeTab.value
  if ((tab === 'all' || tab === 'overdue') && overdueList.value.length) {
    out.push({ key: 'overdue', label: 'Overdue', tone: 'rust', items: overdueList.value })
  }
  if ((tab === 'all' || tab === 'upcoming') && upcomingList.value.length) {
    out.push({ key: 'upcoming', label: 'Upcoming', tone: 'muted', items: upcomingList.value })
  }
  if ((tab === 'all' || tab === 'completed') && completedList.value.length) {
    out.push({ key: 'completed', label: 'Completed', tone: 'muted', items: completedList.value })
  }
  if ((tab === 'all' || tab === 'archived') && archivedList.value.length) {
    out.push({ key: 'archived', label: 'Removed from calendar', tone: 'muted', items: archivedList.value })
  }
  return out
})

const emptyCopy = computed(() => {
  switch (activeTab.value) {
    case 'overdue':
      return { title: 'Nothing overdue — nicely done.', sub: 'You’re all caught up here.' }
    case 'upcoming':
      return { title: 'Nothing due in the next 7 days.', sub: 'You\'re clear for now — check back as deadlines approach.' }
    case 'completed':
      return { title: 'Nothing completed yet.', sub: 'Check items off and they’ll collect here.' }
    case 'archived':
      return { title: 'Nothing archived.', sub: 'Assignments removed from your calendar feed are kept here.' }
    default:
      return { title: 'No assignments yet.', sub: 'Add one manually or connect a calendar feed.' }
  }
})

// ── Overview panel ───────────────────────────────────────────────────────
const overviewRows = computed(() => {
  const rows = [
    { label: 'Total', value: counts.value.all, tone: 'text-gray-900 dark:text-gray-100' },
    { label: 'Overdue', value: counts.value.overdue, tone: counts.value.overdue ? 'text-rust-600 dark:text-rust-500' : 'text-gray-400' },
    { label: 'Upcoming', value: counts.value.upcoming, tone: 'text-gray-900 dark:text-gray-100' },
    { label: 'Completed', value: counts.value.completed, tone: 'text-gray-400' },
  ]
  if (counts.value.archived) {
    rows.push({ label: 'Archived', value: counts.value.archived, tone: 'text-gray-400' })
  }
  return rows
})

// ── Course swatches ──────────────────────────────────────────────────────
// Map the stored course color (e.g. "bg-blue-100") to a solid dot. Listing the
// literals keeps them in Tailwind's JIT scan so the classes are generated.
const DOT_BY_BG = {
  'bg-blue-100': 'bg-blue-500',
  'bg-green-100': 'bg-green-500',
  'bg-purple-100': 'bg-purple-500',
  'bg-orange-100': 'bg-orange-500',
  'bg-pink-100': 'bg-pink-500',
  'bg-teal-100': 'bg-teal-500',
  'bg-indigo-100': 'bg-indigo-500',
  'bg-red-100': 'bg-red-500',
}

function dotColor(color) {
  return (color && DOT_BY_BG[color.bg]) || 'bg-gray-400'
}

function assignmentDot(assignment) {
  const c = assignment.courseId ? coursesStore.getCourseById(assignment.courseId) : null
  return c ? dotColor(c.color) : 'bg-gray-400'
}

const courseFilters = computed(() => {
  const all = assignmentsStore.assignments
  return coursesStore.coursesSorted
    .map((c) => ({
      id: c.id,
      name: c.name,
      count: all.filter((a) => a.courseId === c.id).length,
      dot: dotColor(c.color),
    }))
    .filter((c) => c.count > 0)
})

// Busiest upcoming day, for the overdue nudge ("…that's when your heaviest batch lands").
const heaviestUpcoming = computed(() => {
  const tally = {}
  for (const a of upcomingList.value) {
    const key = String(a.dueDate || '').slice(0, 10)
    if (!key) continue
    tally[key] = (tally[key] || 0) + 1
  }
  let best = null
  let bestCount = 0
  for (const [key, n] of Object.entries(tally)) {
    if (n > bestCount) {
      bestCount = n
      best = key
    }
  }
  return best ? { date: best, count: bestCount } : null
})

function assignmentCourseLabel(assignment) {
  return resolveAssignmentCourseName(assignment, coursesStore.getCourseById)
}

function assignmentImportLabel(assignment) {
  return importSourceLabel(assignment.importSource)
}

function importBadgeClass(assignment) {
  if (assignment.importSource === 'ics') {
    return 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 border-accent-200/70 dark:border-accent-800/60'
  }
  return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-paper-line dark:border-gray-700'
}

// ── CRUD ─────────────────────────────────────────────────────────────────
function resetForm() {
  formData.value = { title: '', description: '', courseId: '', dueDate: '' }
  isEditing.value = false
  editingAssignmentId.value = null
}

function openAddModal() {
  resetForm()
  showModal.value = true
}

function maybeOpenAddModalFromRoute() {
  if (route.query.action === 'add') {
    openAddModal()
    const { action, ...restQuery } = route.query
    router.replace({ path: route.path, query: restQuery })
  }
}

function openEditModal(assignment) {
  isEditing.value = true
  editingAssignmentId.value = assignment.id
  formData.value = {
    title: assignment.title,
    description: assignment.description || '',
    courseId: assignment.courseId || '',
    dueDate: assignment.dueDate
  }
  showModal.value = true
}

function saveAssignment() {
  if (!formData.value.title.trim() || !formData.value.dueDate) return

  const course = coursesStore.getCourseById(formData.value.courseId)

  if (isEditing.value && editingAssignmentId.value) {
    assignmentsStore.updateAssignment(editingAssignmentId.value, {
      title: formData.value.title.trim(),
      description: formData.value.description.trim(),
      courseId: formData.value.courseId,
      courseName: course?.name || 'No Course',
      dueDate: formData.value.dueDate
    })
  } else {
    assignmentsStore.addAssignment({
      title: formData.value.title.trim(),
      description: formData.value.description.trim(),
      courseId: formData.value.courseId,
      courseName: course?.name || 'No Course',
      dueDate: formData.value.dueDate,
      status: 'pending'
    })
  }

  showModal.value = false
  resetForm()
}

function promptDeleteAssignment(assignment) {
  assignmentToDelete.value = assignment
  showDeleteConfirm.value = true
}

function confirmDeleteAssignment() {
  if (assignmentToDelete.value) {
    assignmentsStore.deleteAssignment(assignmentToDelete.value.id)
    assignmentToDelete.value = null
  }
}

function toggleAssignmentComplete(assignment) {
  if (assignment.status === 'completed') {
    assignmentsStore.markAssignmentIncomplete(assignment.id)
  } else {
    assignmentsStore.markAssignmentComplete(assignment.id)
  }
}

onMounted(() => {
  maybeOpenAddModalFromRoute()
})
</script>

<template>
  <div class="pb-12">
    <!-- Top meta bar -->
    <div class="flex items-center justify-end gap-4 pb-6">
      <p class="eyebrow text-gray-400">
        {{ counts.all }} Total
        <span class="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
        <span :class="counts.overdue ? 'text-rust-600 dark:text-rust-500' : ''">{{ counts.overdue }} Overdue</span>
      </p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-x-10 gap-y-10">

      <!-- ══ Main column ═══════════════════════════════════════════════════ -->
      <div class="min-w-0">
        <!-- Title + new assignment -->
        <div class="flex items-start justify-between gap-4">
          <h1 class="display text-4xl sm:text-5xl text-gray-900 dark:text-gray-50">Assignments</h1>
          <button
            type="button"
            @click="openAddModal"
            class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New assignment
          </button>
        </div>

        <!-- Tabs -->
        <div class="mt-6 flex items-center gap-5 border-b border-paper-line dark:border-gray-700/60">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            @click="activeTab = tab.key"
            class="eyebrow shrink-0 -mb-px flex items-center gap-1.5 border-b-2 pb-2.5 transition-colors"
            :class="activeTab === tab.key
              ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
              : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          >
            {{ tab.label }}
            <span
              class="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] leading-none font-semibold transition-colors"
              :class="activeTab === tab.key
                ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                : 'bg-paper-line/80 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400'"
            >
              {{ tab.count }}
            </span>
          </button>
        </div>

        <!-- Sections -->
        <div v-if="sections.length">
          <section v-for="section in sections" :key="section.key" class="mt-7 first:mt-5">
            <p
              class="eyebrow mb-1"
              :class="section.tone === 'rust' ? 'text-rust-600 dark:text-rust-500' : 'text-gray-400'"
            >
              {{ section.label }}
              <span class="text-gray-300 dark:text-gray-600"> {{ section.items.length }}</span>
            </p>

            <div>
              <div
                v-for="assignment in section.items"
                :key="assignment.id"
                class="group flex items-start gap-3 py-3 border-b border-dotted border-paper-line dark:border-gray-700/60"
              >
                <!-- Checkbox -->
                <button
                  type="button"
                  @click="toggleAssignmentComplete(assignment)"
                  class="mt-0.5 shrink-0 w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-colors"
                  :class="assignment.status === 'completed'
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 hover:border-primary-500 dark:hover:border-primary-400'"
                  :title="assignment.status === 'completed' ? 'Mark active again' : 'Mark complete'"
                >
                  <svg v-if="assignment.status === 'completed'" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>

                <!-- Title + meta -->
                <div class="flex-1 min-w-0">
                  <p
                    class="font-serif text-[15px] leading-snug"
                    :class="assignment.status === 'completed'
                      ? 'text-gray-400 dark:text-gray-600 line-through'
                      : 'text-gray-900 dark:text-gray-100'"
                  >
                    {{ assignment.title }}
                  </p>
                  <div class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span
                      v-if="assignmentCourseLabel(assignment)"
                      class="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-500 dark:text-gray-400"
                    >
                      <span class="w-1.5 h-1.5 rounded-full" :class="assignmentDot(assignment)" />
                      {{ assignmentCourseLabel(assignment) }}
                    </span>
                    <span
                      v-if="assignmentImportLabel(assignment)"
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide border"
                      :class="importBadgeClass(assignment)"
                    >
                      {{ assignmentImportLabel(assignment) }}
                    </span>
                    <span
                      v-if="isArchived(assignment)"
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide border bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-800/60"
                      title="Removed from your calendar feed — kept here for your records."
                    >
                      <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
                      </svg>
                      Removed from calendar
                    </span>
                  </div>
                </div>

                <!-- Hover actions + due date -->
                <div class="flex items-center gap-3 shrink-0 ml-auto pl-2">
                  <div class="flex items-center gap-1 transition-opacity opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                    <button
                      type="button"
                      @click.stop="openEditModal(assignment)"
                      class="eyebrow text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                      title="Edit assignment"
                    >
                      Edit →
                    </button>
                    <button
                      type="button"
                      @click.stop="promptDeleteAssignment(assignment)"
                      class="p-1 text-gray-300 hover:text-danger-500 dark:text-gray-600 dark:hover:text-danger-400 transition-colors"
                      title="Delete assignment"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <span
                    class="font-mono text-[12px] whitespace-nowrap text-right"
                    :class="isOverdue(assignment)
                      ? 'text-rust-600 dark:text-rust-500'
                      : assignment.status === 'completed' ? 'text-gray-400 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'"
                  >
                    <span v-if="isOverdue(assignment)">↑ </span>{{ shortDate(assignment.dueDate) }}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- Empty state -->
        <div v-else class="py-16 text-center">
          <p class="font-serif italic text-xl text-gray-500 dark:text-gray-400">{{ emptyCopy.title }}</p>
          <p class="mt-1.5 text-sm text-gray-400 dark:text-gray-500">{{ emptyCopy.sub }}</p>
          <button
            v-if="activeTab === 'all' && filterCourse === 'all'"
            type="button"
            @click="openAddModal"
            class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New assignment
          </button>
        </div>
      </div>

      <!-- ══ Right rail · Overview ═════════════════════════════════════════ -->
      <aside class="lg:border-l lg:border-paper-line dark:lg:border-gray-700/60 lg:pl-8 lg:sticky lg:top-16 self-start">
        <p class="eyebrow text-gray-400 dark:text-gray-500 mb-3">Overview</p>
        <div>
          <div
            v-for="row in overviewRows"
            :key="row.label"
            class="flex items-center justify-between py-2 border-b border-dotted border-paper-line dark:border-gray-700/60"
          >
            <span class="text-[13px] text-gray-500 dark:text-gray-400">{{ row.label }}</span>
            <span class="font-mono text-[15px] tabular-nums" :class="row.tone">{{ row.value }}</span>
          </div>
        </div>

        <!-- Filter by course -->
        <p class="eyebrow text-gray-400 dark:text-gray-500 mt-7 mb-2">Filter by course</p>
        <div class="space-y-0.5">
          <button
            type="button"
            @click="filterCourse = 'all'"
            class="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
            :class="filterCourse === 'all'
              ? 'bg-paper-line/50 dark:bg-gray-800/70'
              : 'hover:bg-paper-line/30 dark:hover:bg-gray-800/40'"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-gray-800 dark:bg-gray-200 shrink-0" />
            <span
              class="flex-1 min-w-0 truncate text-[13px]"
              :class="filterCourse === 'all' ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'"
            >All courses</span>
            <span class="font-mono text-[12px] text-gray-400 tabular-nums">{{ assignmentsStore.assignments.length }}</span>
          </button>

          <button
            v-for="course in courseFilters"
            :key="course.id"
            type="button"
            @click="filterCourse = course.id"
            class="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
            :class="filterCourse === course.id
              ? 'bg-paper-line/50 dark:bg-gray-800/70'
              : 'hover:bg-paper-line/30 dark:hover:bg-gray-800/40'"
          >
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="course.dot" />
            <span
              class="flex-1 min-w-0 truncate text-[13px]"
              :class="filterCourse === course.id ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'"
            >{{ course.name }}</span>
            <span class="font-mono text-[12px] text-gray-400 tabular-nums">{{ course.count }}</span>
          </button>
        </div>

        <!-- Overdue nudge -->
        <div
          v-if="counts.overdue"
          class="mt-6 rounded-2xl border border-dashed border-rust-500/35 bg-rust-50/70 dark:bg-rust-500/[0.06] p-4"
        >
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-rust-500" />
            <span class="eyebrow text-rust-600 dark:text-rust-500">{{ counts.overdue }} Overdue</span>
          </div>
          <p class="mt-2 font-serif text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-300">
            <template v-if="heaviestUpcoming">
              Catch up before <span class="font-medium text-rust-600 dark:text-rust-500">{{ shortDate(heaviestUpcoming.date) }}</span> hits  that's when your heaviest batch lands.
            </template>
            <template v-else>
              You have <span class="font-medium text-rust-600 dark:text-rust-500">{{ counts.overdue }}</span> past due. Let's clear them to get back on track.
            </template>
          </p>
        </div>
      </aside>
    </div>

    <!-- Add/Edit Assignment Modal -->
    <Modal v-model="showModal" :title="modalTitle" size="lg" @close="resetForm">
      <form id="assignment-form" @submit.prevent="saveAssignment" class="space-y-5">
        <Input
          v-model="formData.title"
          label="Assignment Title"
          placeholder="e.g., Research Essay on Climate Change"
          required
        />

        <div>
          <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">Description</label>
          <textarea
            v-model="formData.description"
            rows="4"
            placeholder="Add any details about the assignment..."
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-surface dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 transition-[border-color,box-shadow] duration-200 resize-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Dropdown v-model="formData.courseId" label="Course" :options="modalCourseOptions" />

          <div>
            <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Due Date <span class="text-danger-500">*</span>
            </label>
            <DatePicker v-model="formData.dueDate" placeholder="Pick a due date" />
          </div>
        </div>

        <p v-if="isEditing" class="text-sm text-gray-500">
          Use the checkbox on each row to mark an assignment complete or active again.
        </p>
      </form>

      <template #footer>
        <div class="flex gap-3 justify-end">
          <Button type="button" variant="secondary" @click="showModal = false; resetForm()">
            Cancel
          </Button>
          <Button
            type="submit"
            form="assignment-form"
            variant="primary"
            :disabled="!formData.title.trim() || !formData.dueDate"
          >
            {{ isEditing ? 'Save Changes' : 'Add Assignment' }}
          </Button>
        </div>
      </template>
    </Modal>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Assignment"
      :message="`Are you sure you want to delete '${assignmentToDelete?.title}'? This action cannot be undone.`"
      confirm-text="Delete"
      cancel-text="Cancel"
      variant="danger"
      @confirm="confirmDeleteAssignment"
    />
  </div>
</template>
