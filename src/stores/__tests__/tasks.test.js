import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useTasksStore } from '../tasks.js'
import { useAssignmentsStore } from '../assignments.js'
import { useSubtasksStore } from '../subtasks.js'

vi.mock('../../services/taskSync', () => ({
  persistTaskToSupabase: vi.fn().mockResolvedValue({ status: 'ok', id: 'sb-task-id' }),
  deleteTaskFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

// assignments + courses stores are pulled in transitively; mock their I/O so no network calls fire
vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-assign-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-course-id'),
  deleteCourseAndAssignmentsFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

// deleteTask cascades into the subtasks store, which talks to Supabase directly.
// Local-only mode keeps that cascade purely in-memory.
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))

// persistAndStamp surfaces write failures through a toast; capture it.
const toast = vi.hoisted(() => ({
  show: vi.fn(), remove: vi.fn(),
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
}))
vi.mock('../../composables/useToast', () => ({ useToast: () => toast }))

import { persistTaskToSupabase, deleteTaskFromSupabase } from '../../services/taskSync'

/** localStorage key of the pre-Supabase group overlay that hydration migrates. */
const LEGACY_GROUPS_KEY = 'plannr_task_groups'

/**
 * A wall-clock instant on 2026-06-15 at which this machine's LOCAL calendar
 * date differs from the UTC date, so the date-bucketing tests actually
 * discriminate between the store's `localDateKey()` and a `toISOString()`
 * implementation. Null on a machine running at UTC, where no such instant exists.
 */
function utcStraddlingInstant() {
  const offsetMin = new Date(2026, 5, 15, 12, 0, 0).getTimezoneOffset()
  if (offsetMin > 0) return new Date(2026, 5, 15, 23, 30, 0) // behind UTC: UTC already rolled to Jun 16
  if (offsetMin < 0) return new Date(2026, 5, 15, 0, 30, 0)  // ahead of UTC: UTC still on Jun 14
  return null
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // clearAllMocks wipes call history but NOT implementations, so re-assert the
  // defaults here — otherwise a per-test override leaks into the next test.
  persistTaskToSupabase.mockResolvedValue({ status: 'ok', id: 'sb-task-id' })
  deleteTaskFromSupabase.mockResolvedValue(undefined)
})

// ── addTask ───────────────────────────────────────────────────────────────────

describe('addTask', () => {
  it('adds a task and returns it', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Write lab report', scheduledDate: '2026-09-05' })
    expect(store.tasks).toHaveLength(1)
    expect(task.title).toBe('Write lab report')
  })

  it('sets default fields (id, completed=false, priority)', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Review notes' })
    expect(task.id).toBeDefined()
    expect(task.completed).toBe(false)
    expect(task.priority).toBe(1) // first task → length was 0, priority = 1
  })

  it('assigns incrementing priority based on current list length', () => {
    const store = useTasksStore()
    const t1 = store.addTask({ title: 'A' })
    const t2 = store.addTask({ title: 'B' })
    const t3 = store.addTask({ title: 'C' })
    expect(t1.priority).toBe(1)
    expect(t2.priority).toBe(2)
    expect(t3.priority).toBe(3)
  })

  it('caller-supplied fields override defaults', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Override', priority: 99, completed: true })
    expect(task.priority).toBe(99)
    expect(task.completed).toBe(true)
  })

  it('calls persistTaskToSupabase and patches supabaseTaskId after flush', async () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Persist me' })
    await flushPromises()
    expect(persistTaskToSupabase).toHaveBeenCalledWith(expect.objectContaining({ title: 'Persist me' }))
    expect(store.tasks[0].supabaseTaskId).toBe('sb-task-id')
    expect(store.tasks[0].id).toBe(task.id) // row is the same task
  })
})

// ── updateTask ────────────────────────────────────────────────────────────────

describe('updateTask', () => {
  it('patches an existing task', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Original' })
    store.updateTask(task.id, { title: 'Updated' })
    expect(store.tasks[0].title).toBe('Updated')
  })

  it('does nothing for an unknown id', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A' })
    store.updateTask('non-existent-id', { title: 'Should not apply' })
    expect(store.tasks[0].title).toBe('A')
  })

  it('preserves other fields when patching', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Keep me', priority: 5 })
    store.updateTask(task.id, { title: 'Changed' })
    expect(store.tasks[0].priority).toBe(5)
  })
})

// ── deleteTask ────────────────────────────────────────────────────────────────

describe('deleteTask', () => {
  it('removes the task from the list', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Delete me' })
    store.deleteTask(task.id)
    expect(store.tasks).toHaveLength(0)
  })

  it('only removes the targeted task', () => {
    const store = useTasksStore()
    const t1 = store.addTask({ title: 'Keep' })
    const t2 = store.addTask({ title: 'Remove' })
    store.deleteTask(t2.id)
    expect(store.tasks).toHaveLength(1)
    expect(store.tasks[0].id).toBe(t1.id)
  })

  it('calls deleteTaskFromSupabase when supabaseTaskId exists', async () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Persisted', supabaseTaskId: 'sb-123' })
    store.deleteTask(task.id)
    await flushPromises()
    expect(deleteTaskFromSupabase).toHaveBeenCalledWith('sb-123')
  })

  it('calls deleteTaskFromSupabase with task.id as fallback when supabaseTaskId is null', async () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Local only' })
    store.deleteTask(task.id)
    await flushPromises()
    expect(deleteTaskFromSupabase).toHaveBeenCalledWith(task.id)
  })
})

// ── toggleTaskComplete ────────────────────────────────────────────────────────

describe('toggleTaskComplete', () => {
  it('flips completed from false to true', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Toggle me' })
    store.toggleTaskComplete(task.id)
    expect(store.tasks[0].completed).toBe(true)
  })

  it('flips completed from true to false', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Toggle me', completed: true })
    store.toggleTaskComplete(task.id)
    expect(store.tasks[0].completed).toBe(false)
  })
})

// ── rescheduleTask ────────────────────────────────────────────────────────────

describe('rescheduleTask', () => {
  it('updates scheduledDate', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Move me', scheduledDate: '2026-09-01' })
    store.rescheduleTask(task.id, '2026-09-15')
    expect(store.tasks[0].scheduledDate).toBe('2026-09-15')
  })
})

// ── clearAll / hydrateFromSupabase ────────────────────────────────────────────

describe('clearAll', () => {
  it('empties the task list', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    store.clearAll()
    expect(store.tasks).toHaveLength(0)
  })
})

describe('hydrateFromSupabase', () => {
  it('replaces the list with the provided array', () => {
    const store = useTasksStore()
    store.addTask({ title: 'Old' })
    store.hydrateFromSupabase([{ id: 'h1', title: 'Hydrated' }])
    expect(store.tasks).toHaveLength(1)
    expect(store.tasks[0].title).toBe('Hydrated')
  })

  it('accepts an empty array', () => {
    const store = useTasksStore()
    store.addTask({ title: 'Old' })
    store.hydrateFromSupabase([])
    expect(store.tasks).toHaveLength(0)
  })

  it('treats non-array input as an empty list', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase(null)
    expect(store.tasks).toHaveLength(0)
  })
})

// ── lookup helpers ────────────────────────────────────────────────────────────

describe('getTasksByAssignment', () => {
  it('returns only tasks matching the given assignmentId', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', assignmentId: 'assign-1' })
    store.addTask({ title: 'B', assignmentId: 'assign-2' })
    store.addTask({ title: 'C', assignmentId: 'assign-1' })
    expect(store.getTasksByAssignment('assign-1')).toHaveLength(2)
    expect(store.getTasksByAssignment('assign-2')).toHaveLength(1)
  })

  it('returns empty array when no matches', () => {
    const store = useTasksStore()
    expect(store.getTasksByAssignment('assign-none')).toHaveLength(0)
  })
})

describe('getTasksForDateRange', () => {
  it('returns tasks within the inclusive date range', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Before', scheduledDate: '2026-09-01' },
      { id: '2', title: 'In range start', scheduledDate: '2026-09-05' },
      { id: '3', title: 'In range end', scheduledDate: '2026-09-10' },
      { id: '4', title: 'After', scheduledDate: '2026-09-15' },
    ])
    const result = store.getTasksForDateRange('2026-09-05', '2026-09-10')
    expect(result).toHaveLength(2)
    expect(result.map(t => t.title)).toEqual(expect.arrayContaining(['In range start', 'In range end']))
  })
})

// ── computed properties ───────────────────────────────────────────────────────

describe('tasksByDate', () => {
  it('groups tasks by scheduledDate', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'A', scheduledDate: '2026-09-01' },
      { id: '2', title: 'B', scheduledDate: '2026-09-01' },
      { id: '3', title: 'C', scheduledDate: '2026-09-02' },
    ])
    expect(store.tasksByDate['2026-09-01']).toHaveLength(2)
    expect(store.tasksByDate['2026-09-02']).toHaveLength(1)
  })

  it('omits tasks without a scheduledDate', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: '1', title: 'No date' }])
    expect(Object.keys(store.tasksByDate)).toHaveLength(0)
  })
})

describe('incompleteTasks', () => {
  it('excludes completed tasks', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Done', completed: true },
      { id: '2', title: 'Pending', completed: false },
    ])
    expect(store.incompleteTasks).toHaveLength(1)
    expect(store.incompleteTasks[0].title).toBe('Pending')
  })
})

describe('overdueTasks', () => {
  it('returns past-scheduled incomplete tasks', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Overdue', scheduledDate: '2020-01-01', completed: false },
      { id: '2', title: 'Future', scheduledDate: '2099-12-31', completed: false },
      { id: '3', title: 'Past but done', scheduledDate: '2020-01-02', completed: true },
    ])
    const overdue = store.overdueTasks
    expect(overdue).toHaveLength(1)
    expect(overdue[0].title).toBe('Overdue')
  })
})

// ── todaysTasks ───────────────────────────────────────────────────────────────

describe('todaysTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)) // June 15 2026 noon local
  })
  afterEach(() => vi.useRealTimers())

  it('returns only tasks scheduled for today, sorted by priority', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Today low priority', scheduledDate: '2026-06-15', priority: 2 },
      { id: '2', title: 'Today high priority', scheduledDate: '2026-06-15', priority: 1 },
      { id: '3', title: 'Tomorrow', scheduledDate: '2026-06-16', priority: 1 },
    ])
    const today = store.todaysTasks
    expect(today).toHaveLength(2)
    expect(today[0].title).toBe('Today high priority')
    expect(today[1].title).toBe('Today low priority')
  })

  it('returns empty when nothing is scheduled today', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: '1', title: 'Yesterday', scheduledDate: '2026-06-14' }])
    expect(store.todaysTasks).toHaveLength(0)
  })
})

// ── taskGroups ────────────────────────────────────────────────────────────────

describe('taskGroups', () => {
  it('returns sorted unique group names in use', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Zebra' })
    store.addTask({ title: 'B', group: 'Alpha' })
    store.addTask({ title: 'C', group: 'Alpha' })
    expect(store.taskGroups).toEqual(['Alpha', 'Zebra'])
  })

  it('excludes tasks with no group', () => {
    const store = useTasksStore()
    store.addTask({ title: 'Ungrouped' })
    expect(store.taskGroups).toHaveLength(0)
  })
})

// ── renameGroup ───────────────────────────────────────────────────────────────

describe('renameGroup', () => {
  it('renames the group across all matching tasks', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Old Name' })
    store.addTask({ title: 'B', group: 'Old Name' })
    store.addTask({ title: 'C', group: 'Other' })
    store.renameGroup('Old Name', 'New Name')
    const groups = store.tasks.map(t => t.group)
    expect(groups.filter(g => g === 'New Name')).toHaveLength(2)
    expect(groups.filter(g => g === 'Old Name')).toHaveLength(0)
    expect(groups.filter(g => g === 'Other')).toHaveLength(1)
  })

  it('does nothing when the new name is blank', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Keep' })
    store.renameGroup('Keep', '   ')
    expect(store.tasks[0].group).toBe('Keep')
  })

  it('does nothing when new name equals old name', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Same' })
    store.renameGroup('Same', 'Same')
    expect(store.tasks[0].group).toBe('Same')
  })
})

// ── deleteGroup ───────────────────────────────────────────────────────────────

describe('deleteGroup', () => {
  it('clears the group from all matching tasks', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Remove Me' })
    store.addTask({ title: 'B', group: 'Remove Me' })
    store.addTask({ title: 'C', group: 'Keep' })
    store.deleteGroup('Remove Me')
    expect(store.tasks.filter(t => t.group === 'Remove Me')).toHaveLength(0)
    expect(store.tasks.find(t => t.title === 'C')?.group).toBe('Keep')
  })

  it('leaves unrelated groups untouched', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Unrelated' })
    store.deleteGroup('Gone')
    expect(store.tasks[0].group).toBe('Unrelated')
  })
})

// ── removeLocalTask ───────────────────────────────────────────────────────────

describe('removeLocalTask', () => {
  it('removes a task by its local id', () => {
    const store = useTasksStore()
    const t = store.addTask({ title: 'Remove by local id' })
    store.removeLocalTask(t.id)
    expect(store.tasks).toHaveLength(0)
  })

  it('removes a task by its supabaseTaskId', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'local-1', title: 'From Supabase', supabaseTaskId: 'sb-abc' }])
    store.removeLocalTask('sb-abc')
    expect(store.tasks).toHaveLength(0)
  })

  it('is a no-op for null', () => {
    const store = useTasksStore()
    store.addTask({ title: 'Stay' })
    store.removeLocalTask(null)
    expect(store.tasks).toHaveLength(1)
  })

  it('is a no-op for an unknown id', () => {
    const store = useTasksStore()
    store.addTask({ title: 'Stay' })
    store.removeLocalTask('does-not-exist')
    expect(store.tasks).toHaveLength(1)
  })
})

// ── hydrateFromSupabase (groups from DB) ─────────────────────────────────────

describe('hydrateFromSupabase (groups from DB)', () => {
  it('preserves a group carried on the DB task row', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'h1', title: 'Grouped', group: 'Study' }])
    expect(store.tasks[0].group).toBe('Study')
  })

  it('uses null when the DB task has no group', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'x', title: 'No group', supabaseTaskId: 'sb-x' }])
    expect(store.tasks[0].group).toBeNull()
  })
})

// ── addTask defaults ──────────────────────────────────────────────────────────

describe('addTask defaults', () => {
  it('starts with no Supabase id, no group and normal priority level', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Fresh' })
    expect(task.supabaseTaskId).toBeNull()
    expect(task.group).toBeNull()
    expect(task.priorityLevel).toBe('normal')
  })

  it('records createdAt as the current time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
    try {
      const store = useTasksStore()
      expect(store.addTask({ title: 'Stamped' }).createdAt)
        .toBe(new Date(2026, 5, 15, 12, 0, 0).toISOString())
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── persist outcomes (persistAndStamp) ────────────────────────────────────────

describe('persist outcomes', () => {
  it('shows a failure toast and leaves supabaseTaskId null when the write errors', async () => {
    persistTaskToSupabase.mockResolvedValue({ status: 'error', error: 'offline' })
    const store = useTasksStore()
    store.addTask({ title: 'Fails to save' })
    await flushPromises()
    expect(toast.error).toHaveBeenCalledOnce()
    expect(store.tasks[0].supabaseTaskId).toBeNull()
  })

  it('stays quiet in local-only mode (status "skipped")', async () => {
    persistTaskToSupabase.mockResolvedValue({ status: 'skipped' })
    const store = useTasksStore()
    store.addTask({ title: 'No backend' })
    await flushPromises()
    expect(toast.error).not.toHaveBeenCalled()
    expect(store.tasks[0].supabaseTaskId).toBeNull()
  })

  it('does not toast on a successful write', async () => {
    const store = useTasksStore()
    store.addTask({ title: 'Saves fine' })
    await flushPromises()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('updateTask persists the merged row, not just the patch', async () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Original', scheduledDate: '2026-09-05' })
    await flushPromises()
    persistTaskToSupabase.mockClear()
    store.updateTask(task.id, { title: 'Renamed' })
    await flushPromises()
    expect(persistTaskToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, title: 'Renamed', scheduledDate: '2026-09-05' }),
    )
  })
})

// ── retryPendingPersists ──────────────────────────────────────────────────────

describe('retryPendingPersists', () => {
  it('retries only the tasks that never got a Supabase id', async () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: 'a', title: 'Confirmed', supabaseTaskId: 'sb-a' },
      { id: 'b', title: 'Never landed', supabaseTaskId: null },
    ])
    await store.retryPendingPersists()
    expect(persistTaskToSupabase).toHaveBeenCalledOnce()
    expect(persistTaskToSupabase).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('stamps the confirmed id onto the retried task', async () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'b', title: 'Never landed' }])
    await store.retryPendingPersists()
    expect(store.tasks[0].supabaseTaskId).toBe('sb-task-id')
  })

  it('writes nothing when every task is already confirmed', async () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'a', title: 'Confirmed', supabaseTaskId: 'sb-a' }])
    await store.retryPendingPersists()
    expect(persistTaskToSupabase).not.toHaveBeenCalled()
  })

  it('is silent — a failed retry does not toast the user', async () => {
    persistTaskToSupabase.mockResolvedValue({ status: 'error', error: 'still offline' })
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'b', title: 'Never landed' }])
    await store.retryPendingPersists()
    expect(persistTaskToSupabase).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

// ── updateTask → assignment progress ──────────────────────────────────────────

describe('updateTask assignment progress side-effect', () => {
  it('rolls the parent assignment progress when completed changes', () => {
    const assignments = useAssignmentsStore()
    assignments.updateProgress = vi.fn()
    const store = useTasksStore()
    const task = store.addTask({ title: 'Step 1', assignmentId: 'assign-1' })
    store.updateTask(task.id, { completed: true })
    expect(assignments.updateProgress).toHaveBeenCalledWith('assign-1')
  })

  it('leaves the assignment alone when completed is not part of the patch', () => {
    const assignments = useAssignmentsStore()
    assignments.updateProgress = vi.fn()
    const store = useTasksStore()
    const task = store.addTask({ title: 'Step 1', assignmentId: 'assign-1' })
    store.updateTask(task.id, { title: 'Renamed' })
    expect(assignments.updateProgress).not.toHaveBeenCalled()
  })

  it('fires on toggleTaskComplete too', () => {
    const assignments = useAssignmentsStore()
    assignments.updateProgress = vi.fn()
    const store = useTasksStore()
    const task = store.addTask({ title: 'Step 1', assignmentId: 'assign-1' })
    store.toggleTaskComplete(task.id)
    expect(assignments.updateProgress).toHaveBeenCalledWith('assign-1')
  })

  it('recomputes the real assignment percentage end to end', () => {
    const assignments = useAssignmentsStore()
    const assignment = assignments.addAssignment({
      title: 'Essay',
      tasks: [{ id: 'x', completed: true }, { id: 'y', completed: false }],
    })
    const store = useTasksStore()
    const task = store.addTask({ title: 'Step 1', assignmentId: assignment.id })
    store.updateTask(task.id, { completed: true })
    expect(assignments.getAssignmentById(assignment.id).progress).toBe(50)
  })
})

// ── deleteTask → subtask cascade ──────────────────────────────────────────────

describe('deleteTask subtask cascade', () => {
  it('drops the deleted task\'s subtasks and keeps the others', async () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Parent' })
    const subtasks = useSubtasksStore()
    await subtasks.addSubtask(task.id, 'Child A')
    await subtasks.addSubtask('other-task', 'Child B')
    store.deleteTask(task.id)
    expect(subtasks.subtasks.map(s => s.title)).toEqual(['Child B'])
  })

  it('does not issue a remote delete for an unknown id', () => {
    const store = useTasksStore()
    store.addTask({ title: 'Untouched' })
    store.deleteTask('ghost')
    expect(deleteTaskFromSupabase).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(1)
  })
})

// ── local-only removals ───────────────────────────────────────────────────────

describe('local-only removals', () => {
  it('removeLocalTask never issues a remote delete', () => {
    const store = useTasksStore()
    const task = store.addTask({ title: 'Deleted elsewhere' })
    store.removeLocalTask(task.id)
    expect(deleteTaskFromSupabase).not.toHaveBeenCalled()
  })

  it('clearAll never issues a remote delete', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A' })
    store.addTask({ title: 'B' })
    store.clearAll()
    expect(deleteTaskFromSupabase).not.toHaveBeenCalled()
  })

  it('removeLocalTask only drops the matching row', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: 'l1', title: 'Target', supabaseTaskId: 'sb-1' },
      { id: 'l2', title: 'Keep', supabaseTaskId: 'sb-2' },
    ])
    store.removeLocalTask('sb-1')
    expect(store.tasks.map(t => t.id)).toEqual(['l2'])
  })
})

// ── group persistence ─────────────────────────────────────────────────────────

describe('group persistence', () => {
  it('renameGroup trims the new name', () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Old' })
    store.renameGroup('Old', '   Trimmed   ')
    expect(store.tasks[0].group).toBe('Trimmed')
  })

  it('renameGroup persists exactly the rows it changed', async () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Old' })
    store.addTask({ title: 'B', group: 'Old' })
    store.addTask({ title: 'C', group: 'Other' })
    await flushPromises()
    persistTaskToSupabase.mockClear()

    store.renameGroup('Old', 'New')
    await flushPromises()
    expect(persistTaskToSupabase).toHaveBeenCalledTimes(2)
    const persistedTitles = persistTaskToSupabase.mock.calls.map(([t]) => t.title).sort()
    expect(persistedTitles).toEqual(['A', 'B'])
    expect(persistTaskToSupabase.mock.calls.every(([t]) => t.group === 'New')).toBe(true)
  })

  it('renameGroup writes nothing when the name is blank', async () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Old' })
    await flushPromises()
    persistTaskToSupabase.mockClear()
    store.renameGroup('Old', '  ')
    await flushPromises()
    expect(persistTaskToSupabase).not.toHaveBeenCalled()
  })

  it('deleteGroup persists each cleared row', async () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Gone' })
    store.addTask({ title: 'B', group: 'Gone' })
    await flushPromises()
    persistTaskToSupabase.mockClear()

    store.deleteGroup('Gone')
    await flushPromises()
    expect(persistTaskToSupabase).toHaveBeenCalledTimes(2)
    expect(persistTaskToSupabase.mock.calls.every(([t]) => t.group === null)).toBe(true)
  })

  it('deleteGroup writes nothing when no task carries the group', async () => {
    const store = useTasksStore()
    store.addTask({ title: 'A', group: 'Kept' })
    await flushPromises()
    persistTaskToSupabase.mockClear()
    store.deleteGroup('Never used')
    await flushPromises()
    expect(persistTaskToSupabase).not.toHaveBeenCalled()
  })
})

// ── hydrateFromSupabase (legacy group overlay migration) ──────────────────────

describe('hydrateFromSupabase (legacy group overlay migration)', () => {
  it('applies the legacy group when the DB row has none', () => {
    localStorage.setItem(LEGACY_GROUPS_KEY, JSON.stringify({ t1: 'Study Group' }))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A' }])
    expect(store.tasks[0].group).toBe('Study Group')
  })

  it('prefers the DB group over the legacy overlay', () => {
    localStorage.setItem(LEGACY_GROUPS_KEY, JSON.stringify({ t1: 'Legacy' }))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A', group: 'From DB' }])
    expect(store.tasks[0].group).toBe('From DB')
  })

  it('re-persists migrated rows and clears the legacy key once all writes confirm', async () => {
    localStorage.setItem(LEGACY_GROUPS_KEY, JSON.stringify({ t1: 'Study Group' }))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A' }])
    await flushPromises()
    expect(persistTaskToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', group: 'Study Group' }),
    )
    expect(localStorage.getItem(LEGACY_GROUPS_KEY)).toBeNull()
  })

  it('migrates silently — a failed migration write does not toast', async () => {
    persistTaskToSupabase.mockResolvedValue({ status: 'error', error: 'offline' })
    localStorage.setItem(LEGACY_GROUPS_KEY, JSON.stringify({ t1: 'Study Group' }))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A' }])
    await flushPromises()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps the legacy key when a migration write fails, so it can retry later', async () => {
    persistTaskToSupabase.mockResolvedValue({ status: 'error', error: 'offline' })
    localStorage.setItem(LEGACY_GROUPS_KEY, JSON.stringify({ t1: 'Study Group' }))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A' }])
    await flushPromises()
    expect(localStorage.getItem(LEGACY_GROUPS_KEY)).toBe(JSON.stringify({ t1: 'Study Group' }))
  })

  it('clears the legacy key immediately when no hydrated task matches it', () => {
    localStorage.setItem(LEGACY_GROUPS_KEY, JSON.stringify({ someone_elses_task: 'Ghost' }))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A' }])
    expect(localStorage.getItem(LEGACY_GROUPS_KEY)).toBeNull()
  })

  it('ignores a malformed legacy overlay instead of throwing', () => {
    localStorage.setItem(LEGACY_GROUPS_KEY, 'not json{')
    const store = useTasksStore()
    expect(() => store.hydrateFromSupabase([{ id: 't1', title: 'A' }])).not.toThrow()
    expect(store.tasks[0].group).toBeNull()
  })

  it('does not migrate when there is no legacy overlay at all', async () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 't1', title: 'A' }])
    await flushPromises()
    expect(persistTaskToSupabase).not.toHaveBeenCalled()
  })
})

// ── local-date bucketing ──────────────────────────────────────────────────────

describe('local-date bucketing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('picks today by the local calendar date, not the UTC date', () => {
    // On any non-UTC machine this instant sits on a different UTC day than the
    // local one, so a toISOString()-based implementation would misfile "today".
    vi.setSystemTime(utcStraddlingInstant() ?? new Date(2026, 5, 15, 12, 0, 0))
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Yesterday', scheduledDate: '2026-06-14', priority: 1, completed: false },
      { id: '2', title: 'Today', scheduledDate: '2026-06-15', priority: 1, completed: false },
      { id: '3', title: 'Tomorrow', scheduledDate: '2026-06-16', priority: 1, completed: false },
    ])
    expect(store.todaysTasks.map(t => t.title)).toEqual(['Today'])
    expect(store.overdueTasks.map(t => t.title)).toEqual(['Yesterday'])
  })

  it('never treats a task scheduled for today as overdue', () => {
    vi.setSystemTime(utcStraddlingInstant() ?? new Date(2026, 5, 15, 12, 0, 0))
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: '1', title: 'Today', scheduledDate: '2026-06-15', completed: false }])
    expect(store.overdueTasks).toHaveLength(0)
  })

  it('ignores unscheduled tasks when computing overdue', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'No date', scheduledDate: null, completed: false },
      { id: '2', title: 'Empty date', scheduledDate: '', completed: false },
    ])
    expect(store.overdueTasks).toHaveLength(0)
  })
})

// ── getTasksForDateRange edge cases ───────────────────────────────────────────

describe('getTasksForDateRange edge cases', () => {
  it('excludes tasks with no scheduledDate', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Scheduled', scheduledDate: '2026-09-07' },
      { id: '2', title: 'Unscheduled' },
      { id: '3', title: 'Null date', scheduledDate: null },
    ])
    expect(store.getTasksForDateRange('2026-09-01', '2026-09-30').map(t => t.title))
      .toEqual(['Scheduled'])
  })

  it('includes both endpoints of the range', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([
      { id: '1', title: 'Start', scheduledDate: '2026-09-05' },
      { id: '2', title: 'End', scheduledDate: '2026-09-10' },
    ])
    expect(store.getTasksForDateRange('2026-09-05', '2026-09-10')).toHaveLength(2)
  })

  it('returns nothing for an inverted range', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: '1', title: 'A', scheduledDate: '2026-09-07' }])
    expect(store.getTasksForDateRange('2026-09-10', '2026-09-05')).toHaveLength(0)
  })
})
