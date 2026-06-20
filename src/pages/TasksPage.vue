<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '../stores/tasks'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'
import { useSubtasksStore } from '../stores/subtasks'
import { Dropdown, ConfirmDialog } from '../components/ui'
import TaskFormModal from '../components/features/TaskFormModal.vue'

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()
const subtasksStore = useSubtasksStore()

// ── Modal + delete dialog state ───────────────────────────────────────────
const showModal = ref(false)
const editingTask = ref(null)
const showDeleteConfirm = ref(false)
const taskToDelete = ref(null)

// ── Subtask row expand + inline add ─────────────────────────────────────
const expandedTasks = ref({})
const newSubtaskByTask = ref({})
const addingSubtaskForTask = ref({})

function toggleTaskExpand(taskId) {
  const next = !expandedTasks.value[taskId]
  expandedTasks.value = { ...expandedTasks.value, [taskId]: next }
  if (!next) {
    addingSubtaskForTask.value = { ...addingSubtaskForTask.value, [taskId]: false }
    newSubtaskByTask.value = { ...newSubtaskByTask.value, [taskId]: '' }
  }
}

function startAddingSubtask(taskId) {
  addingSubtaskForTask.value = { ...addingSubtaskForTask.value, [taskId]: true }
}

function cancelAddingSubtask(taskId) {
  addingSubtaskForTask.value = { ...addingSubtaskForTask.value, [taskId]: false }
  newSubtaskByTask.value = { ...newSubtaskByTask.value, [taskId]: '' }
}

async function addSubtaskInline(taskId) {
  const title = (newSubtaskByTask.value[taskId] || '').trim()
  if (!title) { cancelAddingSubtask(taskId); return }
  await subtasksStore.addSubtask(taskId, title)
  newSubtaskByTask.value = { ...newSubtaskByTask.value, [taskId]: '' }
}

// ── View state: date filter · status filter · search · group ─────────────────
const filterDate = ref('all')   // 'today' | 'week' | 'all'
const filterStatus = ref('all') // 'all' | 'active' | 'completed'
const searchQuery = ref('')
const filterGroup = ref(null)   // null = all groups; string = specific group

// ── Group management ──────────────────────────────────────────────────────────
const renamingGroup = ref(null)   // group name being renamed, or null
const renameInput = ref('')       // current value in the rename input

function startRename(name) {
  renamingGroup.value = name
  renameInput.value = name
}

function commitRename(oldName) {
  const n = renameInput.value.trim()
  if (n && n !== oldName) {
    if (filterGroup.value === oldName) filterGroup.value = n
    tasksStore.renameGroup(oldName, n)
  }
  renamingGroup.value = null
}

function cancelRename() {
  renamingGroup.value = null
}

function removeGroup(name) {
  tasksStore.deleteGroup(name)
  if (filterGroup.value === name) filterGroup.value = null
}

const dateTabs = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'all', label: 'All' },
]

const statusOptions = [
  { value: 'all', label: 'All tasks' },
  { value: 'active', label: 'Active only' },
  { value: 'completed', label: 'Completed only' },
]

// ── Date helpers (local-time safe, no UTC drift) ──────────────────────────
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekEndKey() {
  const d = new Date()
  d.setDate(d.getDate() + (6 - d.getDay()))
  return localDateKey(d)
}

/** "Mon, Jun 8"  weekday + month + day, matching the editorial row layout. */
function taskDateLabel(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${WEEKDAYS_SHORT[dt.getDay()]}, ${MONTHS_SHORT[m - 1]} ${d}`
}

function isOverdue(task) {
  return !task.completed && !!task.scheduledDate && task.scheduledDate < localDateKey()
}

// ── Overall stats + progress (unaffected by the filters) ──────────────────
const stats = computed(() => {
  const today = localDateKey()
  const all = tasksStore.tasks
  const completed = all.filter((t) => t.completed).length
  return {
    total: all.length,
    completed,
    remaining: all.length - completed,
    overdue: tasksStore.overdueTasks.length,
    today: all.filter((t) => t.scheduledDate === today).length,
  }
})

const progressPct = computed(() =>
  stats.value.total ? Math.round((stats.value.completed / stats.value.total) * 100) : 0,
)

const todayDone = computed(() => {
  const today = localDateKey()
  return tasksStore.tasks.filter((t) => t.scheduledDate === today && t.completed).length
})

const statCards = computed(() => [
  { label: 'Total', value: stats.value.total, tone: 'text-gray-900 dark:text-gray-50' },
  { label: 'Completed', value: stats.value.completed, tone: 'text-primary-600 dark:text-primary-400' },
  { label: 'Overdue', value: stats.value.overdue, tone: 'text-rust-600 dark:text-rust-500' },
  { label: 'Due Today', value: stats.value.today, tone: 'text-warning-600 dark:text-warning-400' },
])

const breakdown = computed(() => [
  { label: 'Total', value: stats.value.total, tone: 'text-gray-900 dark:text-gray-100' },
  { label: 'Completed', value: stats.value.completed, tone: 'text-primary-600 dark:text-primary-400' },
  { label: 'Remaining', value: stats.value.remaining, tone: 'text-warning-600 dark:text-warning-400' },
  { label: 'Overdue', value: stats.value.overdue, tone: stats.value.overdue ? 'text-rust-600 dark:text-rust-500' : 'text-gray-400 dark:text-gray-500' },
  { label: 'Due today', value: stats.value.today, tone: stats.value.today ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500' },
])

// ── Filtering + bucketing ─────────────────────────────────────────────────
const visibleTasks = computed(() => {
  let list = [...tasksStore.tasks]
  const q = searchQuery.value.trim().toLowerCase()
  if (q) list = list.filter((t) => t.title?.toLowerCase().includes(q))
  if (filterStatus.value === 'active') list = list.filter((t) => !t.completed)
  else if (filterStatus.value === 'completed') list = list.filter((t) => t.completed)
  if (filterGroup.value !== null) list = list.filter((t) => t.group === filterGroup.value)
  return list
})

const BUCKET_LABELS = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This Week',
  later: 'Later',
  none: 'No Date',
}

function bucketKey(task, today, weekEnd) {
  const d = task.scheduledDate
  if (!d) return 'none'
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d <= weekEnd) return 'week'
  return 'later'
}

function sortTasks(list) {
  return list.sort((a, b) => {
    const dateA = a.scheduledDate || ''
    const dateB = b.scheduledDate || ''
    if (dateA !== dateB) {
      if (!dateA) return 1
      if (!dateB) return -1
      return dateA.localeCompare(dateB)
    }
    return (a.priority ?? 3) - (b.priority ?? 3)
  })
}

const groups = computed(() => {
  const today = localDateKey()
  const weekEnd = weekEndKey()
  const allowed =
    filterDate.value === 'today'
      ? ['today']
      : filterDate.value === 'week'
        ? ['overdue', 'today', 'week']
        : ['overdue', 'today', 'week', 'later', 'none']

  const map = { overdue: [], today: [], week: [], later: [], none: [] }
  for (const t of visibleTasks.value) map[bucketKey(t, today, weekEnd)].push(t)

  return allowed
    .filter((k) => map[k].length)
    .map((k) => ({
      key: k,
      label: BUCKET_LABELS[k],
      tone: k === 'overdue' ? 'rust' : 'muted',
      tasks: sortTasks(map[k]),
      done: map[k].filter((t) => t.completed).length,
      total: map[k].length,
    }))
})

const hasActiveFilter = computed(
  () =>
    filterDate.value !== 'all' ||
    filterStatus.value !== 'all' ||
    !!searchQuery.value.trim() ||
    filterGroup.value !== null,
)

const emptyCopy = computed(() => {
  if (filterGroup.value !== null)
    return { title: `No tasks in "${filterGroup.value}".`, sub: 'Add a task and assign it to this group.' }
  if (hasActiveFilter.value)
    return { title: 'No tasks match your filters.', sub: 'Try a different view or clear the search.' }
  return { title: 'No tasks yet.', sub: 'Add your first study task to get started.' }
})

// ── Course swatch (map stored "bg-blue-100" → solid dot) ──────────────────
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

function courseDot(task) {
  const c = task.courseId ? coursesStore.getCourseById(task.courseId) : null
  return (c && DOT_BY_BG[c.color?.bg]) || 'bg-gray-400'
}

function getAssignmentTitle(task) {
  if (!task.assignmentId) return null
  return assignmentsStore.getAssignmentById(task.assignmentId)?.title || null
}

// ── Priority badge (urgent / high / normal) ───────────────────────────────
const PRIORITY_BADGE = {
  urgent: { label: 'Urgent', classes: 'bg-rust-50 text-rust-600 dark:bg-rust-500/10 dark:text-rust-500' },
  high: { label: 'High', classes: 'bg-warning-100/80 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400' },
  normal: { label: 'Normal', classes: 'bg-primary-100/70 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300' },
}

function priorityBadge(task) {
  return PRIORITY_BADGE[task.priorityLevel] || PRIORITY_BADGE.normal
}

// ── CRUD ──────────────────────────────────────────────────────────────────
function openAddModal() {
  editingTask.value = null
  showModal.value = true
}

function openEditModal(task) {
  editingTask.value = task
  showModal.value = true
}

function handleSave(payload) {
  if (editingTask.value) {
    tasksStore.updateTask(editingTask.value.id, payload)
  } else {
    tasksStore.addTask(payload)
  }
  editingTask.value = null
}

function promptDelete(task) {
  taskToDelete.value = task
  showDeleteConfirm.value = true
}

function confirmDelete() {
  if (taskToDelete.value) {
    tasksStore.deleteTask(taskToDelete.value.id)
    taskToDelete.value = null
  }
  showDeleteConfirm.value = false
}

// Deep-link: arriving with `?new=1` (e.g. the dashboard's "Add task" shortcut)
// pops the add-task modal immediately, then strips the flag so a refresh or
// back-navigation doesn't reopen it.
onMounted(() => {
  if (route.query.new) {
    openAddModal()
    router.replace({ query: { ...route.query, new: undefined } })
  }
})
</script>

<template>
  <div class="pb-12">
    <!-- Top meta bar -->
    <div class="flex items-center justify-end gap-4 pb-6">
      <p class="eyebrow flex items-center gap-2.5 text-gray-400">
        <span>{{ todayDone }}/{{ stats.today }} Today</span>
        <span class="text-gray-300 dark:text-gray-600">·</span>
        <span :class="stats.overdue ? 'text-rust-600 dark:text-rust-500' : 'text-primary-600 dark:text-primary-400'">
          {{ stats.overdue ? `${stats.overdue} Overdue` : 'On track' }}
        </span>
      </p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-x-10 gap-y-10">

      <!-- ══ Main column ═══════════════════════════════════════════════════ -->
      <div class="min-w-0">
        <!-- Title + add -->
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="display text-4xl sm:text-5xl text-gray-900 dark:text-gray-50">Tasks</h1>
            <p class="mt-1.5 font-serif italic text-base sm:text-lg text-gray-500 dark:text-gray-400">
              Plan and track your daily study tasks
            </p>
          </div>
          <button
            type="button"
            @click="openAddModal"
            class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Task
          </button>
        </div>

        <!-- Stat cards -->
        <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div
            v-for="card in statCards"
            :key="card.label"
            class="rounded-2xl border border-paper-line dark:border-gray-700/60 bg-surface dark:bg-gray-800 px-5 py-4 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_2px_8px_rgba(28,25,23,0.05)]"
          >
            <p class="display text-4xl sm:text-5xl leading-none" :class="card.tone">{{ card.value }}</p>
            <p class="eyebrow text-gray-400 dark:text-gray-500 mt-3">{{ card.label }}</p>
          </div>
        </div>

        <!-- ── Group chips ── -->
        <div v-if="tasksStore.taskGroups.length" class="mt-6 flex items-center gap-2 flex-wrap">
          <span class="eyebrow text-gray-400 dark:text-gray-500 mr-1">Groups</span>

          <!-- All chip -->
          <button
            type="button"
            class="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold transition-colors duration-150"
            :class="filterGroup === null
              ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
              : 'bg-surface dark:bg-gray-700/60 border border-gray-200/80 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100'"
            @click="filterGroup = null"
          >All</button>

          <!-- Per-group chips -->
          <div
            v-for="g in tasksStore.taskGroups"
            :key="g"
            class="relative inline-flex"
          >
            <!-- Rename input (appears on double-click) -->
            <template v-if="renamingGroup === g">
              <input
                :value="renameInput"
                @input="renameInput = $event.target.value"
                @keydown.enter.prevent="commitRename(g)"
                @keydown.escape.prevent="cancelRename"
                @blur="commitRename(g)"
                class="h-[26px] px-2.5 rounded-full text-[12px] font-semibold border border-primary-400/80 bg-surface dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/25 w-32"
                autofocus
              />
            </template>

            <template v-else>
              <button
                type="button"
                class="group/chip inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold transition-colors duration-150"
                :class="filterGroup === g
                  ? 'bg-primary-800 dark:bg-primary-700 text-white'
                  : 'bg-surface dark:bg-gray-700/60 border border-gray-200/80 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100'"
                @click="filterGroup = (filterGroup === g ? null : g)"
                @dblclick.prevent="startRename(g)"
                :title="`Filter by ${g} · double-click to rename`"
              >
                <svg class="w-2.5 h-2.5 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {{ g }}
                <span
                  class="opacity-0 group-hover/chip:opacity-100 inline-flex items-center justify-center w-3 h-3 rounded-full transition-all duration-150 hover:text-danger-500 dark:hover:text-danger-400"
                  :title="`Remove group '${g}'`"
                  @click.stop="removeGroup(g)"
                >
                  <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              </button>
            </template>
          </div>

          <p class="font-mono text-[10px] text-gray-400 dark:text-gray-500 ml-1">Dbl-click to rename</p>
        </div>

        <!-- Filter row -->
        <div class="mt-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="flex items-center gap-5">
            <div class="flex items-center gap-4">
              <button
                v-for="opt in dateTabs"
                :key="opt.value"
                type="button"
                @click="filterDate = opt.value"
                class="eyebrow pb-1 border-b-2 whitespace-nowrap transition-colors"
                :class="filterDate === opt.value
                  ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100'
                  : 'border-transparent text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
              >
                {{ opt.label }}
              </button>
            </div>
            <div class="w-36">
              <Dropdown v-model="filterStatus" size="sm" :options="statusOptions" />
            </div>
          </div>

          <!-- Search -->
          <div class="relative sm:w-60">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search tasks…"
              class="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-paper-line dark:border-gray-700 bg-surface dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-300 dark:focus:border-primary-500/60 transition-[border-color,box-shadow]"
            />
          </div>
        </div>

        <!-- Task groups -->
        <div v-if="groups.length">
          <section v-for="group in groups" :key="group.key" class="mt-7 first:mt-6">
            <!-- Group header -->
            <div class="flex items-center gap-3">
              <p class="eyebrow" :class="group.tone === 'rust' ? 'text-rust-600 dark:text-rust-500' : 'text-gray-400'">
                {{ group.label }}
              </p>
              <span class="font-mono text-[11px] text-gray-400 tabular-nums">{{ group.done }}/{{ group.total }}</span>
              <div class="flex-1 h-px bg-paper-line dark:bg-gray-700/60"></div>
            </div>

            <!-- Task rows -->
            <div class="mt-1">
              <div
                v-for="task in group.tasks"
                :key="task.id"
                class="group flex items-start gap-3 py-3 border-b border-dotted border-paper-line dark:border-gray-700/60 cursor-pointer"
                @click="toggleTaskExpand(task.id)"
              >
                <!-- Checkbox -->
                <button
                  type="button"
                  @click.stop="tasksStore.toggleTaskComplete(task.id)"
                  class="mt-0.5 shrink-0 w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-colors"
                  :class="task.completed
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : isOverdue(task)
                      ? 'border-rust-400 hover:border-rust-500 dark:border-rust-500/60 dark:hover:border-rust-500'
                      : 'border-gray-300 dark:border-gray-600 hover:border-primary-500 dark:hover:border-primary-400'"
                  :title="task.completed ? 'Mark active again' : 'Mark complete'"
                >
                  <svg v-if="task.completed" class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>

                <!-- Title + meta -->
                <div class="flex-1 min-w-0">
                  <p
                    class="font-serif text-[15px] leading-snug"
                    :class="task.completed ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-900 dark:text-gray-100'"
                  >
                    {{ task.title }}
                  </p>

                  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <!-- Priority badge -->
                    <span
                      class="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                      :class="priorityBadge(task).classes"
                    >
                      {{ priorityBadge(task).label }}
                    </span>

                    <!-- Scheduled date -->
                    <template v-if="task.scheduledDate">
                      <span class="text-gray-300 dark:text-gray-600" aria-hidden="true">·</span>
                      <span
                        class="font-mono text-[11.5px] whitespace-nowrap"
                        :class="isOverdue(task)
                          ? 'text-rust-600 dark:text-rust-500'
                          : task.completed ? 'text-gray-400 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'"
                      >
                        <span v-if="isOverdue(task)">↑ </span>{{ taskDateLabel(task.scheduledDate) }}
                      </span>
                    </template>

                    <!-- Course -->
                    <span
                      v-if="task.courseName"
                      class="inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-500 dark:text-gray-400"
                    >
                      <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="courseDot(task)" />
                      {{ task.courseName }}
                    </span>

                    <!-- Group tag -->
                    <button
                      v-if="task.group && filterGroup !== task.group"
                      type="button"
                      class="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200/80 dark:border-gray-700/60 text-gray-500 dark:text-gray-400 hover:border-primary-300/80 hover:text-primary-700 dark:hover:text-primary-400 transition-colors"
                      :title="`Filter by group: ${task.group}`"
                      @click.stop="filterGroup = task.group"
                    >
                      <svg class="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      {{ task.group }}
                    </button>

                    <!-- Linked assignment -->
                    <span
                      v-if="getAssignmentTitle(task)"
                      class="inline-flex items-center gap-1 font-mono text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[12rem]"
                    >
                      <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <span class="truncate">{{ getAssignmentTitle(task) }}</span>
                    </span>

                    <!-- Subtask count indicator -->
                    <template v-if="subtasksStore.subtaskCountByTask[task.id]">
                      <span class="text-gray-300 dark:text-gray-600" aria-hidden="true">·</span>
                      <span
                        class="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full border transition-colors"
                        :class="subtasksStore.subtaskCountByTask[task.id].completed === subtasksStore.subtaskCountByTask[task.id].total
                          ? 'border-primary-200 dark:border-primary-800/60 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60'"
                      >
                        <svg class="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        {{ subtasksStore.subtaskCountByTask[task.id].completed }}/{{ subtasksStore.subtaskCountByTask[task.id].total }}
                      </span>
                    </template>

                  </div>

                  <!-- Subtasks: revealed on row click -->
                  <div
                    v-if="expandedTasks[task.id]"
                    class="mt-2.5 space-y-1.5"
                  >
                    <!-- Subtask rows -->
                    <div
                      v-for="subtask in subtasksStore.getSubtasksForTask(task.id)"
                      :key="subtask.id"
                      class="group/stask flex items-center gap-2"
                    >
                      <button
                        type="button"
                        class="shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors"
                        :class="subtask.completed
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'border-gray-300 dark:border-gray-600 hover:border-primary-500 dark:hover:border-primary-400'"
                        @click.stop="subtasksStore.toggleSubtask(subtask.id)"
                      >
                        <svg v-if="subtask.completed" class="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <span
                        class="flex-1 text-[12px] leading-snug"
                        :class="subtask.completed ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-600 dark:text-gray-300'"
                      >{{ subtask.title }}</span>
                      <button
                        type="button"
                        class="shrink-0 opacity-0 group-hover/stask:opacity-100 p-0.5 text-gray-300 hover:text-danger-500 dark:text-gray-600 dark:hover:text-danger-400 transition-colors"
                        title="Delete subtask"
                        @click.stop="subtasksStore.deleteSubtask(subtask.id)"
                      >
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <!-- Inline add input or add button -->
                    <template v-if="addingSubtaskForTask[task.id]">
                      <div class="flex items-center gap-2" @click.stop>
                        <input
                          :value="newSubtaskByTask[task.id] || ''"
                          @input="newSubtaskByTask = { ...newSubtaskByTask, [task.id]: $event.target.value }"
                          @keydown.enter.stop="addSubtaskInline(task.id)"
                          @keydown.escape.stop="cancelAddingSubtask(task.id)"
                          @blur="!(newSubtaskByTask[task.id] || '').trim() && cancelAddingSubtask(task.id)"
                          type="text"
                          placeholder="Subtask name…"
                          autofocus
                          class="flex-1 text-[12px] bg-transparent border-b border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:outline-none focus:border-primary-400 dark:focus:border-primary-500 py-0.5 transition-colors duration-150"
                        />
                        <button
                          type="button"
                          class="shrink-0 text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors disabled:opacity-30"
                          :disabled="!(newSubtaskByTask[task.id] || '').trim()"
                          @click.stop="addSubtaskInline(task.id)"
                          title="Save subtask"
                        >
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="shrink-0 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
                          @click.stop="cancelAddingSubtask(task.id)"
                          title="Cancel"
                        >
                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </template>
                    <template v-else>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        @click.stop="startAddingSubtask(task.id)"
                      >
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        Add subtask
                      </button>
                    </template>
                  </div>
                </div>

                <!-- Hover actions -->
                <div class="flex items-center gap-1 shrink-0 ml-auto pl-2 transition-opacity opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                  <button
                    type="button"
                    @click.stop="openEditModal(task)"
                    class="eyebrow text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    title="Edit task"
                  >
                    Edit →
                  </button>
                  <button
                    type="button"
                    @click.stop="promptDelete(task)"
                    class="p-1 text-gray-300 hover:text-danger-500 dark:text-gray-600 dark:hover:text-danger-400 transition-colors"
                    title="Delete task"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
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
            v-if="!hasActiveFilter"
            type="button"
            @click="openAddModal"
            class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-900 hover:bg-primary-800 text-white text-[13px] font-semibold transition-colors duration-200 active:scale-[0.98] shadow-sm shadow-primary-900/15"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add task
          </button>
        </div>
      </div>

      <!-- ══ Right rail · Progress ═════════════════════════════════════════ -->
      <aside class="lg:border-l lg:border-paper-line dark:lg:border-gray-700/60 lg:pl-8 lg:sticky lg:top-16 self-start">
        <p class="eyebrow text-gray-400 dark:text-gray-500 mb-3">Progress</p>

        <p class="display text-gray-900 dark:text-gray-50 leading-none">
          <span class="text-6xl">{{ progressPct }}</span><span class="text-3xl text-gray-400 dark:text-gray-600">%</span>
        </p>

        <div class="mt-4 h-1.5 rounded-full bg-paper-line dark:bg-gray-700/60 overflow-hidden">
          <div class="h-full rounded-full bg-primary-600 transition-[width] duration-500 ease-out" :style="{ width: `${progressPct}%` }"></div>
        </div>

        <p class="mt-3 text-[13px] text-gray-500 dark:text-gray-400">
          <span class="font-medium text-gray-900 dark:text-gray-100">{{ stats.completed }}</span> of
          <span class="font-medium text-gray-900 dark:text-gray-100">{{ stats.total }}</span> tasks complete
        </p>

        <!-- Breakdown -->
        <p class="eyebrow text-gray-400 dark:text-gray-500 mt-8 mb-2">Breakdown</p>
        <div>
          <div
            v-for="row in breakdown"
            :key="row.label"
            class="flex items-center justify-between py-2 border-b border-dotted border-paper-line dark:border-gray-700/60"
          >
            <span class="text-[13px] text-gray-500 dark:text-gray-400">{{ row.label }}</span>
            <span class="font-mono text-[15px] tabular-nums" :class="row.tone">{{ row.value }}</span>
          </div>
        </div>

        <!-- Groups -->
        <template v-if="tasksStore.taskGroups.length">
          <p class="eyebrow text-gray-400 dark:text-gray-500 mt-8 mb-2">Groups</p>
          <div class="space-y-1">
            <button
              v-for="g in tasksStore.taskGroups"
              :key="g"
              type="button"
              class="w-full flex items-center justify-between gap-2 py-1.5 group/grail transition-colors"
              @click="filterGroup = (filterGroup === g ? null : g)"
            >
              <span
                class="flex items-center gap-1.5 text-[13px] transition-colors"
                :class="filterGroup === g
                  ? 'text-primary-700 dark:text-primary-400 font-medium'
                  : 'text-gray-500 dark:text-gray-400 group-hover/grail:text-gray-800 dark:group-hover/grail:text-gray-200'"
              >
                <svg class="w-3 h-3 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {{ g }}
              </span>
              <span class="font-mono text-[13px] tabular-nums text-gray-400 dark:text-gray-500">
                {{ tasksStore.tasks.filter(t => t.group === g).length }}
              </span>
            </button>
          </div>
        </template>
      </aside>
    </div>

    <!-- Task Form Modal -->
    <TaskFormModal v-model="showModal" :task="editingTask" @save="handleSave" />

    <!-- Delete Confirmation -->
    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Task"
      :message="`Are you sure you want to delete '${taskToDelete?.title}'? This action cannot be undone.`"
      confirm-text="Delete"
      cancel-text="Cancel"
      variant="danger"
      @confirm="confirmDelete"
    />
  </div>
</template>

