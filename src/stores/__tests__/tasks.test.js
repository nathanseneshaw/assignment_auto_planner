import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useTasksStore } from '../tasks.js'

vi.mock('../../services/taskSync', () => ({
  persistTaskToSupabase: vi.fn().mockResolvedValue({ status: 'ok', id: 'sb-task-id' }),
  deleteTaskFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

// assignments + courses stores are pulled in transitively; mock their I/O so no network calls fire
vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-assign-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-course-id'),
}))

import { persistTaskToSupabase, deleteTaskFromSupabase } from '../../services/taskSync'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
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

// ── hydrateFromSupabase (group overlay) ──────────────────────────────────────

describe('hydrateFromSupabase group overlay', () => {
  it('re-applies local group labels onto hydrated tasks', () => {
    const store = useTasksStore()
    const t = store.addTask({ title: 'Grouped locally', group: 'Study' })
    // Server snapshot won't carry the group (it's stored locally only)
    store.hydrateFromSupabase([{ id: t.id, title: 'Grouped locally', supabaseTaskId: 'sb-1' }])
    expect(store.tasks[0].group).toBe('Study')
  })

  it('falls back to null when no overlay entry exists for a task', () => {
    const store = useTasksStore()
    store.hydrateFromSupabase([{ id: 'x', title: 'No group', supabaseTaskId: 'sb-x' }])
    expect(store.tasks[0].group).toBeNull()
  })
})
