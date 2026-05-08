import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAssignmentsStore } from './assignments'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])
  const loading = ref(false)

  function localDateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

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

  const todaysTasks = computed(() => {
    const today = localDateKey()
    return tasks.value
      .filter(t => t.scheduledDate === today)
      .sort((a, b) => a.priority - b.priority)
  })

  const incompleteTasks = computed(() => {
    return tasks.value.filter(t => !t.completed)
  })

  const overdueTasks = computed(() => {
    const today = localDateKey()
    return tasks.value.filter(t => t.scheduledDate < today && !t.completed)
  })

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

  function rescheduleTask(id, newDate) {
    updateTask(id, { scheduledDate: newDate })
  }

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
