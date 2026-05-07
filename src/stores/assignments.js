import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useCoursesStore } from './courses'
import { persistAssignmentToSupabase } from '../services/lmsSupabaseSync'

export const useAssignmentsStore = defineStore('assignments', () => {
  const assignments = ref([])
  const loading = ref(false)
  const error = ref(null)

  const assignmentsByDueDate = computed(() => {
    return [...assignments.value].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
  })

  const upcomingAssignments = computed(() => {
    const now = new Date()
    return assignmentsByDueDate.value.filter(a => new Date(a.dueDate) >= now && a.status !== 'completed')
  })

  const overdueAssignments = computed(() => {
    const now = new Date()
    return assignments.value.filter(a => new Date(a.dueDate) < now && a.status !== 'completed')
  })

  const assignmentsByCourse = computed(() => {
    const grouped = {}
    assignments.value.forEach(assignment => {
      if (!grouped[assignment.courseId]) {
        grouped[assignment.courseId] = []
      }
      grouped[assignment.courseId].push(assignment)
    })
    return grouped
  })

  function addAssignment(assignment) {
    const newAssignment = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      tasks: [],
      progress: 0,
      ...assignment
    }
    assignments.value.push(newAssignment)

    void (async () => {
      const coursesStore = useCoursesStore()
      const parent = coursesStore.getCourseById(assignment.courseId)
      if (!parent) return

      const cid = await coursesStore.ensureSupabaseCourseRow(parent.id)
      if (!cid) return

      const aid = await persistAssignmentToSupabase(newAssignment, cid)
      if (aid) {
        const idx = assignments.value.findIndex((a) => a.id === newAssignment.id)
        if (idx !== -1) {
          assignments.value[idx] = { ...assignments.value[idx], supabaseAssignmentId: aid }
        }
      }
    })()

    return newAssignment
  }

  function updateAssignment(id, updates) {
    const index = assignments.value.findIndex((a) => a.id === id)
    if (index === -1) return
    assignments.value[index] = { ...assignments.value[index], ...updates }
    const merged = assignments.value[index]
    const hasExt =
      (merged.canvasAssignmentId != null && String(merged.canvasAssignmentId).trim() !== '') ||
      (merged.blackboardId != null && String(merged.blackboardId).trim() !== '')
    if (!merged.supabaseAssignmentId && !hasExt) return

    void (async () => {
      const coursesStore = useCoursesStore()
      const parent = coursesStore.getCourseById(merged.courseId)
      if (!parent?.supabaseCourseId) return
      const aid = await persistAssignmentToSupabase(merged, parent.supabaseCourseId)
      if (aid) {
        const idx = assignments.value.findIndex((a) => a.id === id)
        if (idx !== -1 && !assignments.value[idx].supabaseAssignmentId) {
          assignments.value[idx] = { ...assignments.value[idx], supabaseAssignmentId: aid }
        }
      }
    })()
  }

  function deleteAssignment(id) {
    assignments.value = assignments.value.filter(a => a.id !== id)
  }

  /** Full replace (e.g. Supabase hydration). */
  function replaceFromHydration(list) {
    assignments.value = Array.isArray(list) ? list : []
  }

  function getAssignmentById(id) {
    return assignments.value.find(a => a.id === id)
  }

  function updateProgress(id) {
    const assignment = getAssignmentById(id)
    if (assignment && assignment.tasks.length > 0) {
      const completedTasks = assignment.tasks.filter(t => t.completed).length
      assignment.progress = Math.round((completedTasks / assignment.tasks.length) * 100)
      if (assignment.progress === 100) {
        assignment.status = 'completed'
      }
    }
  }

  function markAssignmentComplete(id) {
    updateAssignment(id, {
      status: 'completed',
      progress: 100,
      completedAt: new Date().toISOString()
    })
  }

  function markAssignmentIncomplete(id) {
    const assignment = getAssignmentById(id)
    if (!assignment) return
    let progress = 0
    if (assignment.tasks?.length > 0) {
      const completedTasks = assignment.tasks.filter(t => t.completed).length
      progress = Math.round((completedTasks / assignment.tasks.length) * 100)
    }
    updateAssignment(id, {
      status: 'pending',
      progress,
      completedAt: null
    })
  }

  return {
    assignments,
    loading,
    error,
    assignmentsByDueDate,
    upcomingAssignments,
    overdueAssignments,
    assignmentsByCourse,
    addAssignment,
    updateAssignment,
    deleteAssignment,
    replaceFromHydration,
    getAssignmentById,
    updateProgress,
    markAssignmentComplete,
    markAssignmentIncomplete,
  }
})
