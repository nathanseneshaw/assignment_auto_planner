/**
 * Tasks Pinia store — the *subtasks* / planner items, distinct from
 * top-level assignments. Each task is scheduled onto a calendar date
 * (`scheduledDate`) and rolls its completion state up to the parent
 * assignment's progress via {@link useAssignmentsStore.updateProgress}.
 *
 * Not currently mirrored to Supabase; tasks live in memory (and via Pinia
 * persistence plugins if added later).
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAssignmentsStore } from './assignments'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])
  const loading = ref(false)

  /** Local-timezone `YYYY-MM-DD` key — avoid `toISOString` here (UTC drift). */
  function localDateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  /** `{ [yyyy-mm-dd]: Task[] }` — drives the planner calendar grid. */
  const tasksByDate = computed(() => {
    const grouped = {}
    tasks.value.forEach(task => {
      const date = task.scheduledDate
      if (!date) return
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(task)
    })
    return grouped
  })

  /** Today's tasks ordered by priority (lower number = higher priority). */
  const todaysTasks = computed(() => {
    const today = localDateKey()
    return tasks.value
      .filter(t => t.scheduledDate === today)
      .sort((a, b) => a.priority - b.priority)
  })

  const incompleteTasks = computed(() => {
    return tasks.value.filter(t => !t.completed)
  })

  /** Past-scheduled but still incomplete tasks. */
  const overdueTasks = computed(() => {
    const today = localDateKey()
    return tasks.value.filter(t => t.scheduledDate < today && !t.completed)
  })

  /**
   * Add a task. Priority defaults to (current length + 1) so new tasks land
   * at the bottom of the day's list until the user reorders them.
   */
  function addTask(task) {
    const newTask = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      completed: false,
      priority: tasks.value.length + 1,
      ...task
    }
    tasks.value.push(newTask)
    return newTask
  }

  /**
   * Patch a task. If `completed` changed, roll the parent assignment's
   * progress percentage so its UI updates in lockstep.
   */
  function updateTask(id, updates) {
    const index = tasks.value.findIndex(t => t.id === id)
    if (index !== -1) {
      tasks.value[index] = { ...tasks.value[index], ...updates }

      if (updates.completed !== undefined) {
        const task = tasks.value[index]
        const assignmentsStore = useAssignmentsStore()
        assignmentsStore.updateProgress(task.assignmentId)
      }
    }
  }

  function deleteTask(id) {
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  /** Wipe all tasks — used when signing out or switching accounts. */
  function clearAll() {
    tasks.value = []
  }

  function getTasksByAssignment(assignmentId) {
    return tasks.value.filter(t => t.assignmentId === assignmentId)
  }

  function toggleTaskComplete(id) {
    const task = tasks.value.find(t => t.id === id)
    if (task) {
      updateTask(id, { completed: !task.completed })
    }
  }

  /** Drag-and-drop helper: move a task to a different calendar date. */
  function rescheduleTask(id, newDate) {
    updateTask(id, { scheduledDate: newDate })
  }

  /** Inclusive `[startDate, endDate]` range query, both `YYYY-MM-DD`. */
  function getTasksForDateRange(startDate, endDate) {
    return tasks.value.filter(t => {
      return t.scheduledDate >= startDate && t.scheduledDate <= endDate
    })
  }

  return {
    tasks,
    loading,
    tasksByDate,
    todaysTasks,
    incompleteTasks,
    overdueTasks,
    addTask,
    updateTask,
    deleteTask,
    clearAll,
    getTasksByAssignment,
    toggleTaskComplete,
    rescheduleTask,
    getTasksForDateRange,
  }
})
