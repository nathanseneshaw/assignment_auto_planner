<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTasksStore } from '../../stores/tasks'
import { useCoursesStore } from '../../stores/courses'
import { useAssignmentsStore } from '../../stores/assignments'
import { Modal, Input, Dropdown, DatePicker, Button } from '../ui'
import TaskFormModal from './TaskFormModal.vue'
import { resolveAssignmentCourseName } from '../../utils/assignmentDisplay.js'

const tasksStore = useTasksStore()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()

// ── Date helpers (all local-timezone; never toISOString → avoids UTC drift) ──
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Sunday-start grid to match the mini-calendar on the Planner page.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// ── Live clock: keeps the "today" highlight honest across midnight ──────────
const now = ref(new Date())
let clockTimer = null
onMounted(() => { clockTimer = setInterval(() => { now.value = new Date() }, 30_000) })
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
  stopMonthFlip()
})

const todayKey = computed(() => localDateKey(now.value))

// ── The month being shown (defaults to the current month) ───────────────────
const monthAnchor = ref(startOfMonth(new Date()))
const monthLabel = computed(() =>
  `${MONTHS_LONG[monthAnchor.value.getMonth()]} ${monthAnchor.value.getFullYear()}`
)
const isCurrentMonth = computed(() => {
  const a = monthAnchor.value
  return a.getFullYear() === now.value.getFullYear() && a.getMonth() === now.value.getMonth()
})

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

  // Within a day, deadlines (assignments) lead, then incomplete first, then A–Z.
  for (const k of Object.keys(map)) {
    map[k].sort((x, y) => {
      if (x.completed !== y.completed) return x.completed ? 1 : -1
      if (x.kind !== y.kind) return x.kind === 'assignment' ? -1 : 1
      return x.title.localeCompare(y.title)
    })
  }

  return map
})

// ── 6×7 day grid for the anchored month ─────────────────────────────────────
const calendarCells = computed(() => {
  const y = monthAnchor.value.getFullYear()
  const m = monthAnchor.value.getMonth()
  const startPad = new Date(y, m, 1).getDay() // 0 = Sunday
  const gridStart = new Date(y, m, 1 - startPad)

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const key = localDateKey(d)
    const items = plannerItemsByDateKey.value[key] || []
    cells.push({
      date: d,
      dateKey: key,
      dayNumber: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: key === todayKey.value,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      items,
      doneCount: items.filter(i => i.completed).length,
    })
  }
  return cells
})

// ── Month summary (in-month scheduled items) ────────────────────────────────
const monthSummary = computed(() => {
  const inMonth = calendarCells.value.filter(c => c.inMonth)
  const total = inMonth.reduce((n, c) => n + c.items.length, 0)
  const done = inMonth.reduce((n, c) => n + c.doneCount, 0)
  return { total, done }
})

const isEmptyEverywhere = computed(
  () =>
    tasksStore.tasks.length === 0 &&
    assignmentsStore.assignments.length === 0
)

// ── Month navigation ────────────────────────────────────────────────────────
function prevMonth() {
  const d = new Date(monthAnchor.value)
  d.setMonth(d.getMonth() - 1)
  monthAnchor.value = startOfMonth(d)
}
function nextMonth() {
  const d = new Date(monthAnchor.value)
  d.setMonth(d.getMonth() + 1)
  monthAnchor.value = startOfMonth(d)
}
function goToThisMonth() {
  monthAnchor.value = startOfMonth(new Date())
}

// ── Drag and drop: move an item to a different day  across months too ──────
// `dragging` captures the underlying record (resolved at drag-start) rather than
// just the visible id, so a drop still lands correctly after the calendar has
// paged to another month and the source cell is no longer rendered.
const dragging = ref(null) // { id, kind, refId }
const dragOverKey = ref(null)

function onDragStart(event, item) {
  dragging.value = {
    id: item.id,
    kind: item.kind,
    refId: item.kind === 'assignment' ? item.assignmentId : item.id,
  }
  event.dataTransfer.effectAllowed = 'move'
  // Some browsers require data to be set for the drag to initiate.
  event.dataTransfer.setData('text/plain', item.id)
}
function clearDragState() {
  dragging.value = null
  dragOverKey.value = null
  stopMonthFlip()
}
function onDragEnd() {
  clearDragState()
}
function onDragOver(event, cell) {
  if (!dragging.value) return
  // Every visible day is a valid target, including the dimmed leading/trailing
  // days that belong to the previous / next month.
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dragOverKey.value = cell.dateKey
}
function onDragLeave(event, cell) {
  // Only clear when the pointer actually leaves the cell (not a child element).
  if (!event.currentTarget.contains(event.relatedTarget)) {
    if (dragOverKey.value === cell.dateKey) dragOverKey.value = null
  }
}
function onDrop(event, cell) {
  event.preventDefault()
  const d = dragging.value
  clearDragState()
  if (!d) return

  if (d.kind === 'assignment') {
    const a = assignmentsStore.getAssignmentById(d.refId)
    if (a && a.dueDate !== cell.dateKey) assignmentsStore.updateAssignment(d.refId, { dueDate: cell.dateKey })
  } else {
    const t = tasksStore.tasks.find(t => t.id === d.refId)
    if (t && t.scheduledDate !== cell.dateKey) tasksStore.rescheduleTask(d.refId, cell.dateKey)
  }
}

// While an item is being dragged, holding the pointer over the ‹ / › arrows
// pages the calendar so the item can be dropped on *any* day in another month.
// The dwell repeats, so you can keep paging by holding still.
let monthFlipTimer = null
function startMonthFlip(direction) {
  if (!dragging.value || monthFlipTimer) return
  monthFlipTimer = setInterval(() => {
    if (direction === 'prev') prevMonth()
    else nextMonth()
  }, 650)
}
function stopMonthFlip() {
  if (monthFlipTimer) {
    clearInterval(monthFlipTimer)
    monthFlipTimer = null
  }
}
function onNavDragEnter(direction) {
  if (dragging.value) startMonthFlip(direction)
}
function onNavDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) stopMonthFlip()
}

// ── Per-item display helpers ────────────────────────────────────────────────
function courseAccent(courseId) {
  const c = coursesStore.getCourseById(courseId)
  if (c?.color?.bg) return c.color.bg.replace('100', '500')
  return 'bg-gray-300 dark:bg-gray-600'
}
/** Full month name for a date  used to label dimmed adjacent-month items. */
function monthNameOf(d) {
  return MONTHS_LONG[d.getMonth()]
}
function itemMeta(item) {
  if (item.kind === 'assignment') {
    const a = item.assignmentId ? assignmentsStore.getAssignmentById(item.assignmentId) : null
    return resolveAssignmentCourseName(a, coursesStore.getCourseById) || item.courseName || 'Calendar feed'
  }
  return item.courseName || item.task?.assignmentTitle || 'Personal task'
}

// ── Item click / completion ─────────────────────────────────────────────────
function onItemClick(item) {
  if (item.kind === 'assignment' && item.assignmentId) {
    openEditModal(item.assignmentId)
    return
  }
  if (item.kind === 'task') openTaskEditModal(item.id)
}
function onCheckboxClick(item) {
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
function openAddTask(dateKey) {
  editingTask.value = null
  taskDefaultDate.value = dateKey || ''
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
  <div class="pb-12">
    <!-- ══ Header ════════════════════════════════════════════════════════ -->
    <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-7">
      <div>
        <div class="flex items-center gap-2.5">
          <span class="w-1.5 h-1.5 rounded-full" :class="isCurrentMonth ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'" />
          <p class="eyebrow text-gray-400 dark:text-gray-500">
            Month<template v-if="monthSummary.total"> · {{ monthSummary.done }}/{{ monthSummary.total }} done</template>
          </p>
        </div>
        <h1 class="display mt-2 text-4xl sm:text-5xl text-gray-900 dark:text-gray-50">{{ monthLabel }}</h1>
        <p class="mt-2 font-serif text-base text-gray-500 dark:text-gray-400">
          Everything due and scheduled this month  drag a card to another day to reschedule it, or hold it over the ‹&nbsp;› arrows to carry it into another month.
        </p>
      </div>

      <!-- Month navigation. While dragging, hovering a chevron pages the month
           so an item can be carried into the previous / next month. -->
      <div class="flex items-center gap-1 shrink-0">
        <button
          type="button"
          @click="prevMonth"
          @dragenter="onNavDragEnter('prev')"
          @dragover.prevent
          @dragleave="onNavDragLeave($event)"
          @drop.prevent="clearDragState"
          class="w-9 h-9 inline-flex items-center justify-center rounded-lg border text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/70 dark:hover:bg-gray-800/70 transition-colors"
          :class="dragging ? 'border-primary-400/70 ring-2 ring-inset ring-primary-400/60 text-primary-700 dark:text-primary-400 bg-primary-50/60 dark:bg-primary-900/20' : 'border-paper-line dark:border-gray-700'"
          :aria-label="dragging ? 'Hold here to move to the previous month' : 'Previous month'"
          title="Previous month  hold a dragged card here to carry it back a month"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button
          type="button"
          @click="nextMonth"
          @dragenter="onNavDragEnter('next')"
          @dragover.prevent
          @dragleave="onNavDragLeave($event)"
          @drop.prevent="clearDragState"
          class="w-9 h-9 inline-flex items-center justify-center rounded-lg border text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/70 dark:hover:bg-gray-800/70 transition-colors"
          :class="dragging ? 'border-primary-400/70 ring-2 ring-inset ring-primary-400/60 text-primary-700 dark:text-primary-400 bg-primary-50/60 dark:bg-primary-900/20' : 'border-paper-line dark:border-gray-700'"
          :aria-label="dragging ? 'Hold here to move to the next month' : 'Next month'"
          title="Next month  hold a dragged card here to carry it forward a month"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <button
          v-if="!isCurrentMonth"
          type="button"
          @click="goToThisMonth"
          class="ml-1 px-3 h-9 inline-flex items-center rounded-lg border border-paper-line dark:border-gray-700 eyebrow text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-surface/70 dark:hover:bg-gray-800/70 transition-colors"
        >
          This month
        </button>
      </div>
    </header>

    <!-- ══ Month grid ════════════════════════════════════════════════════ -->
    <div class="overflow-x-auto">
      <div class="min-w-[720px]">
        <!-- Weekday header -->
        <div class="grid grid-cols-7 mb-1.5">
          <span
            v-for="label in WEEKDAY_LABELS"
            :key="label"
            class="text-center eyebrow text-gray-400 dark:text-gray-500 py-1"
          >{{ label }}</span>
        </div>

        <!-- Cells -->
        <div class="grid grid-cols-7 rounded-2xl border border-paper-line dark:border-gray-700/60 overflow-hidden bg-surface/40 dark:bg-gray-800/20">
          <div
            v-for="cell in calendarCells"
            :key="cell.dateKey"
            class="group/cell relative min-h-[118px] border-b border-r border-paper-line dark:border-gray-700/50 p-1.5 flex flex-col gap-1 transition-colors"
            :class="[
              !cell.inMonth ? 'bg-paper/50 dark:bg-gray-900/40' : '',
              cell.inMonth && cell.isToday && dragOverKey !== cell.dateKey ? 'bg-primary-50/50 dark:bg-primary-900/15' : '',
              cell.inMonth && cell.isWeekend && !cell.isToday && dragOverKey !== cell.dateKey ? 'bg-surface/20 dark:bg-gray-800/10' : '',
              dragOverKey === cell.dateKey ? 'bg-primary-50 dark:bg-primary-900/30 ring-2 ring-inset ring-primary-400/70 dark:ring-primary-500/60' : '',
            ]"
            @dragover="onDragOver($event, cell)"
            @dragleave="onDragLeave($event, cell)"
            @drop="onDrop($event, cell)"
          >
            <!-- Day number + per-day controls -->
            <div class="flex items-center justify-between gap-1 shrink-0 px-0.5">
              <span
                v-if="cell.isToday"
                class="w-6 h-6 inline-flex items-center justify-center rounded-full bg-primary-900 text-white text-[12px] font-semibold tabular-nums"
              >{{ cell.dayNumber }}</span>
              <span
                v-else
                class="text-[13px] tabular-nums px-1"
                :class="cell.inMonth ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'"
              >{{ cell.dayNumber }}</span>

              <button
                v-if="cell.inMonth"
                type="button"
                @click="openAddTask(cell.dateKey)"
                class="w-5 h-5 inline-flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-paper-line/60 dark:hover:bg-gray-700/60 opacity-0 group-hover/cell:opacity-100 focus:opacity-100 transition-opacity"
                :aria-label="`Add task on ${WEEKDAYS_LONG[cell.date.getDay()]} ${cell.dayNumber}`"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>

            <!-- Events -->
            <div class="flex-1 flex flex-col gap-1 min-h-0 overflow-y-auto max-h-[180px] pr-0.5">
              <div
                v-for="item in cell.items"
                :key="item.id"
                draggable="true"
                @dragstart="onDragStart($event, item)"
                @dragend="onDragEnd"
                @click="onItemClick(item)"
                class="group/item relative flex items-center gap-1.5 rounded-md border border-paper-line dark:border-gray-700/60 bg-surface dark:bg-gray-800/70 hover:shadow-sm hover:shadow-gray-900/5 pl-2 pr-1 py-1 cursor-default select-none transition-all overflow-hidden"
                :class="dragging?.id === item.id
                  ? 'opacity-40 ring-1 ring-gray-400 dark:ring-gray-500'
                  : !cell.inMonth
                    ? (item.completed ? 'opacity-30' : 'opacity-45')
                    : (item.completed ? 'opacity-55' : '')"
                :title="`${item.title}  ${itemMeta(item)}${cell.inMonth ? '' : ' · ' + monthNameOf(cell.date)}`"
              >
                <!-- Course accent -->
                <span class="absolute left-0 top-0 bottom-0 w-[3px]" :class="courseAccent(item.courseId)" />

                <!-- Completion checkbox -->
                <button
                  type="button"
                  @click.stop="onCheckboxClick(item)"
                  class="shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all"
                  :class="item.completed
                    ? 'bg-primary-600 border-primary-600'
                    : 'border-gray-300 dark:border-gray-600 group-hover/item:border-primary-500'"
                  :aria-label="item.completed ? 'Mark incomplete' : 'Mark complete'"
                >
                  <svg v-if="item.completed" class="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7" /></svg>
                </button>

                <!-- Title -->
                <span
                  class="flex-1 min-w-0 truncate text-[11px] font-medium leading-tight"
                  :class="item.completed ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-800 dark:text-gray-200'"
                >{{ item.title }}</span>

                <!-- Deadline marker -->
                <span
                  v-if="item.kind === 'assignment' && !item.completed"
                  class="shrink-0 w-1 h-1 rounded-full bg-rust-500"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Legend + scroll hint -->
    <div class="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div v-if="coursesStore.courses.length" class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span class="eyebrow text-gray-400 dark:text-gray-500">Courses</span>
        <span
          v-for="course in coursesStore.coursesSorted"
          :key="course.id"
          class="inline-flex items-center gap-1.5"
        >
          <span class="w-2 h-2 rounded-full" :class="courseAccent(course.id)" />
          <span class="text-[12px] text-gray-500 dark:text-gray-400">{{ course.code || course.name }}</span>
        </span>
      </div>
      <p class="eyebrow text-gray-400 dark:text-gray-500 sm:hidden">Scroll sideways to see the full week</p>
    </div>

    <!-- Empty hint (no data anywhere) -->
    <div
      v-if="isEmptyEverywhere"
      class="mt-6 rounded-2xl border border-dashed border-paper-line dark:border-gray-700/60 bg-surface/40 dark:bg-gray-800/30 px-6 py-10 text-center"
    >
      <p class="font-serif italic text-lg text-gray-500 dark:text-gray-400">Nothing on the calendar yet.</p>
      <p class="mt-1.5 text-sm text-gray-400 dark:text-gray-500">
        Add a task to any day, or sync a calendar feed to bring in your assignments.
      </p>
      <button
        type="button"
        @click="openAddTask(todayKey)"
        class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
        Add a task
      </button>
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
      <form id="calendar-edit-form" @submit.prevent="saveEditedAssignment" class="space-y-5">
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
            form="calendar-edit-form"
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
