import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAssignmentsStore } from './assignments'
import { persistTaskToSupabase, deleteTaskFromSupabase } from '../services/taskSync'
import { useToast } from '../composables/useToast'

// Groups are stored locally (not in Supabase) so no DB migration is needed.
// The overlay is a { [taskId]: groupName } map persisted in localStorage and
// merged back onto tasks after every Supabase hydration.
const GROUPS_KEY = 'plannr_task_groups'

function loadGroupsOverlay() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}') }
  catch { return {} }
}

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])
  const loading = ref(false)

  const groupsOverlay = ref(loadGroupsOverlay())

  function saveGroupsOverlay() {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groupsOverlay.value))
  }

  /** Sorted list of all unique group names currently in use. */
  const taskGroups = computed(() =>
    [...new Set(Object.values(groupsOverlay.value).filter(Boolean))].sort()
  )

  /** Local-timezone `YYYY-MM-DD` key  avoid `toISOString` here (UTC drift). */
  function localDateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  /** `{ [yyyy-mm-dd]: Task[] }`  drives the planner calendar grid. */
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
      useToast().error("Couldn't save your task  we'll retry automatically.")
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
    if (newTask.group) {
      groupsOverlay.value[newTask.id] = newTask.group
      saveGroupsOverlay()
    }
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

    if ('group' in updates) {
      if (updates.group) {
        groupsOverlay.value[id] = updates.group
      } else {
        delete groupsOverlay.value[id]
      }
      saveGroupsOverlay()
    }

    void persistAndStamp(tasks.value[index])
  }

  function deleteTask(id) {
    const task = tasks.value.find(t => t.id === id)
    tasks.value = tasks.value.filter(t => t.id !== id)
    delete groupsOverlay.value[id]
    saveGroupsOverlay()
    const dbId = task?.supabaseTaskId || task?.id
    if (dbId) void deleteTaskFromSupabase(dbId)
  }

  /** Rename every task in a group atomically. */
  function renameGroup(oldName, newName) {
    const trimmed = (newName || '').trim()
    if (!trimmed || trimmed === oldName) return
    for (const [taskId, g] of Object.entries(groupsOverlay.value)) {
      if (g === oldName) groupsOverlay.value[taskId] = trimmed
    }
    tasks.value = tasks.value.map(t => t.group === oldName ? { ...t, group: trimmed } : t)
    saveGroupsOverlay()
  }

  /** Remove all group assignments for the given group name. */
  function deleteGroup(name) {
    for (const [taskId, g] of Object.entries(groupsOverlay.value)) {
      if (g === name) delete groupsOverlay.value[taskId]
    }
    tasks.value = tasks.value.map(t => t.group === name ? { ...t, group: null } : t)
    saveGroupsOverlay()
  }

  /**
   * Re-attempt any tasks whose insert never confirmed (offline at create time,
   * or a transient error). Called after hydration; idempotent upsert keyed on
   * id means this can't create duplicates. Silent  it's a background self-heal.
   */
  async function retryPendingPersists() {
    const pendingNow = tasks.value.filter(t => !t.supabaseTaskId)
    for (const t of pendingNow) {
      await persistAndStamp(t, { silent: true })
    }
  }

  /** Wipe all tasks  used when signing out or switching accounts. */
  function clearAll() {
    tasks.value = []
  }

  /**
   * Drop a task locally without touching Supabase. Used by the realtime sync
   * when another instance deletes a task: the row is already gone server-side,
   * so a normal {@link deleteTask} would fire a redundant (and racy) delete.
   * Also keeps hydration's merge from resurrecting it — the merge preserves
   * local tasks absent from the snapshot, so the stale copy must be removed
   * here first. Accepts either the local id or the Supabase row id.
   */
  function removeLocalTask(id) {
    if (!id) return
    tasks.value = tasks.value.filter(t => t.id !== id && t.supabaseTaskId !== id)
    if (groupsOverlay.value[id]) {
      delete groupsOverlay.value[id]
      saveGroupsOverlay()
    }
  }

  /** Replace tasks from Supabase hydration, re-applying the local groups overlay. */
  function hydrateFromSupabase(list) {
    tasks.value = Array.isArray(list)
      ? list.map(t => ({ ...t, group: groupsOverlay.value[t.id] || t.group || null }))
      : []
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
    taskGroups,
    addTask,
    updateTask,
    deleteTask,
    renameGroup,
    deleteGroup,
    retryPendingPersists,
    clearAll,
    removeLocalTask,
    hydrateFromSupabase,
    getTasksByAssignment,
    toggleTaskComplete,
    rescheduleTask,
    getTasksForDateRange,
  }
})
