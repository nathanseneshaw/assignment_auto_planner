<script setup>
import { ref, computed } from 'vue'
import { useTasksStore } from '../stores/tasks'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { Card, EmptyState, Modal, Input, Dropdown, Button } from '../components/ui'
import TaskFormModal from '../components/features/TaskFormModal.vue'

const tasksStore = useTasksStore()
const coursesStore = useCoursesStore()
const assignmentsStore = useAssignmentsStore()

/** @typedef {{ kind: 'task' | 'assignment', id: string, title: string, courseId: string, courseName: string, completed: boolean, task?: object, assignmentId?: string }} PlannerItem */

/**
 * Tasks + assignments (by due date) for calendar cells. Assignments come from Supabase hydration / sync.
 */
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

  for (const k of Object.keys(map)) {
    map[k].sort((x, y) => {
      if (x.kind !== y.kind) return x.kind === 'task' ? -1 : 1
      return x.title.localeCompare(y.title)
    })
  }

  return map
})

// Assignment edit modal
const showEditModal = ref(false)
const editingAssignmentId = ref(null)
const editFormData = ref({ title: '', description: '', courseId: '', dueDate: '' })

// Task edit modal
const showTaskEditModal = ref(false)
const editingTask = ref(null)

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

function openTaskEditModal(taskId) {
  const t = tasksStore.tasks.find(t => t.id === taskId)
  if (!t) return
  editingTask.value = t
  showTaskEditModal.value = true
}

function saveEditedTask(data) {
  if (!editingTask.value) return
  const assignment = data.assignmentId
    ? assignmentsStore.getAssignmentById(data.assignmentId)
    : null
  tasksStore.updateTask(editingTask.value.id, {
    title: data.title,
    scheduledDate: data.scheduledDate,
    priorityLevel: data.priorityLevel,
    priority: data.priority,
    assignmentId: data.assignmentId || null,
    assignmentTitle: assignment?.title || null,
    courseId: data.courseId || null,
    courseName: data.courseName || null,
  })
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

function onPlannerItemClick(item) {
  if (item.kind === 'assignment' && item.assignmentId) {
    openEditModal(item.assignmentId)
    return
  }
  if (item.kind === 'task') {
    openTaskEditModal(item.id)
  }
}

function onPlannerCheckboxClick(item) {
  if (item.kind === 'task') {
    tasksStore.toggleTaskComplete(item.id)
    return
  }
  if (item.assignmentId) {
    if (item.completed) {
      assignmentsStore.markAssignmentIncomplete(item.assignmentId)
    } else {
      assignmentsStore.markAssignmentComplete(item.assignmentId)
    }
  }
}

const showPlannerEmptyState = computed(
  () =>
    coursesStore.courses.length === 0 &&
    assignmentsStore.assignments.length === 0 &&
    tasksStore.tasks.length === 0
)

const viewMode = ref('week')
const currentWeekStart = ref(getWeekStart(new Date()))

// Drag-and-drop state for month grid
const draggingItem = ref(null)
const dragOverDateKey = ref(null)

function onDragStart(event, item) {
  draggingItem.value = item
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', item.id)
}

function onDragEnd() {
  draggingItem.value = null
  dragOverDateKey.value = null
}

function onDragOverCell(event, day) {
  if (!draggingItem.value || day.inMonth === false) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dragOverDateKey.value = day.dateKey
}

function onDragLeaveCell(event, day) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    if (dragOverDateKey.value === day.dateKey) dragOverDateKey.value = null
  }
}

function onDropCell(event, day) {
  event.preventDefault()
  const item = draggingItem.value
  if (!item || day.inMonth === false) return
  const newDateKey = day.dateKey
  if (item.kind === 'task') {
    tasksStore.rescheduleTask(item.id, newDateKey)
  } else if (item.kind === 'assignment' && item.assignmentId) {
    assignmentsStore.updateAssignment(item.assignmentId, { dueDate: newDateKey })
  }
  draggingItem.value = null
  dragOverDateKey.value = null
}

function startOfMonthFromDate(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

const currentMonthAnchor = ref(startOfMonthFromDate(new Date()))

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekStart(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.setDate(diff))
}

function formatDateKeyLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const weekDays = computed(() => {
  const days = []
  const start = new Date(currentWeekStart.value)

  for (let i = 0; i < 7; i++) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const dateKey = formatDateKeyLocal(date)
    const dayItems = plannerItemsByDateKey.value[dateKey] || []

    days.push({
      date,
      dateKey,
      dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNumber: date.getDate(),
      monthName: date.toLocaleDateString('en-US', { month: 'short' }),
      isToday: dateKey === formatDateKeyLocal(new Date()),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      items: dayItems,
      completedItems: dayItems.filter(t => t.completed).length
    })
  }

  return days
})

const weekRange = computed(() => {
  const start = currentWeekStart.value
  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  const startMonth = start.toLocaleDateString('en-US', { month: 'short' })
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' })
  const year = end.getFullYear()

  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${year}`
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${year}`
})

const weekStats = computed(() => {
  const allItems = weekDays.value.flatMap(d => d.items)
  const completed = allItems.filter(t => t.completed).length
  return {
    total: allItems.length,
    completed,
    percentage: allItems.length > 0 ? Math.round((completed / allItems.length) * 100) : 0
  }
})

const monthYearLabel = computed(() =>
  currentMonthAnchor.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
)

const monthDayCells = computed(() => {
  const y = currentMonthAnchor.value.getFullYear()
  const m = currentMonthAnchor.value.getMonth()
  const first = new Date(y, m, 1)
  const startPad = (first.getDay() + 6) % 7
  const gridStart = new Date(y, m, 1 - startPad)

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const dateKey = formatDateKeyLocal(d)
    const inMonth = d.getMonth() === m
    const items = plannerItemsByDateKey.value[dateKey] || []

    cells.push({
      date: d,
      dateKey,
      dayNumber: d.getDate(),
      inMonth,
      isToday: dateKey === formatDateKeyLocal(new Date()),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      items,
      completedItems: items.filter(t => t.completed).length
    })
  }
  return cells
})

const monthWeekRows = computed(() => {
  const cells = monthDayCells.value
  const rows = []
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7))
  }
  return rows
})

const monthStats = computed(() => {
  const start = new Date(currentMonthAnchor.value.getFullYear(), currentMonthAnchor.value.getMonth(), 1)
  const end = new Date(currentMonthAnchor.value.getFullYear(), currentMonthAnchor.value.getMonth() + 1, 0)
  const startKey = formatDateKeyLocal(start)
  const endKey = formatDateKeyLocal(end)

  const taskInRange = tasksStore.getTasksForDateRange(startKey, endKey)
  const assignInRange = assignmentsStore.assignments.filter(
    (a) => a.dueDate >= startKey && a.dueDate <= endKey
  )
  const allItems = [
    ...taskInRange.map((t) => ({ completed: t.completed })),
    ...assignInRange.map((a) => ({ completed: a.status === 'completed' })),
  ]

  const completed = allItems.filter((x) => x.completed).length
  return {
    total: allItems.length,
    completed,
    percentage: allItems.length > 0 ? Math.round((completed / allItems.length) * 100) : 0
  }
})

const periodStats = computed(() => (viewMode.value === 'week' ? weekStats.value : monthStats.value))
const periodLabel = computed(() => (viewMode.value === 'week' ? 'Week progress' : 'Month progress'))

function previousWeek() {
  const newStart = new Date(currentWeekStart.value)
  newStart.setDate(newStart.getDate() - 7)
  currentWeekStart.value = newStart
}

function nextWeek() {
  const newStart = new Date(currentWeekStart.value)
  newStart.setDate(newStart.getDate() + 7)
  currentWeekStart.value = newStart
}

function goToTodayWeek() {
  currentWeekStart.value = getWeekStart(new Date())
}

function previousMonth() {
  const d = new Date(currentMonthAnchor.value)
  d.setMonth(d.getMonth() - 1)
  currentMonthAnchor.value = startOfMonthFromDate(d)
}

function nextMonth() {
  const d = new Date(currentMonthAnchor.value)
  d.setMonth(d.getMonth() + 1)
  currentMonthAnchor.value = startOfMonthFromDate(d)
}

function goToThisMonth() {
  currentMonthAnchor.value = startOfMonthFromDate(new Date())
}

function getCourseColor(courseId) {
  const course = coursesStore.getCourseById(courseId)
  return course?.color || { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300' }
}
</script>

<template>
  <div>
    <!-- Single root ELEMENT required by <Transition mode="out-in"> in App.vue.
         A fragment root (multiple roots, or even a stray comment beside the root)
         stalls the leave transition so the next page never mounts. This regressed
         when the drag-and-drop work moved the edit modals out of this <div>. -->
    <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">Planner</h2>
          <p class="text-gray-500">Switch between week and month to plan your tasks</p>
        </div>

        <div class="flex flex-col items-stretch sm:items-end gap-3">
          <!-- View tabs -->
          <div
            class="inline-flex self-stretch sm:self-auto p-1 rounded-xl bg-gray-100/90 dark:bg-gray-700/80 border border-gray-200/80 dark:border-gray-600/80 shadow-sm shadow-gray-900/5"
            role="tablist"
            aria-label="Planner view"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="viewMode === 'week'"
              class="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
              :class="
                viewMode === 'week'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-gray-200/80 dark:ring-gray-600/80'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              "
              @click="viewMode = 'week'"
            >
              Week
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="viewMode === 'month'"
              class="flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
              :class="
                viewMode === 'month'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-gray-200/80 dark:ring-gray-600/80'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              "
              @click="viewMode = 'month'"
            >
              Month
            </button>
          </div>

          <!-- Week navigation -->
          <div
            v-if="viewMode === 'week'"
            class="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1.5"
          >
            <button
              type="button"
              class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              @click="previousWeek"
            >
              <svg class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              type="button"
              class="px-4 py-2 text-sm font-medium text-primary-800 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
              @click="goToTodayWeek"
            >
              Today
            </button>

            <button
              type="button"
              class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              @click="nextWeek"
            >
              <svg class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div class="w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1 hidden sm:block" />

            <span class="px-2 sm:px-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
              {{ weekRange }}
            </span>
          </div>

          <!-- Month navigation -->
          <div
            v-else
            class="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1.5"
          >
            <button
              type="button"
              class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              @click="previousMonth"
            >
              <svg class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              type="button"
              class="px-4 py-2 text-sm font-medium text-primary-800 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
              @click="goToThisMonth"
            >
              This month
            </button>

            <button
              type="button"
              class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              @click="nextMonth"
            >
              <svg class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            <div class="w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1 hidden sm:block" />

            <span class="px-2 sm:px-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
              {{ monthYearLabel }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Period stats -->
    <Card class="bg-gray-50/60 dark:bg-gray-800/60 border-gray-200/80 dark:border-gray-700/80">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="flex items-center gap-4">
          <div
            class="w-14 h-14 rounded-2xl bg-white dark:bg-gray-700 border border-gray-200/70 dark:border-gray-600/70 shadow-sm shadow-gray-900/5 flex items-center justify-center"
          >
            <svg
              class="w-7 h-7 text-primary-800"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <div>
            <h3 class="text-[17px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">{{ periodLabel }}</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ periodStats.completed }} of {{ periodStats.total }} scheduled items completed
            </p>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <div class="w-32 sm:w-40">
            <div class="flex justify-between text-sm mb-1">
              <span class="text-gray-600 dark:text-gray-400">Progress</span>
              <span class="font-semibold text-gray-900 dark:text-gray-100">{{ periodStats.percentage }}%</span>
            </div>
            <div
              class="h-2 bg-gray-200/80 dark:bg-gray-700/80 rounded-full overflow-hidden ring-1 ring-inset ring-gray-200/50 dark:ring-gray-600/50"
            >
              <div
                class="h-full bg-gradient-to-r from-primary-800 to-primary-950 rounded-full transition-all duration-500"
                :style="{ width: `${periodStats.percentage}%` }"
              />
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- Week grid -->
    <div v-show="viewMode === 'week'" class="grid grid-cols-7 gap-2 sm:gap-3">
      <div v-for="day in weekDays" :key="day.dateKey" class="min-h-[280px] sm:min-h-[320px] flex flex-col">
        <div
          class="text-center p-2 sm:p-3 rounded-t-xl border-b-2 transition-all"
          :class="[
            day.isToday
              ? 'bg-primary-900 text-white border-primary-900'
              : day.isWeekend
                ? 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700'
          ]"
        >
          <p
            class="text-[10px] sm:text-xs font-medium uppercase tracking-wider"
            :class="day.isToday ? 'text-primary-300' : 'text-gray-500'"
          >
            {{ day.dayName }}
          </p>
          <p class="text-xl sm:text-2xl font-bold mt-0.5">{{ day.dayNumber }}</p>
          <p
            v-if="day.items.length > 0"
            class="text-[10px] sm:text-xs mt-1"
            :class="day.isToday ? 'text-primary-300/90' : 'text-gray-400'"
          >
            {{ day.completedItems }}/{{ day.items.length }} done
          </p>
        </div>

        <div
          class="flex-1 border-2 border-t-0 rounded-b-xl p-1.5 sm:p-2 overflow-y-auto max-h-[480px] transition-colors"
          :class="[
            day.isToday && dragOverDateKey !== day.dateKey
              ? 'border-primary-200/80 dark:border-primary-700/60 bg-primary-50/40 dark:bg-primary-900/20'
              : day.isWeekend && dragOverDateKey !== day.dateKey
                ? 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20'
                : dragOverDateKey !== day.dateKey
                  ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50'
                  : '',
            dragOverDateKey === day.dateKey ? 'border-primary-400 dark:border-primary-500 bg-primary-50/60 dark:bg-primary-900/30' : ''
          ]"
          @dragover="onDragOverCell($event, day)"
          @dragleave="onDragLeaveCell($event, day)"
          @drop="onDropCell($event, day)"
        >
          <div v-if="day.items.length === 0" class="h-full min-h-[120px] flex items-center justify-center">
            <p class="text-[10px] sm:text-xs text-gray-400 text-center px-1">Nothing due</p>
          </div>

          <div v-else class="space-y-1.5 sm:space-y-2">
            <div
              v-for="item in day.items"
              :key="item.id"
              draggable="true"
              class="group p-2 sm:p-2.5 rounded-lg border-l-4 transition-all hover:shadow-sm select-none"
              :class="[
                getCourseColor(item.courseId).bg,
                getCourseColor(item.courseId).border,
                item.completed ? 'opacity-60' : '',
                draggingItem?.id === item.id ? 'opacity-40 ring-1 ring-gray-400' : ''
              ]"
              @dragstart="onDragStart($event, item)"
              @dragend="onDragEnd"
              @click="onPlannerItemClick(item)"
            >
              <div class="flex items-start gap-1.5 sm:gap-2">
                <div class="flex-1 min-w-0">
                  <p
                    class="text-[10px] sm:text-xs font-medium leading-tight"
                    :class="[
                      getCourseColor(item.courseId).text,
                      item.completed ? 'line-through' : ''
                    ]"
                  >
                    {{ item.title }}
                  </p>
                  <p class="text-[9px] sm:text-[10px] text-gray-500 truncate mt-0.5">
                    {{ item.courseName
                    }}<span v-if="item.kind === 'assignment'" class="text-gray-400"> · Assignment</span>
                  </p>
                </div>
                <div
                  class="shrink-0 mt-0.5 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full border-2 transition-all flex items-center justify-center cursor-pointer hover:scale-110"
                  :class="
                    item.completed
                      ? 'bg-primary-900 border-primary-900'
                      : 'border-gray-400 group-hover:border-primary-700 bg-white dark:bg-gray-700'
                  "
                  @click.stop="onPlannerCheckboxClick(item)"
                >
                  <svg
                    v-if="item.completed"
                    class="w-2 h-2 sm:w-2.5 sm:h-2.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Month grid -->
    <div
      v-show="viewMode === 'month'"
      class="rounded-2xl border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 shadow-[0_1px_2px_rgba(28,25,23,0.04)] overflow-hidden overflow-x-auto"
    >
      <div class="min-w-[640px] sm:min-w-0">
        <div class="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50/90 dark:bg-gray-700/60">
          <div
            v-for="label in weekdayLabels"
            :key="label"
            class="py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide"
          >
            {{ label }}
          </div>
        </div>
        <div class="divide-y divide-gray-100 dark:divide-gray-700">
          <div v-for="(row, ri) in monthWeekRows" :key="ri" class="grid grid-cols-7 divide-x divide-gray-100 dark:divide-gray-700">
            <div
              v-for="day in row"
              :key="day.dateKey"
              class="min-h-[100px] sm:min-h-[140px] p-1 sm:p-2 flex flex-col gap-1 transition-colors"
              :class="[
                !day.inMonth ? 'bg-gray-50/70 dark:bg-gray-800/40 text-gray-400' : '',
                day.inMonth && day.isToday && dragOverDateKey !== day.dateKey
                  ? 'bg-primary-50/50 dark:bg-primary-900/20 ring-1 ring-inset ring-primary-200/60 dark:ring-primary-700/40 z-1'
                  : '',
                day.inMonth && day.isWeekend && !day.isToday && dragOverDateKey !== day.dateKey ? 'bg-gray-50/40 dark:bg-gray-700/20' : '',
                day.inMonth && dragOverDateKey === day.dateKey ? 'bg-primary-100/60 dark:bg-primary-800/30 ring-2 ring-inset ring-primary-400 dark:ring-primary-500' : ''
              ]"
              @dragover="onDragOverCell($event, day)"
              @dragleave="onDragLeaveCell($event, day)"
              @drop="onDropCell($event, day)"
            >
              <div class="flex items-center justify-between gap-1 shrink-0">
                <span
                  class="text-xs sm:text-sm font-semibold tabular-nums"
                  :class="[
                    !day.inMonth ? 'text-gray-300 dark:text-gray-600' : '',
                    day.inMonth && day.isToday ? 'text-primary-900 dark:text-primary-400' : '',
                    day.inMonth && !day.isToday ? 'text-gray-900 dark:text-gray-100' : ''
                  ]"
                >
                  {{ day.dayNumber }}
                </span>
                <span
                  v-if="day.inMonth && day.items.length > 0"
                  class="text-[10px] font-medium text-gray-500 tabular-nums"
                >
                  {{ day.completedItems }}/{{ day.items.length }}
                </span>
              </div>

              <div class="flex-1 flex flex-col gap-1 min-h-0 overflow-y-auto max-h-[200px] sm:max-h-[280px]">
                <template v-if="day.items.length === 0">
                  <p v-if="day.inMonth" class="text-[10px] text-gray-300 mt-1 hidden sm:block">—</p>
                </template>
                <div
                  v-for="item in day.items"
                  v-else
                  :key="item.id"
                  draggable="true"
                  class="group rounded-md border-l-[3px] px-1 py-1 sm:px-1.5 sm:py-1.5 transition-all hover:shadow-sm select-none"
                  :class="[
                    getCourseColor(item.courseId).bg,
                    getCourseColor(item.courseId).border,
                    item.completed ? 'opacity-60' : '',
                    draggingItem?.id === item.id ? 'opacity-40 ring-1 ring-gray-400' : ''
                  ]"
                  @dragstart="onDragStart($event, item)"
                  @dragend="onDragEnd"
                  @click="onPlannerItemClick(item)"
                >
                  <div class="flex items-start gap-1">
                    <p
                      class="flex-1 text-[9px] sm:text-[10px] font-medium leading-snug line-clamp-2 sm:line-clamp-3"
                      :class="[
                        getCourseColor(item.courseId).text,
                        item.completed ? 'line-through' : ''
                      ]"
                    >
                      {{ item.title }}
                    </p>
                    <div
                      class="shrink-0 mt-0.5 w-3 h-3 rounded-full border border-gray-400 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                      :class="item.completed ? 'bg-primary-900 border-primary-900' : 'bg-white dark:bg-gray-700'"
                      @click.stop="onPlannerCheckboxClick(item)"
                    >
                      <svg
                        v-if="item.completed"
                        class="w-1.5 h-1.5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p v-if="viewMode === 'month'" class="text-xs text-gray-500 sm:hidden">
      Scroll horizontally on small screens to see the full month.
    </p>

    <!-- Course legend -->
    <Card v-if="coursesStore.courses.length > 0">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">Course legend</h4>
        <span class="text-xs text-gray-500">{{ coursesStore.courses.length }} courses</span>
      </div>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="course in coursesStore.courses"
          :key="course.id"
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          :class="course.color.bg"
        >
          <div class="w-2.5 h-2.5 rounded-full" :class="course.color.bg.replace('100', '500')" />
          <span class="text-sm font-medium" :class="course.color.text">
            {{ course.code || course.name }}
          </span>
        </div>
      </div>
    </Card>

    <Card v-if="showPlannerEmptyState" padding="none">
      <EmptyState
        icon="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        title="Nothing to plan yet"
        description="Sign in and sync courses, or add assignments and tasks to see them on your calendar"
      />
    </Card>
  </div>

  <!-- Edit Task Modal -->
  <TaskFormModal v-model="showTaskEditModal" :task="editingTask" @save="saveEditedTask" />

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
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description</label>
        <textarea
          v-model="editFormData.description"
          rows="4"
          placeholder="Add any details about the assignment..."
          class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
        ></textarea>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Dropdown v-model="editFormData.courseId" label="Course" :options="modalCourseOptions" />

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Due Date <span class="text-danger-500">*</span>
          </label>
          <input
            v-model="editFormData.dueDate"
            type="date"
            required
            class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent scheme-light dark:scheme-dark"
          />
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
