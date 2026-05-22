<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAssignmentsStore } from '../stores/assignments'
import { useTasksStore } from '../stores/tasks'
import { useCoursesStore } from '../stores/courses'
import { Card, ProgressBar, EmptyState } from '../components/ui'
import { resolveAssignmentCourseName, importSourceLabel } from '../utils/assignmentDisplay.js'

const router = useRouter()
const assignmentsStore = useAssignmentsStore()
const tasksStore = useTasksStore()
const coursesStore = useCoursesStore()

const stats = computed(() => [
  {
    label: "Today's Tasks",
    value: tasksStore.todaysTasks.length,
    completed: tasksStore.todaysTasks.filter(t => t.completed).length,
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    bgColor: 'bg-primary-50 dark:bg-primary-900/30',
    iconBg: 'bg-primary-100 dark:bg-primary-800/50',
    textColor: 'text-primary-600 dark:text-primary-400'
  },
  {
    label: 'Upcoming',
    value: assignmentsStore.upcomingAssignments.length,
    subtitle: 'assignments',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    bgColor: 'bg-accent-50 dark:bg-accent-900/30',
    iconBg: 'bg-accent-100 dark:bg-accent-900/40',
    textColor: 'text-accent-700 dark:text-accent-300'
  },
  {
    label: 'Overdue',
    value: tasksStore.overdueTasks.length,
    subtitle: 'tasks',
    icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    bgColor: tasksStore.overdueTasks.length > 0 ? 'bg-danger-50 dark:bg-danger-900/30' : 'bg-gray-50 dark:bg-gray-700/50',
    iconBg: tasksStore.overdueTasks.length > 0 ? 'bg-danger-100 dark:bg-danger-900/50' : 'bg-gray-100 dark:bg-gray-700',
    textColor: tasksStore.overdueTasks.length > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-gray-600 dark:text-gray-400'
  },
])

const todaysTasks = computed(() => tasksStore.todaysTasks.slice(0, 5))
const upcomingDeadlines = computed(() => assignmentsStore.upcomingAssignments.slice(0, 5))

function parseDateLocal(dateString) {
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDate(dateString) {
  const date = parseDateLocal(dateString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getDaysUntil(dateString) {
  const date = parseDateLocal(dateString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24))
}

function deadlineSubtitle(assignment) {
  const course = resolveAssignmentCourseName(assignment, coursesStore.getCourseById)
  const src = importSourceLabel(assignment.importSource)
  if (course && src) return `${course} · ${src}`
  if (course) return course
  if (src) return src
  return 'Course'
}

function getUrgencyClass(dateString) {
  const days = getDaysUntil(dateString)
  if (days < 0) return 'text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/30 ring-1 ring-danger-200 dark:ring-danger-800/60'
  if (days <= 1) return 'text-danger-600 dark:text-danger-400 bg-danger-50 dark:bg-danger-900/30'
  if (days <= 3) return 'text-warning-600 dark:text-warning-400 bg-warning-50 dark:bg-warning-900/30'
  return 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60'
}

function getCourseColor(courseId) {
  const course = coursesStore.getCourseById(courseId)
  return course?.color || { bg: 'bg-gray-100', text: 'text-gray-800' }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Welcome Section -->
    <Card padding="lg" class="relative overflow-hidden border-gray-200/70 !shadow-[0_1px_2px_rgba(28,25,23,0.04),0_8px_24px_-4px_rgba(28,25,23,0.06)]">
      <div class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary-700 via-primary-900 to-primary-800 rounded-l-2xl" aria-hidden="true" />
      <div class="relative pl-4 sm:pl-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
        <div>
          <h2 class="text-[1.75rem] sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">Welcome back</h2>
          <p class="mt-2 text-[15px] text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">
            {{ tasksStore.todaysTasks.length > 0 
              ? `You have ${tasksStore.todaysTasks.filter(t => !t.completed).length} tasks left today — steady progress wins.`
              : "Nothing on the calendar today. A good moment to plan ahead."
            }}
          </p>
        </div>
        <button 
          type="button"
          @click="router.push('/planner')"
          class="flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-900 text-white text-sm font-semibold hover:bg-primary-800 transition-[background-color,transform] duration-200 shadow-sm shadow-primary-900/20 active:scale-[0.98]"
        >
          <svg class="w-[1.125rem] h-[1.125rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Weekly planner
        </button>
      </div>
    </Card>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-4">
      <Card 
        v-for="stat in stats" 
        :key="stat.label"
        padding="md"
        hover
        class="relative overflow-hidden"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {{ stat.completed !== undefined ? `${stat.completed}/${stat.value}` : stat.value }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ stat.label }}</p>
          </div>
          <div :class="[stat.iconBg, 'p-2.5 rounded-xl']">
            <svg 
              :class="[stat.textColor, 'w-5 h-5']"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" :d="stat.icon" />
            </svg>
          </div>
        </div>
        
        <!-- Progress bar for tasks -->
        <div v-if="stat.completed !== undefined && stat.value > 0" class="mt-3">
          <ProgressBar 
            :value="Math.round((stat.completed / stat.value) * 100)" 
            size="sm"
            variant="primary"
          />
        </div>
      </Card>
    </div>

    <!-- Main Content Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Today's Tasks -->
      <Card>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[17px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Today's tasks</h3>
          <router-link
            to="/tasks"
            class="text-[13px] font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-900 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
          >
            View all
            <svg class="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>

        <EmptyState 
          v-if="todaysTasks.length === 0"
          icon="M5 13l4 4L19 7"
          title="No tasks for today"
          description="Add assignments to get tasks scheduled"
          action-label="Add Task"
          @action="router.push('/tasks')"
        />

        <div v-else class="space-y-2">
          <div 
            v-for="task in todaysTasks" 
            :key="task.id"
            class="group flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50/80 dark:hover:bg-gray-700/50 transition-colors cursor-pointer border border-transparent hover:border-gray-100/80 dark:hover:border-gray-700/60"
            @click="tasksStore.toggleTaskComplete(task.id)"
          >
            <button 
              class="flex-shrink-0 w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center"
              :class="task.completed
                ? 'bg-primary-900 border-primary-900 scale-100'
                : 'border-gray-300 dark:border-gray-600 group-hover:border-primary-600/50'"
            >
              <svg v-if="task.completed" class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <div class="flex-1 min-w-0">
              <p
                class="font-medium truncate transition-all"
                :class="task.completed ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'"
              >
                {{ task.title }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400 truncate">{{ task.assignmentTitle }}</p>
            </div>
          </div>
        </div>
      </Card>

      <!-- Upcoming Deadlines -->
      <Card>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[17px] font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Upcoming deadlines</h3>
          <router-link
            to="/assignments"
            class="text-[13px] font-semibold text-gray-600 dark:text-gray-400 hover:text-primary-900 dark:hover:text-primary-400 transition-colors flex items-center gap-1"
          >
            View all
            <svg class="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>

        <EmptyState 
          v-if="upcomingDeadlines.length === 0"
          icon="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          title="No upcoming deadlines"
          description="Add assignments to track deadlines"
          action-label="Add Assignment"
          @action="router.push('/assignments')"
        />

        <div v-else class="space-y-3">
          <div 
            v-for="assignment in upcomingDeadlines" 
            :key="assignment.id"
            class="p-3 rounded-xl border border-gray-100/90 dark:border-gray-700/60 hover:border-gray-200/90 dark:hover:border-gray-600/60 hover:shadow-[0_2px_8px_rgba(28,25,23,0.05)] transition-all"
          >
            <div class="flex items-start justify-between gap-3 mb-2">
              <div class="flex-1 min-w-0">
                <p class="font-medium text-gray-900 dark:text-gray-100 truncate">{{ assignment.title }}</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ deadlineSubtitle(assignment) }}</p>
              </div>
              <span 
                class="text-xs font-medium px-2.5 py-1 rounded-lg whitespace-nowrap"
                :class="getUrgencyClass(assignment.dueDate)"
              >
                {{ formatDate(assignment.dueDate) }}
              </span>
            </div>
            <ProgressBar :value="assignment.progress" size="sm" />
          </div>
        </div>
      </Card>
    </div>

  </div>
</template>
