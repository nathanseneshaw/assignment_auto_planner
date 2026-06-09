import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAssignmentsStore } from './assignments'
import { persistTaskToSupabase, deleteTaskFromSupabase } from '../services/taskSync'
import { useToast } from '../composables/useToast'

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
      if (!grouped[date]) grouped[date] = []
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

  const incompleteTasks = computed(() => tasks.value.filter(t => !t.completed))

  /** Past-scheduled but still incomplete tasks. */
  const overdueTasks = computed(() => {
    const today = localDateKey()
    return tasks.value.filter(t => t.scheduledDate && t.scheduledDate < today && !t.completed)
  })

  /**
   * Persist a task and stamp the confirmed Supabase id back onto the local row.
   * Idempotent (upsert keyed on the task's own id), so it's safe to call on
   * create, update, and retry. `silent` suppresses the failure toast for
   * background retries. Returns true when the row is confirmed in Supabase.
   */
  async function persistAndStamp(task, { silent = false } = {}) {
    const result = await persistTaskToSupabase(task)
    if (result.status === 'ok') {
      const idx = tasks.value.findIndex(t => t.id === task.id)
      if (idx !== -1 && tasks.value[idx].supabaseTaskId !== result.id) {
        tasks.value[idx] = { ...tasks.value[idx], supabaseTaskId: result.id }
      }
      return true
    }
    if (result.status === 'error' && !silent) {
      useToast().error("Couldn't save your task — we'll retry automatically.")
    }
    return false // 'skipped' (local-only mode) or 'error'
  }

  /**
   * Add a task. Priority defaults to (current length + 1) so new tasks land
   * at the bottom of the day's list until the user reorders them. The local
   * `id` is also used as the Supabase primary key so the insert is idempotent
   * and can't duplicate on a concurrent hydration.
   */
  function addTask(task) {
    const newTask = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      completed: false,
      priority: tasks.value.length + 1,
      priorityLevel: 'normal',
      supabaseTaskId: null,
      ...task,
    }
    tasks.value.push(newTask)
    void persistAndStamp(newTask)
    return newTask
  }

  /**
   * Patch a task. If `completed` changed, roll the parent assignment's
   * progress percentage so its UI updates in lockstep. Always persists (upsert
   * is idempotent) so edits made before the initial insert confirms aren't lost.
   */
  function updateTask(id, updates) {
    const index = tasks.value.findIndex(t => t.id === id)
    if (index === -1) return
    tasks.value[index] = { ...tasks.value[index], ...updates }

    if (updates.completed !== undefined) {
      useAssignmentsStore().updateProgress(tasks.value[index].assignmentId)
    }

    void persistAndStamp(tasks.value[index])
  }

  function deleteTask(id) {
    const task = tasks.value.find(t => t.id === id)
    tasks.value = tasks.value.filter(t => t.id !== id)
    // id === the DB primary key, so delete by it whether or not the insert was
    // confirmed (covers a row that persisted but never got stamped locally).
    const dbId = task?.supabaseTaskId || task?.id
    if (dbId) void deleteTaskFromSupabase(dbId)
  }

  /**
   * Re-attempt any tasks whose insert never confirmed (offline at create time,
   * or a transient error). Called after hydration; idempotent upsert keyed on
   * id means this can't create duplicates. Silent — it's a background self-heal.
   */
  async function retryPendingPersists() {
    const pendingNow = tasks.value.filter(t => !t.supabaseTaskId)
    for (const t of pendingNow) {
      await persistAndStamp(t, { silent: true })
    }
  }

  /** Wipe all tasks — used when signing out or switching accounts. */
  function clearAll() {
    tasks.value = []
  }

  /** Replace tasks from Supabase hydration. */
  function hydrateFromSupabase(list) {
    tasks.value = Array.isArray(list) ? list : []
  }

  function getTasksByAssignment(assignmentId) {
    return tasks.value.filter(t => t.assignmentId === assignmentId)
  }

  function toggleTaskComplete(id) {
    const task = tasks.value.find(t => t.id === id)
    if (task) updateTask(id, { completed: !task.completed })
  }

  /** Drag-and-drop helper: move a task to a different calendar date. */
  function rescheduleTask(id, newDate) {
    updateTask(id, { scheduledDate: newDate })
  }

  /** Inclusive `[startDate, endDate]` range query, both `YYYY-MM-DD`. */
  function getTasksForDateRange(startDate, endDate) {
    return tasks.value.filter(t => t.scheduledDate >= startDate && t.scheduledDate <= endDate)
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
    retryPendingPersists,
    clearAll,
    hydrateFromSupabase,
    getTasksByAssignment,
    toggleTaskComplete,
    rescheduleTask,
    getTasksForDateRange,
  }
})
