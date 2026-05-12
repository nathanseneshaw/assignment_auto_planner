<script setup>
import { ref, computed } from 'vue'
import { useTasksStore } from '../stores/tasks'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'
import { Card, Button, EmptyState, ConfirmDialog } from '../components/ui'
import TaskFormModal from '../components/features/TaskFormModal.vue'

const tasksStore = useTasksStore()
const assignmentsStore = useAssignmentsStore()
const coursesStore = useCoursesStore()

const showModal = ref(false)
const editingTask = ref(null)
const showDeleteConfirm = ref(false)
const taskToDelete = ref(null)

const filterDate = ref('all')   // 'today' | 'week' | 'all'
const filterStatus = ref('all') // 'all' | 'active' | 'completed'

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekEndKey() {
  const d = new Date()
  d.setDate(d.getDate() + (6 - d.getDay()))
  return localDateKey(d)
}

const stats = computed(() => {
  const today = localDateKey()
  const all = tasksStore.tasks
  return {
    total: all.length,
    completed: all.filter(t => t.completed).length,
    overdue: tasksStore.overdueTasks.length,
    today: all.filter(t => t.scheduledDate === today).length,
  }
})

const filteredTasks = computed(() => {
  let list = [...tasksStore.tasks]
  const today = localDateKey()

  if (filterDate.value === 'today') {
    list = list.filter(t => t.scheduledDate === today)
  } else if (filterDate.value === 'week') {
    list = list.filter(t => t.scheduledDate >= today && t.scheduledDate <= weekEndKey())
  }

  if (filterStatus.value === 'active') {
    list = list.filter(t => !t.completed)
  } else if (filterStatus.value === 'completed') {
    list = list.filter(t => t.completed)
  }

  return list.sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate)
    return (a.priority ?? 3) - (b.priority ?? 3)
  })
})

const groupedByDate = computed(() => {
  const groups = {}
  filteredTasks.value.forEach(task => {
    if (!groups[task.scheduledDate]) groups[task.scheduledDate] = []
    groups[task.scheduledDate].push(task)
  })
  return groups
})

const sortedDates = computed(() => Object.keys(groupedByDate.value).sort())

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

function formatDateHeading(dateStr) {
  if (!dateStr) return ''
  const today = localDateKey()
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = localDateKey(tomorrowDate)
  if (dateStr === today) return 'Today'
  if (dateStr === tomorrow) return 'Tomorrow'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function isOverdue(task) {
  return !task.completed && task.scheduledDate < localDateKey()
}

function getCourseColor(task) {
  if (!task.courseId) return null
  return coursesStore.getCourseById(task.courseId)?.color || null
}

function getAssignmentTitle(task) {
  if (!task.assignmentId) return null
  return assignmentsStore.getAssignmentById(task.assignmentId)?.title || null
}

const PRIORITY_BADGE = {
  urgent: { label: 'Urgent', classes: 'bg-danger-50 text-danger-600 border border-danger-200' },
  high:   { label: 'High',   classes: 'bg-amber-50 text-amber-700 border border-amber-200' },
  normal: { label: 'Normal', classes: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-gray-900">Tasks</h2>
        <p class="text-gray-500">Plan and track your daily study tasks</p>
      </div>
      <Button @click="openAddModal" variant="primary">
        <svg class="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Task
      </Button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold text-gray-900">{{ stats.total }}</p>
        <p class="text-sm text-gray-500">Total</p>
      </Card>
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold text-emerald-700">{{ stats.completed }}</p>
        <p class="text-sm text-gray-500">Completed</p>
      </Card>
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold" :class="stats.overdue > 0 ? 'text-danger-600' : 'text-gray-400'">
          {{ stats.overdue }}
        </p>
        <p class="text-sm text-gray-500">Overdue</p>
      </Card>
      <Card padding="md" class="text-center">
        <p class="text-3xl font-bold text-primary-800">{{ stats.today }}</p>
        <p class="text-sm text-gray-500">Due Today</p>
      </Card>
    </div>

    <!-- Filters -->
    <Card>
      <div class="flex flex-col sm:flex-row gap-3">
        <!-- Date filter -->
        <div class="flex rounded-xl border border-gray-200 overflow-hidden">
          <button
            v-for="opt in [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' }, { value: 'all', label: 'All' }]"
            :key="opt.value"
            type="button"
            class="px-4 py-2 text-sm font-medium transition-colors"
            :class="filterDate === opt.value
              ? 'bg-primary-900 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'"
            @click="filterDate = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- Status filter -->
        <div class="sm:w-44">
          <select
            v-model="filterStatus"
            class="w-full px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/20 hover:border-gray-300 transition-colors"
          >
            <option value="all">All tasks</option>
            <option value="active">Active only</option>
            <option value="completed">Completed only</option>
          </select>
        </div>
      </div>
    </Card>

    <!-- Empty state -->
    <Card v-if="sortedDates.length === 0" padding="none">
      <EmptyState
        icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        title="No tasks found"
        :description="filterDate !== 'all' || filterStatus !== 'all'
          ? 'Try adjusting your filters'
          : 'Get started by adding your first task'"
        :action-label="filterDate === 'all' && filterStatus === 'all' ? 'Add Task' : ''"
        @action="openAddModal"
      />
    </Card>

    <!-- Task groups by date -->
    <div v-else class="space-y-6">
      <div v-for="date in sortedDates" :key="date">
        <!-- Date heading -->
        <div class="flex items-center gap-3 mb-3">
          <h3
            class="text-sm font-semibold uppercase tracking-wide"
            :class="date < localDateKey() ? 'text-danger-600' : 'text-gray-500'"
          >
            {{ formatDateHeading(date) }}
          </h3>
          <div class="flex-1 h-px bg-gray-100"></div>
          <span class="text-xs text-gray-400">
            {{ groupedByDate[date].filter(t => t.completed).length }}/{{ groupedByDate[date].length }}
          </span>
        </div>

        <!-- Task rows -->
        <div class="space-y-2">
          <div
            v-for="task in groupedByDate[date]"
            :key="task.id"
            class="group flex items-center gap-3 p-3.5 rounded-xl border transition-all"
            :class="task.completed
              ? 'bg-gray-50/60 border-gray-100'
              : isOverdue(task)
                ? 'bg-white border-danger-200 hover:border-danger-300'
                : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'"
          >
            <!-- Checkbox -->
            <button
              type="button"
              class="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
              :class="task.completed
                ? 'bg-emerald-500 border-emerald-500'
                : isOverdue(task)
                  ? 'border-danger-400 hover:border-danger-500'
                  : 'border-gray-300 hover:border-primary-400'"
              @click="tasksStore.toggleTaskComplete(task.id)"
            >
              <svg v-if="task.completed" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <p
                class="text-sm font-medium leading-snug"
                :class="task.completed ? 'line-through text-gray-400' : 'text-gray-900'"
              >
                {{ task.title }}
              </p>

              <div class="flex flex-wrap items-center gap-2 mt-1.5">
                <!-- Priority badge (urgent/high only) -->
                <span
                  v-if="task.priorityLevel && PRIORITY_BADGE[task.priorityLevel]"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
                  :class="PRIORITY_BADGE[task.priorityLevel].classes"
                >
                  {{ PRIORITY_BADGE[task.priorityLevel].label }}
                </span>

                <!-- Course badge -->
                <span
                  v-if="task.courseName && getCourseColor(task)"
                  class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
                  :class="[getCourseColor(task).bg, getCourseColor(task).text]"
                >
                  {{ task.courseName }}
                </span>

                <!-- Assignment badge -->
                <span
                  v-if="getAssignmentTitle(task)"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  {{ getAssignmentTitle(task) }}
                </span>

                <!-- Overdue label -->
                <span v-if="isOverdue(task)" class="text-xs font-medium text-danger-600">
                  Overdue
                </span>
              </div>
            </div>

            <!-- Edit / delete -->
            <div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                class="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-all"
                title="Edit task"
                @click="openEditModal(task)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                type="button"
                class="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded-lg transition-all"
                title="Delete task"
                @click="promptDelete(task)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Task Form Modal -->
    <TaskFormModal
      v-model="showModal"
      :task="editingTask"
      @save="handleSave"
    />

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
