<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTasksStore } from '../stores/tasks'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { Modal, Input, Dropdown, DatePicker, Button } from '../components/ui'
import TaskFormModal from '../components/features/TaskFormModal.vue'
import { resolveAssignmentCourseName } from '../utils/assignmentDisplay.js'

const router = useRouter()
const tasksStore = useTasksStore()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()

// ── Date helpers (all local-timezone; never toISOString → avoids UTC drift) ──
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MINI_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseDateLocal(dateString) {
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function dayDiff(a, b) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000)
}
function shortDate(dateString) {
  const d = parseDateLocal(dateString)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

// ── Live clock: keeps "today" / relative-day labels honest across midnight ──
const now = ref(new Date())
let clockTimer = null
onMounted(() => { clockTimer = setInterval(() => { now.value = new Date() }, 30_000) })
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer) })

// ── Selected day + mini-calendar month (both default to today) ──────────────
const selectedDate = ref(startOfDay(new Date()))
const calendarAnchor = ref(startOfMonth(new Date()))

const todayKey = computed(() => localDateKey(now.value))
const selectedKey = computed(() => localDateKey(selectedDate.value))
const isToday = computed(() => selectedKey.value === todayKey.value)

/** @typedef {{ kind: 'task' | 'assignment', id: string, title: string, courseId: string, courseName: string, completed: boolean, task?: object, assignmentId?: string }} PlannerItem */

/** Tasks (by scheduled date) + assignments (by due date) grouped by day key. */
const plannerItemsByDateKey = computed(() => {
  /** @type {Record<string, PlannerItem[]>} */
  const map = {}
  const add = (/** @type {string | undefined} */ dateKey, /** @type {PlannerItem} */ item) => {
    if (!dateKey) return
    if (!map[dateKey]) map[dateKey] = []
    map[dateKey].push(item)
  }

  for (const t of tasksStore.tasks) {
    add(t.scheduledDate, {
      kind: 'task',
      id: t.id,
      title: t.title,
      courseId: t.courseId,
      courseName: t.courseName || '',
      completed: t.completed,
      task: t,
    })
  }

  for (const a of assignmentsStore.assignments) {
    add(a.dueDate, {
      kind: 'assignment',
      id: `assignment-${a.id}`,
      title: a.title,
      courseId: a.courseId,
      courseName: a.courseName || '',
      completed: a.status === 'completed',
      assignmentId: a.id,
    })
  }

  return map
})

// Everything to do on the selected day: incomplete first, deadlines (assignments)
// ahead of work blocks (tasks), then alphabetical.
const dayItems = computed(() => {
  const items = [...(plannerItemsByDateKey.value[selectedKey.value] || [])]
  items.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    if (a.kind !== b.kind) return a.kind === 'assignment' ? -1 : 1
    return a.title.localeCompare(b.title)
  })
  return items
})

const dueCount = computed(() => dayItems.value.length)
const remainingCount = computed(() => dayItems.value.filter(i => !i.completed).length)

const overdueCount = computed(() => assignmentsStore.overdueAssignments.length)
const overdueNoun = computed(() => `assignment${overdueCount.value === 1 ? '' : 's'}`)
const nextDeadline = computed(() => assignmentsStore.upcomingAssignments[0] || null)
const comingUp = computed(() => assignmentsStore.upcomingAssignments.slice(0, 5))

// ── Hero copy ───────────────────────────────────────────────────────────────
const heading = computed(() => {
  const d = selectedDate.value
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`
})

const relativeDayLabel = computed(() => {
  const diff = dayDiff(selectedDate.value, now.value)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1) return `In ${diff} days`
  return `${Math.abs(diff)} days ago`
})

const dayDotClass = computed(() => {
  const diff = dayDiff(selectedDate.value, now.value)
  if (diff === 0) return 'bg-primary-500'
  if (diff < 0) return 'bg-rust-400'
  return 'bg-gray-300 dark:bg-gray-600'
})

const dayMood = computed(() => {
  const n = dueCount.value
  if (n === 0) return 'A clear day.'
  if (n <= 2) return 'A light day.'
  if (n <= 4) return 'A steady day.'
  return 'A full day.'
})

// ── Mini calendar ─────────────────────────────────────────────────────────
const calMonthYear = computed(() =>
  `${MONTHS_LONG[calendarAnchor.value.getMonth()]} ${calendarAnchor.value.getFullYear()}`
)

const calendarCells = computed(() => {
  const y = calendarAnchor.value.getFullYear()
  const m = calendarAnchor.value.getMonth()
  const first = new Date(y, m, 1)
  const startPad = first.getDay() // 0 = Sunday → week starts Sunday, matching the mockup
  const gridStart = new Date(y, m, 1 - startPad)

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const key = localDateKey(d)
    const inMonth = d.getMonth() === m
    cells.push({
      date: d,
      dateKey: key,
      dayNumber: d.getDate(),
      inMonth,
      isToday: key === todayKey.value,
      isSelected: key === selectedKey.value,
      hasItems: inMonth && (plannerItemsByDateKey.value[key]?.length || 0) > 0,
    })
  }
  return cells
})

function cellClasses(cell) {
  if (!cell.inMonth) return 'text-gray-300 dark:text-gray-600 hover:bg-paper-line/40 dark:hover:bg-gray-700/30'
  if (cell.isToday) return 'bg-primary-900 text-white font-semibold'
  if (cell.isSelected) return 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300 ring-1 ring-inset ring-primary-500/50 font-semibold'
  return 'text-gray-700 dark:text-gray-300 hover:bg-paper-line/60 dark:hover:bg-gray-700/50'
}
function dotClass(cell) {
  if (cell.isToday) return 'bg-primary-300'
  if (cell.isSelected) return 'bg-primary-600 dark:bg-primary-400'
  return 'bg-primary-500/70 dark:bg-primary-400/60'
}

// ── Day navigation ──────────────────────────────────────────────────────────
function selectDate(date) {
  selectedDate.value = startOfDay(date)
  calendarAnchor.value = startOfMonth(date)
}
function prevDay() { selectDate(addDays(selectedDate.value, -1)) }
function nextDay() { selectDate(addDays(selectedDate.value, 1)) }
function goToToday() { selectDate(new Date()) }
function prevMonth() {
  const d = new Date(calendarAnchor.value)
  d.setMonth(d.getMonth() - 1)
  calendarAnchor.value = startOfMonth(d)
}
function nextMonth() {
  const d = new Date(calendarAnchor.value)
  d.setMonth(d.getMonth() + 1)
  calendarAnchor.value = startOfMonth(d)
}

// ── Per-item display helpers ────────────────────────────────────────────────
function courseAccent(courseId) {
  const c = coursesStore.getCourseById(courseId)
  if (c?.color?.bg) return c.color.bg.replace('100', '500')
  return 'bg-gray-300 dark:bg-gray-600'
}
function itemMeta(item) {
  if (item.kind === 'assignment') {
    const a = item.assignmentId ? assignmentsStore.getAssignmentById(item.assignmentId) : null
    return resolveAssignmentCourseName(a, coursesStore.getCourseById) || item.courseName || 'Calendar feed'
  }
  return item.courseName || item.task?.assignmentTitle || 'Personal task'
}
function itemBadge(item) {
  if (item.kind === 'assignment') return 'Due'
  const lvl = item.task?.priorityLevel
  if (lvl === 'urgent') return 'Urgent'
  if (lvl === 'high') return 'High'
  return 'Task'
}
function badgeClass(item) {
  if (item.kind === 'assignment') return 'text-rust-500'
  const lvl = item.task?.priorityLevel
  if (lvl === 'urgent') return 'text-rust-500'
  if (lvl === 'high') return 'text-warning-600 dark:text-warning-500'
  return 'text-gray-300 dark:text-gray-600'
}

// ── Coming-up rail helpers ──────────────────────────────────────────────────
function monthAbbr(dateKey) { return MONTHS_SHORT[parseDateLocal(dateKey).getMonth()] }
function dayNum(dateKey) { return parseDateLocal(dateKey).getDate() }
function weekdayName(dateKey) { return WEEKDAYS_LONG[parseDateLocal(dateKey).getDay()] }
function railCourseName(a) {
  return resolveAssignmentCourseName(a, coursesStore.getCourseById) || 'Calendar feed'
}
function relativeDue(dateKey) {
  const diff = dayDiff(parseDateLocal(dateKey), now.value)
  if (diff === 0) return 'due today'
  if (diff === 1) return 'in 1 day'
  if (diff === -1) return '1 day ago'
  if (diff > 1) return `in ${diff} days`
  return `${Math.abs(diff)} days ago`
}
function goToAssignmentDay(a) {
  selectDate(parseDateLocal(a.dueDate))
}

// ── Item click / completion ─────────────────────────────────────────────────
function onPlannerItemClick(item) {
  if (item.kind === 'assignment' && item.assignmentId) {
    openEditModal(item.assignmentId)
    return
  }
  if (item.kind === 'task') openTaskEditModal(item.id)
}
function onPlannerCheckboxClick(item) {
  if (item.kind === 'task') {
    tasksStore.toggleTaskComplete(item.id)
    return
  }
  if (item.assignmentId) {
    if (item.completed) assignmentsStore.markAssignmentIncomplete(item.assignmentId)
    else assignmentsStore.markAssignmentComplete(item.assignmentId)
  }
}

// ── Task add / edit modal ───────────────────────────────────────────────────
const showTaskModal = ref(false)
const editingTask = ref(null)
const taskDefaultDate = ref('')

function openTaskEditModal(taskId) {
  const t = tasksStore.tasks.find(t => t.id === taskId)
  if (!t) return
  editingTask.value = t
  taskDefaultDate.value = ''
  showTaskModal.value = true
}
function openAddTask() {
  editingTask.value = null
  taskDefaultDate.value = selectedKey.value
  showTaskModal.value = true
}
function onTaskSave(data) {
  const assignment = data.assignmentId
    ? assignmentsStore.getAssignmentById(data.assignmentId)
    : null
  const payload = {
    title: data.title,
    scheduledDate: data.scheduledDate,
    priorityLevel: data.priorityLevel,
    priority: data.priority,
    assignmentId: data.assignmentId || null,
    assignmentTitle: assignment?.title || null,
    courseId: data.courseId || null,
    courseName: data.courseName || null,
  }
  if (editingTask.value) tasksStore.updateTask(editingTask.value.id, payload)
  else tasksStore.addTask(payload)
}

// ── Assignment edit modal ───────────────────────────────────────────────────
const showEditModal = ref(false)
const editingAssignmentId = ref(null)
const editFormData = ref({ title: '', description: '', courseId: '', dueDate: '' })

const modalCourseOptions = computed(() => [
  { value: '', label: 'Select a course' },
  ...coursesStore.courses.map(c => ({ value: c.id, label: c.name })),
])

function openEditModal(assignmentId) {
  const a = assignmentsStore.getAssignmentById(assignmentId)
  if (!a) return
  editingAssignmentId.value = assignmentId
  editFormData.value = {
    title: a.title,
    description: a.description || '',
    courseId: a.courseId || '',
    dueDate: a.dueDate,
  }
  showEditModal.value = true
}
function saveEditedAssignment() {
  if (!editFormData.value.title.trim() || !editFormData.value.dueDate) return
  const course = coursesStore.getCourseById(editFormData.value.courseId)
  assignmentsStore.updateAssignment(editingAssignmentId.value, {
    title: editFormData.value.title.trim(),
    description: editFormData.value.description.trim(),
    courseId: editFormData.value.courseId,
    courseName: course?.name || 'No Course',
    dueDate: editFormData.value.dueDate,
  })
  showEditModal.value = false
}
</script>

<template>
  <div>
    <!-- Single root ELEMENT required by <Transition mode="out-in"> in App.vue.
         This comment MUST stay inside the root <div>, never beside it — a stray
         comment (or any second node) at the template root makes this a fragment
         component, which stalls the leave transition so the next page never
         mounts (symptom: navigate away from Planner → blank page). Keep the
         modals inside this wrapper too. -->
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-10 gap-y-10 pt-1 pb-12">

      <!-- ══ Center column · the day ════════════════════════════════════════ -->
      <div class="min-w-0 space-y-9">

        <!-- Hero -->
        <header>
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-2.5">
              <span class="w-1.5 h-1.5 rounded-full" :class="dayDotClass" />
              <p class="eyebrow text-gray-400 dark:text-gray-500">{{ relativeDayLabel }}</p>
            </div>

            <!-- Day navigation -->
            <div class="flex items-center gap-1">
              <button
                type="button"
                @click="prevDay"
                class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-paper-line dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/70 dark:hover:bg-gray-800/70 transition-colors"
                aria-label="Previous day"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button
                type="button"
                @click="nextDay"
                class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-paper-line dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/70 dark:hover:bg-gray-800/70 transition-colors"
                aria-label="Next day"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
              <button
                v-if="!isToday"
                type="button"
                @click="goToToday"
                class="ml-1 px-2.5 h-8 inline-flex items-center rounded-lg border border-paper-line dark:border-gray-700 eyebrow text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/70 dark:hover:bg-gray-800/70 transition-colors"
              >
                Today
              </button>
            </div>
          </div>

          <h1 class="display mt-2 text-4xl sm:text-5xl lg:text-6xl text-gray-900 dark:text-gray-50">
            {{ heading }}
          </h1>

          <p class="mt-4 max-w-2xl font-serif text-lg sm:text-xl leading-relaxed text-gray-600 dark:text-gray-300">
            {{ dayMood }}
            <template v-if="dueCount === 0">
              Nothing’s due{{ isToday ? ' today' : ' this day' }}<template v-if="isToday && overdueCount"> —
                <span class="italic text-rust-600 dark:text-rust-500">{{ overdueCount }} overdue {{ overdueNoun }}</span>
                {{ overdueCount === 1 ? 'is' : 'are' }} waiting to be cleared.</template><template v-else>.</template>
            </template>
            <template v-else-if="remainingCount === 0">
              All {{ dueCount }} {{ dueCount === 1 ? 'item' : 'items' }} done{{ isToday ? ' for today' : '' }} — nicely cleared.
            </template>
            <template v-else>
              {{ remainingCount }} {{ remainingCount === 1 ? 'thing' : 'things' }} to work
              through{{ isToday ? ' today' : '' }}<template v-if="isToday && overdueCount">, and
                <span class="italic text-rust-600 dark:text-rust-500">{{ overdueCount }} overdue {{ overdueNoun }}</span>
                {{ overdueCount === 1 ? 'is' : 'are' }} waiting.</template><template v-else>.</template>
            </template>
          </p>
        </header>

        <!-- To-do list for the day -->
        <section>
          <div class="flex items-baseline justify-between border-b border-paper-line dark:border-gray-700/60 pb-2.5">
            <p class="eyebrow text-gray-400 dark:text-gray-500">To do · {{ dueCount }} {{ dueCount === 1 ? 'item' : 'items' }}</p>
            <button
              type="button"
              @click="openAddTask"
              class="eyebrow text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              + Add
            </button>
          </div>

          <div v-if="dayItems.length" class="mt-4 space-y-2.5">
            <div
              v-for="item in dayItems"
              :key="item.id"
              class="group relative flex items-start gap-3 rounded-xl border border-paper-line dark:border-gray-700/60 bg-surface/60 dark:bg-gray-800/40 hover:bg-surface dark:hover:bg-gray-800 hover:shadow-sm hover:shadow-gray-900/5 transition-all cursor-pointer pl-4 pr-3.5 py-3 overflow-hidden"
              :class="item.completed ? 'opacity-60' : ''"
              @click="onPlannerItemClick(item)"
            >
              <!-- Course accent -->
              <span class="absolute left-0 top-0 bottom-0 w-[3px]" :class="courseAccent(item.courseId)" />

              <!-- Completion checkbox -->
              <button
                type="button"
                class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
                :class="item.completed
                  ? 'bg-primary-600 border-primary-600'
                  : 'border-gray-300 dark:border-gray-600 group-hover:border-primary-500'"
                @click.stop="onPlannerCheckboxClick(item)"
                :aria-label="item.completed ? 'Mark incomplete' : 'Mark complete'"
              >
                <svg v-if="item.completed" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7" />
                </svg>
              </button>

              <!-- Body -->
              <div class="flex-1 min-w-0">
                <p
                  class="text-[15px] font-medium leading-snug truncate"
                  :class="item.completed ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-900 dark:text-gray-100'"
                >
                  {{ item.title }}
                </p>
                <p class="mt-0.5 font-mono text-[11px] text-gray-400 dark:text-gray-500 truncate">
                  {{ itemMeta(item) }}
                </p>
              </div>

              <!-- Type / priority badge -->
              <span class="flex-shrink-0 mt-0.5 eyebrow" :class="badgeClass(item)">
                {{ itemBadge(item) }}
              </span>
            </div>
          </div>

          <!-- Empty day -->
          <div
            v-else
            class="mt-5 rounded-2xl border border-dashed border-paper-line dark:border-gray-700/60 bg-surface/40 dark:bg-gray-800/30 px-6 py-10 text-center"
          >
            <p class="font-serif italic text-lg text-gray-500 dark:text-gray-400">
              {{ isToday ? 'Your slate is clear for today.' : 'Nothing planned for this day.' }}
            </p>
            <p class="mt-1.5 text-sm text-gray-400 dark:text-gray-500">
              Add a task, or pick another day on the calendar.
            </p>
            <button
              type="button"
              @click="openAddTask"
              class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add a task
            </button>
          </div>
        </section>
      </div>

      <!-- ══ Right rail ══════════════════════════════════════════════════════ -->
      <aside class="lg:border-l lg:border-paper-line dark:lg:border-gray-700/60 lg:pl-8 space-y-8 lg:sticky lg:top-16 self-start">

        <!-- Mini calendar -->
        <div>
          <p class="eyebrow text-gray-400 dark:text-gray-500 mb-3">{{ calMonthYear }}</p>

          <div class="flex items-center justify-between mb-2">
            <span class="font-serif text-base text-gray-900 dark:text-gray-100">{{ calMonthYear }}</span>
            <div class="flex items-center gap-1">
              <button
                type="button"
                @click="prevMonth"
                class="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-paper-line/60 dark:hover:bg-gray-700/50 transition-colors"
                aria-label="Previous month"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button
                type="button"
                @click="nextMonth"
                class="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-paper-line/60 dark:hover:bg-gray-700/50 transition-colors"
                aria-label="Next month"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-7 mb-1">
            <span
              v-for="(d, i) in MINI_WEEKDAYS"
              :key="`wd-${i}`"
              class="text-center font-mono text-[10px] text-gray-400 dark:text-gray-500 py-1"
            >{{ d }}</span>
          </div>

          <div class="grid grid-cols-7 gap-y-0.5">
            <button
              v-for="cell in calendarCells"
              :key="cell.dateKey"
              type="button"
              @click="selectDate(cell.date)"
              class="relative h-9 flex items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors"
              :class="cellClasses(cell)"
            >
              {{ cell.dayNumber }}
              <span
                v-if="cell.hasItems"
                class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                :class="dotClass(cell)"
              />
            </button>
          </div>
        </div>

        <!-- Coming up -->
        <div>
          <p class="eyebrow text-gray-400 dark:text-gray-500 mb-3">Coming up</p>

          <div v-if="comingUp.length">
            <button
              v-for="a in comingUp"
              :key="a.id"
              type="button"
              @click="goToAssignmentDay(a)"
              class="group flex items-start gap-3.5 w-full text-left py-2.5 border-b border-dotted border-paper-line dark:border-gray-700/60 last:border-0"
            >
              <div class="flex flex-col items-center justify-center w-9 shrink-0 pt-0.5">
                <span class="font-mono text-[10px] uppercase tracking-wide text-gray-400 leading-none">{{ monthAbbr(a.dueDate) }}</span>
                <span class="font-serif text-lg leading-none mt-1 text-gray-900 dark:text-gray-100">{{ dayNum(a.dueDate) }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[13px] font-medium leading-snug text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors">
                  {{ a.title }}
                </p>
                <p class="mt-1 font-mono text-[10.5px] text-gray-400 truncate">{{ railCourseName(a) }} · {{ relativeDue(a.dueDate) }}</p>
              </div>
            </button>
          </div>
          <p v-else class="text-[13px] text-gray-400 dark:text-gray-500 py-2">Nothing on the horizon yet.</p>
        </div>

        <!-- Overdue alert -->
        <div
          v-if="overdueCount"
          class="rounded-2xl border border-dashed border-rust-500/35 bg-rust-50/70 dark:bg-rust-500/[0.06] p-4"
        >
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-rust-500" />
            <span class="eyebrow text-rust-600">{{ overdueCount }} Overdue</span>
          </div>
          <p class="mt-2 font-serif text-[13.5px] leading-relaxed text-gray-600 dark:text-gray-300">
            Clear {{ overdueCount === 1 ? 'it' : 'these' }} before
            <template v-if="nextDeadline">{{ weekdayName(nextDeadline.dueDate) }} — {{ shortDate(nextDeadline.dueDate) }} brings your next deadline.</template><template v-else>the week gets heavier.</template>
          </p>
          <button
            type="button"
            @click="router.push('/assignments')"
            class="mt-2.5 inline-flex items-center text-[12.5px] font-medium text-rust-600 hover:text-rust-500 underline underline-offset-2 decoration-rust-500/40 transition-colors"
          >
            View all overdue →
          </button>
        </div>
      </aside>

    </div>

    <!-- Edit / Add Task Modal -->
    <TaskFormModal
      v-model="showTaskModal"
      :task="editingTask"
      :default-date="taskDefaultDate"
      @save="onTaskSave"
    />

    <!-- Edit Assignment Modal -->
    <Modal v-model="showEditModal" title="Edit Assignment" size="lg">
      <form id="planner-edit-form" @submit.prevent="saveEditedAssignment" class="space-y-5">
        <Input
          v-model="editFormData.title"
          label="Assignment Title"
          placeholder="e.g., Research Essay on Climate Change"
          required
        />

        <div>
          <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">Description</label>
          <textarea
            v-model="editFormData.description"
            rows="4"
            placeholder="Add any details about the assignment..."
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-surface dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 focus-visible:border-primary-300/80 transition-[border-color,box-shadow] duration-200 resize-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Dropdown v-model="editFormData.courseId" label="Course" :options="modalCourseOptions" />

          <div>
            <label class="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Due Date <span class="text-danger-500">*</span>
            </label>
            <DatePicker v-model="editFormData.dueDate" placeholder="Pick a due date" />
          </div>
        </div>

        <p class="text-sm text-gray-500">
          Use the checkbox on each card to mark the assignment complete or active.
        </p>
      </form>

      <template #footer>
        <div class="flex gap-3 justify-end">
          <Button type="button" variant="secondary" @click="showEditModal = false">Cancel</Button>
          <Button
            type="submit"
            form="planner-edit-form"
            variant="primary"
            :disabled="!editFormData.title.trim() || !editFormData.dueDate"
          >
            Save Changes
          </Button>
        </div>
      </template>
    </Modal>
  </div>
</template>
