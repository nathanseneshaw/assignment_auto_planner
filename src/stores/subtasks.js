import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

export const useSubtasksStore = defineStore('subtasks', () => {
  const subtasks = ref([])

  /** `{ [taskId]: { total, completed } }` — drives progress indicators. */
  const subtaskCountByTask = computed(() => {
    const map = {}
    for (const s of subtasks.value) {
      if (!map[s.taskId]) map[s.taskId] = { total: 0, completed: 0 }
      map[s.taskId].total++
      if (s.completed) map[s.taskId].completed++
    }
    return map
  })

  function getSubtasksForTask(taskId) {
    return subtasks.value
      .filter(s => s.taskId === taskId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  }

  async function persistSubtask(subtask) {
    if (!isSupabaseConfigured || !supabase) return
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return
    try {
      await supabase.from('subtasks').upsert({
        id: subtask.id,
        task_id: subtask.taskId,
        user_id: user.id,
        title: subtask.title,
        completed: subtask.completed,
        sort_order: subtask.sortOrder ?? 0,
      }, { onConflict: 'id' })
    } catch (e) {
      console.warn('[subtasksStore] persistSubtask', e.message || e)
    }
  }

  async function addSubtask(taskId, title) {
    const trimmed = (title || '').trim()
    if (!trimmed) return null
    const newSubtask = {
      id: crypto.randomUUID(),
      taskId,
      title: trimmed,
      completed: false,
      sortOrder: getSubtasksForTask(taskId).length,
      createdAt: new Date().toISOString(),
    }
    subtasks.value.push(newSubtask)
    await persistSubtask(newSubtask)
    return newSubtask
  }

  async function toggleSubtask(id) {
    const idx = subtasks.value.findIndex(s => s.id === id)
    if (idx === -1) return
    subtasks.value[idx] = { ...subtasks.value[idx], completed: !subtasks.value[idx].completed }
    await persistSubtask(subtasks.value[idx])
  }

  async function deleteSubtask(id) {
    subtasks.value = subtasks.value.filter(s => s.id !== id)
    if (!isSupabaseConfigured || !supabase) return
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return
    try {
      await supabase.from('subtasks').delete().eq('id', id).eq('user_id', user.id)
    } catch (e) {
      console.warn('[subtasksStore] deleteSubtask', e.message || e)
    }
  }

  async function updateSubtaskTitle(id, title) {
    const trimmed = (title || '').trim()
    if (!trimmed) return
    const idx = subtasks.value.findIndex(s => s.id === id)
    if (idx === -1) return
    subtasks.value[idx] = { ...subtasks.value[idx], title: trimmed }
    await persistSubtask(subtasks.value[idx])
  }

  /** Replace subtasks from Supabase hydration. */
  function hydrateFromSupabase(list) {
    subtasks.value = (list || []).map(row => ({
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      completed: row.completed,
      sortOrder: row.sort_order ?? 0,
      createdAt: row.created_at,
    }))
  }

  /** Drop all subtasks for a parent task locally (used when a task is deleted). */
  function removeSubtasksForTask(taskId) {
    subtasks.value = subtasks.value.filter(s => s.taskId !== taskId)
  }

  function clearAll() {
    subtasks.value = []
  }

  return {
    subtasks,
    subtaskCountByTask,
    getSubtasksForTask,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    updateSubtaskTitle,
    hydrateFromSupabase,
    removeSubtasksForTask,
    clearAll,
  }
})
