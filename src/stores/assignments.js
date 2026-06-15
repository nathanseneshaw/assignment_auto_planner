/**
 * Assignments Pinia store.
 *
 * Each assignment is keyed by a local UUID (`id`) and may also carry:
 *   - `supabaseAssignmentId` — the server-side row id once persisted.
 *   - `canvasAssignmentId` / `blackboardId` — external LMS identifiers.
 *   - `tasks` — nested subtasks used to compute `progress`.
 *
 * Like courses, mutations attempt a best-effort upsert to Supabase but never
 * block the UI; the background sync composable handles retries / catch-up.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useCoursesStore } from './courses'
import { persistAssignmentToSupabase } from '../services/lmsSupabaseSync'

export const useAssignmentsStore = defineStore('assignments', () => {
  const assignments = ref([])
  const loading = ref(false)
  const error = ref(null)

  /**
   * In-flight best-effort persists (the fire-and-forget writes from
   * add/updateAssignment). Hydration awaits these before snapshotting Supabase
   * so a re-hydration triggered mid-write — e.g. the ICS auto-sync that fires
   * when the browser tab regains focus — can't race the INSERT and drop a row
   * that hasn't landed server-side yet.
   */
  const pendingPersists = new Set()
  function trackPersist(promise) {
    pendingPersists.add(promise)
    promise.finally(() => pendingPersists.delete(promise))
    return promise
  }
  /** Resolve once every in-flight persist has settled (used by hydration). */
  async function flushPendingPersists() {
    await Promise.allSettled([...pendingPersists])
  }

  const assignmentsByDueDate = computed(() => {
    return [...assignments.value].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
  })

  /**
   * Today's date as `YYYY-MM-DD` in the **user's local timezone**. We never use
   * `toISOString()` here because that would shift to UTC and put assignments
   * due today into "yesterday" for anyone west of UTC.
   */
  function localDateKey() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  /** Not-yet-due, still-open assignments sorted by due date. Archived (removed
   *  from feed) items are excluded — they're not actionable. */
  const upcomingAssignments = computed(() => {
    const today = localDateKey()
    return assignmentsByDueDate.value.filter(
      a => a.dueDate >= today && a.status !== 'completed' && a.feedStatus !== 'archived'
    )
  })

  /** Past-due and still incomplete — surfaced as warnings in the UI. Archived
   *  items are excluded so a removed assignment stops nagging. */
  const overdueAssignments = computed(() => {
    const today = localDateKey()
    return assignments.value.filter(
      a => a.dueDate < today && a.status !== 'completed' && a.feedStatus !== 'archived'
    )
  })

  /**
   * Assignments that left their ICS feed (Pillar A): a professor removed them,
   * so they dropped out of the calendar. Kept for the student's record — and
   * their completion still counts toward semester totals — but surfaced
   * separately from the active lists. Most-recently-due first.
   */
  const archivedAssignments = computed(() =>
    [...assignments.value]
      .filter(a => a.feedStatus === 'archived')
      .sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))
  )

  /** Lookup table for course detail pages: `{ [courseId]: Assignment[] }`. */
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

  /**
   * Add a new assignment. Defaults: `status='pending'`, no tasks, 0% progress.
   * Kicks off a best-effort Supabase upsert; failures are silent here and
   * picked up by the background sync.
   */
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

    // Fire-and-forget persist. Requires the parent course to already exist
    // (or to be persistable) — orphan assignments are skipped here. Tracked so
    // hydration can wait for it before re-snapshotting (see flushPendingPersists).
    trackPersist((async () => {
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
    })())

    return newAssignment
  }

  /**
   * Patch an existing assignment by id. Mirrors to Supabase only when the row
   * is already tracked there (either via supabaseAssignmentId or a Canvas/BB id);
   * otherwise the background sync will eventually pick it up.
   */
  function updateAssignment(id, updates) {
    const index = assignments.value.findIndex((a) => a.id === id)
    if (index === -1) return
    assignments.value[index] = { ...assignments.value[index], ...updates }
    const merged = assignments.value[index]
    const hasExt =
      (merged.canvasAssignmentId != null && String(merged.canvasAssignmentId).trim() !== '') ||
      (merged.blackboardId != null && String(merged.blackboardId).trim() !== '')
    if (!merged.supabaseAssignmentId && !hasExt) return

    trackPersist((async () => {
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
    })())
  }

  /** Local-only delete; intentionally does not remove the Supabase row. */
  function deleteAssignment(id) {
    assignments.value = assignments.value.filter(a => a.id !== id)
  }

  /**
   * Replace local state from a Supabase hydration snapshot, but KEEP any
   * optimistic, not-yet-persisted creates (no `supabaseAssignmentId`) so a
   * hydration that races an in-flight create — e.g. the ICS auto-sync on tab
   * refocus — can't wipe the new row before its write lands. Rows that already
   * carry a server id are represented by `list` (or were intentionally deleted
   * server-side, e.g. on feed removal), so we never re-add those.
   *
   * Use {@link clearAll} for sign-out — that path must drop everything.
   */
  function replaceFromHydration(list) {
    const incoming = Array.isArray(list) ? list : []
    const pendingLocal = assignments.value.filter((a) => !a.supabaseAssignmentId)
    assignments.value = [...incoming, ...pendingLocal]
  }

  /** Hard reset of all local state (e.g. on sign-out). */
  function clearAll() {
    assignments.value = []
  }

  function getAssignmentById(id) {
    return assignments.value.find(a => a.id === id)
  }

  /**
   * Recompute the `progress` percentage from the assignment's subtasks. When
   * every subtask is completed, also flip the assignment's status to completed.
   */
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

  /** Force an assignment to completed regardless of subtask state. */
  function markAssignmentComplete(id) {
    updateAssignment(id, {
      status: 'completed',
      progress: 100,
      completedAt: new Date().toISOString()
    })
  }

  /**
   * Re-open an assignment. Re-derives progress from subtasks so the UI does
   * not jump from 100% to 0% if some subtasks remain complete.
   */
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
    archivedAssignments,
    assignmentsByCourse,
    addAssignment,
    updateAssignment,
    deleteAssignment,
    replaceFromHydration,
    clearAll,
    flushPendingPersists,
    getAssignmentById,
    updateProgress,
    markAssignmentComplete,
    markAssignmentIncomplete,
  }
})
