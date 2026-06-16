import { setActivePinia, createPinia } from 'pinia'
import { useAssignmentsStore } from '../assignments.js'

vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-assign-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-course-id'),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

// ── addAssignment ─────────────────────────────────────────────────────────────

describe('addAssignment', () => {
  it('adds an assignment and returns it', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Problem Set 1', courseId: 'c1' })
    expect(store.assignments).toHaveLength(1)
    expect(a.title).toBe('Problem Set 1')
  })

  it('applies default fields (status, progress, tasks, id)', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Quiz' })
    expect(a.id).toBeDefined()
    expect(a.status).toBe('pending')
    expect(a.progress).toBe(0)
    expect(a.tasks).toEqual([])
    expect(a.createdAt).toBeDefined()
  })

  it('caller-supplied status overrides the default', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Done already', status: 'completed' })
    expect(a.status).toBe('completed')
  })
})

// ── updateAssignment ──────────────────────────────────────────────────────────

describe('updateAssignment', () => {
  it('patches an existing assignment', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Original' })
    store.updateAssignment(a.id, { title: 'Updated', dueDate: '2026-10-01' })
    expect(store.assignments[0].title).toBe('Updated')
    expect(store.assignments[0].dueDate).toBe('2026-10-01')
  })

  it('does nothing for an unknown id', () => {
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'A' })
    store.updateAssignment('no-such-id', { title: 'Ghost' })
    expect(store.assignments[0].title).toBe('A')
  })

  it('preserves fields not included in the patch', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Keep fields', courseId: 'c1' })
    store.updateAssignment(a.id, { status: 'completed' })
    expect(store.assignments[0].courseId).toBe('c1')
    expect(store.assignments[0].title).toBe('Keep fields')
  })
})

// ── deleteAssignment ──────────────────────────────────────────────────────────

describe('deleteAssignment', () => {
  it('removes the assignment from the list', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Delete me' })
    store.deleteAssignment(a.id)
    expect(store.assignments).toHaveLength(0)
  })

  it('only removes the targeted assignment', () => {
    const store = useAssignmentsStore()
    const a1 = store.addAssignment({ title: 'Keep' })
    const a2 = store.addAssignment({ title: 'Remove' })
    store.deleteAssignment(a2.id)
    expect(store.assignments).toHaveLength(1)
    expect(store.assignments[0].id).toBe(a1.id)
  })
})

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('empties the assignments list', () => {
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'A' })
    store.addAssignment({ title: 'B' })
    store.clearAll()
    expect(store.assignments).toHaveLength(0)
  })
})

// ── replaceFromHydration ──────────────────────────────────────────────────────

describe('replaceFromHydration', () => {
  it('replaces all server-tracked rows with the incoming list', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'old-1', title: 'Old', supabaseAssignmentId: 'sb-old-1' })
    store.replaceFromHydration([{ id: 'new-1', title: 'From server', supabaseAssignmentId: 'sb-new-1' }])
    expect(store.assignments.some(a => a.id === 'old-1')).toBe(false)
    expect(store.assignments.some(a => a.id === 'new-1')).toBe(true)
  })

  it('keeps pending-local rows (no supabaseAssignmentId) after hydration', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'local-1', title: 'Not yet persisted' }) // no supabaseAssignmentId
    store.replaceFromHydration([{ id: 'server-1', title: 'From server', supabaseAssignmentId: 'sb-1' }])
    expect(store.assignments).toHaveLength(2)
    expect(store.assignments.some(a => a.id === 'local-1')).toBe(true)
    expect(store.assignments.some(a => a.id === 'server-1')).toBe(true)
  })

  it('handles non-array gracefully (treats as empty)', () => {
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'Existing' })
    store.replaceFromHydration(null)
    // pending-local rows (no supabaseAssignmentId) are kept, server rows dropped
    expect(store.assignments.every(a => !a.supabaseAssignmentId)).toBe(true)
  })
})

// ── getAssignmentById ─────────────────────────────────────────────────────────

describe('getAssignmentById', () => {
  it('returns the matching assignment', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Find me' })
    expect(store.getAssignmentById(a.id)?.title).toBe('Find me')
  })

  it('returns undefined for an unknown id', () => {
    const store = useAssignmentsStore()
    expect(store.getAssignmentById('no-such-id')).toBeUndefined()
  })
})

// ── markAssignmentComplete / Incomplete ───────────────────────────────────────

describe('markAssignmentComplete', () => {
  it('sets status=completed and progress=100', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Finish me' })
    store.markAssignmentComplete(a.id)
    const updated = store.getAssignmentById(a.id)
    expect(updated.status).toBe('completed')
    expect(updated.progress).toBe(100)
    expect(updated.completedAt).toBeDefined()
  })
})

describe('markAssignmentIncomplete', () => {
  it('sets status=pending and clears completedAt', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Reopen me', tasks: [], status: 'completed', progress: 100, completedAt: '2026-01-01T00:00:00.000Z' })
    store.updateAssignment(a.id, { status: 'completed', progress: 100 })
    store.markAssignmentIncomplete(a.id)
    const updated = store.getAssignmentById(a.id)
    expect(updated.status).toBe('pending')
    expect(updated.completedAt).toBeNull()
  })

  it('re-derives progress from completed subtasks', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({
      title: 'With subtasks',
      tasks: [
        { id: 't1', completed: true },
        { id: 't2', completed: false },
      ],
      status: 'completed',
      progress: 100,
    })
    store.markAssignmentIncomplete(a.id)
    expect(store.getAssignmentById(a.id).progress).toBe(50)
  })
})

// ── updateProgress ────────────────────────────────────────────────────────────

describe('updateProgress', () => {
  it('calculates progress from subtask completion ratio', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({
      title: 'Progress test',
      tasks: [
        { id: 't1', completed: true },
        { id: 't2', completed: true },
        { id: 't3', completed: false },
        { id: 't4', completed: false },
      ],
    })
    store.updateProgress(a.id)
    expect(store.getAssignmentById(a.id).progress).toBe(50)
  })

  it('sets status=completed when all subtasks are done', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({
      title: 'All done',
      tasks: [
        { id: 't1', completed: true },
        { id: 't2', completed: true },
      ],
    })
    store.updateProgress(a.id)
    expect(store.getAssignmentById(a.id).status).toBe('completed')
    expect(store.getAssignmentById(a.id).progress).toBe(100)
  })

  it('does nothing when the assignment has no subtasks', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'No tasks', tasks: [], progress: 0 })
    store.updateProgress(a.id)
    expect(store.getAssignmentById(a.id).progress).toBe(0)
  })
})

// ── computed properties ───────────────────────────────────────────────────────

describe('assignmentsByDueDate', () => {
  it('sorts assignments by dueDate ascending', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Later', dueDate: '2026-09-10' },
      { id: '2', title: 'Earlier', dueDate: '2026-09-01' },
    )
    expect(store.assignmentsByDueDate[0].title).toBe('Earlier')
    expect(store.assignmentsByDueDate[1].title).toBe('Later')
  })
})

describe('upcomingAssignments', () => {
  it('includes future non-completed assignments', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Future pending', dueDate: '2099-12-31', status: 'pending' },
      { id: '2', title: 'Future completed', dueDate: '2099-12-31', status: 'completed' },
      { id: '3', title: 'Past pending', dueDate: '2020-01-01', status: 'pending' },
    )
    const upcoming = store.upcomingAssignments
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0].title).toBe('Future pending')
  })
})

describe('overdueAssignments', () => {
  it('returns past-due incomplete assignments', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Overdue', dueDate: '2020-01-01', status: 'pending' },
      { id: '2', title: 'Overdue but done', dueDate: '2020-01-01', status: 'completed' },
      { id: '3', title: 'Upcoming', dueDate: '2099-12-31', status: 'pending' },
    )
    const overdue = store.overdueAssignments
    expect(overdue).toHaveLength(1)
    expect(overdue[0].title).toBe('Overdue')
  })
})

describe('assignmentsByCourse', () => {
  it('groups assignments by courseId', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'A', courseId: 'c1' },
      { id: '2', title: 'B', courseId: 'c1' },
      { id: '3', title: 'C', courseId: 'c2' },
    )
    expect(store.assignmentsByCourse['c1']).toHaveLength(2)
    expect(store.assignmentsByCourse['c2']).toHaveLength(1)
  })
})

// ── archive lifecycle (Pillar A) ──────────────────────────────────────────────

describe('archivedAssignments', () => {
  it('returns only feed-archived assignments, most-recently-due first', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Live', dueDate: '2099-01-01', status: 'pending', feedStatus: 'live' },
      { id: '2', title: 'Archived early', dueDate: '2026-01-01', status: 'completed', feedStatus: 'archived' },
      { id: '3', title: 'Archived late', dueDate: '2026-05-01', status: 'pending', feedStatus: 'archived' },
    )
    const archived = store.archivedAssignments
    expect(archived).toHaveLength(2)
    expect(archived[0].title).toBe('Archived late') // most recent due first
    expect(archived[1].title).toBe('Archived early')
  })
})

describe('active lists exclude archived', () => {
  it('upcomingAssignments and overdueAssignments skip archived items', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Future archived', dueDate: '2099-12-31', status: 'pending', feedStatus: 'archived' },
      { id: '2', title: 'Past archived', dueDate: '2020-01-01', status: 'pending', feedStatus: 'archived' },
      { id: '3', title: 'Future live', dueDate: '2099-12-31', status: 'pending', feedStatus: 'live' },
      { id: '4', title: 'Past live', dueDate: '2020-01-01', status: 'pending', feedStatus: 'live' },
    )
    expect(store.upcomingAssignments.map(a => a.title)).toEqual(['Future live'])
    expect(store.overdueAssignments.map(a => a.title)).toEqual(['Past live'])
  })
})
