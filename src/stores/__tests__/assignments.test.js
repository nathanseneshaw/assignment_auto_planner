import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useAssignmentsStore } from '../assignments.js'
import { useCoursesStore } from '../courses.js'

vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-assign-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-course-id'),
  deleteCourseAndAssignmentsFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

import { persistAssignmentToSupabase, persistCourseToSupabase } from '../../services/lmsSupabaseSync'

/**
 * A wall-clock instant on 2026-06-15 at which this machine's LOCAL calendar
 * date differs from the UTC date. Using it makes the date-bucketing tests below
 * actually discriminate between the store's `localDateKey()` and a naive
 * `toISOString()` implementation. Returns null on a machine running at UTC,
 * where no such instant exists (the tests then still assert correct bucketing,
 * they just can't catch a UTC regression).
 */
function utcStraddlingInstant() {
  const offsetMin = new Date(2026, 5, 15, 12, 0, 0).getTimezoneOffset()
  if (offsetMin > 0) return new Date(2026, 5, 15, 23, 30, 0) // behind UTC: UTC already rolled to Jun 16
  if (offsetMin < 0) return new Date(2026, 5, 15, 0, 30, 0)  // ahead of UTC: UTC still on Jun 14
  return null
}

/** A row as it arrives from a Supabase hydration snapshot (already server-tracked). */
function serverRow(overrides = {}) {
  return {
    id: 'server-1',
    title: 'From server',
    courseId: 'c1',
    dueDate: '2026-06-20',
    status: 'pending',
    supabaseAssignmentId: 'sb-1',
    ...overrides,
  }
}

/** Seed a course that is already mapped to a Supabase row. */
function seedPersistedCourse(id = 'c1', supabaseCourseId = 'sb-course-1') {
  const courses = useCoursesStore()
  courses.courses.push({ id, name: `Course ${id}`, supabaseCourseId })
  return courses
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // clearAllMocks wipes call history but NOT implementations, so re-assert the
  // defaults here — otherwise a per-test override leaks into the next test.
  persistAssignmentToSupabase.mockResolvedValue('sb-assign-id')
  persistCourseToSupabase.mockResolvedValue('sb-course-id')
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

// ── local-date bucketing (upcoming vs overdue) ────────────────────────────────

describe('local-date bucketing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('buckets by the local calendar date, not the UTC date', () => {
    // On any non-UTC machine this instant sits on a different UTC day than the
    // local one, so a toISOString()-based implementation would misfile "today".
    vi.setSystemTime(utcStraddlingInstant() ?? new Date(2026, 5, 15, 12, 0, 0))
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: 'y', title: 'Yesterday', dueDate: '2026-06-14', status: 'pending' },
      { id: 't', title: 'Today', dueDate: '2026-06-15', status: 'pending' },
      { id: 'm', title: 'Tomorrow', dueDate: '2026-06-16', status: 'pending' },
    )
    expect(store.upcomingAssignments.map(a => a.title)).toEqual(['Today', 'Tomorrow'])
    expect(store.overdueAssignments.map(a => a.title)).toEqual(['Yesterday'])
  })

  it('counts an assignment due today as upcoming, never overdue', () => {
    vi.setSystemTime(utcStraddlingInstant() ?? new Date(2026, 5, 15, 12, 0, 0))
    const store = useAssignmentsStore()
    store.assignments.push({ id: 't', title: 'Due today', dueDate: '2026-06-15', status: 'pending' })
    expect(store.upcomingAssignments).toHaveLength(1)
    expect(store.overdueAssignments).toHaveLength(0)
  })

  // Same due date, one day later on the clock: the list it belongs to flips.
  // (Read fresh — these computeds cache on `assignments`, not on the clock.)
  it('files a date that is now in the past as overdue rather than upcoming', () => {
    vi.setSystemTime(new Date(2026, 5, 16, 12, 0, 0))
    const store = useAssignmentsStore()
    store.assignments.push({ id: 't', title: 'Due Jun 15', dueDate: '2026-06-15', status: 'pending' })
    expect(store.overdueAssignments.map(a => a.title)).toEqual(['Due Jun 15'])
    expect(store.upcomingAssignments).toHaveLength(0)
  })

  it('orders upcomingAssignments by due date', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Late', dueDate: '2026-07-01', status: 'pending' },
      { id: '2', title: 'Soon', dueDate: '2026-06-16', status: 'pending' },
      { id: '3', title: 'Middle', dueDate: '2026-06-20', status: 'pending' },
    )
    expect(store.upcomingAssignments.map(a => a.title)).toEqual(['Soon', 'Middle', 'Late'])
  })
})

// ── computed views are non-destructive ────────────────────────────────────────

describe('computed views are non-destructive', () => {
  it('assignmentsByDueDate sorts a copy and leaves source order intact', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Later', dueDate: '2026-09-10' },
      { id: '2', title: 'Earlier', dueDate: '2026-09-01' },
    )
    const sorted = store.assignmentsByDueDate
    expect(sorted).not.toBe(store.assignments)
    expect(store.assignments.map(a => a.title)).toEqual(['Later', 'Earlier'])
  })

  it('archivedAssignments sorts a copy and leaves source order intact', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'Old', dueDate: '2026-01-01', feedStatus: 'archived' },
      { id: '2', title: 'New', dueDate: '2026-05-01', feedStatus: 'archived' },
    )
    expect(store.archivedAssignments.map(a => a.title)).toEqual(['New', 'Old'])
    expect(store.assignments.map(a => a.title)).toEqual(['Old', 'New'])
  })

  it('assignmentsByCourse keeps insertion order within each course bucket', () => {
    const store = useAssignmentsStore()
    store.assignments.push(
      { id: '1', title: 'First', courseId: 'c1' },
      { id: '2', title: 'Other', courseId: 'c2' },
      { id: '3', title: 'Second', courseId: 'c1' },
    )
    expect(store.assignmentsByCourse.c1.map(a => a.title)).toEqual(['First', 'Second'])
    expect(store.assignmentsByCourse.c3).toBeUndefined()
  })
})

// ── addAssignment → Supabase handshake ────────────────────────────────────────

describe('addAssignment Supabase handshake', () => {
  it('ensures the parent course row, then writes the assignment against it', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Lab 1', courseId: 'c1' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ id: a.id, title: 'Lab 1' }),
      'sb-course-1',
    )
  })

  it('stamps the returned supabaseAssignmentId back onto the local row', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Lab 1', courseId: 'c1' })
    expect(a.supabaseAssignmentId).toBeUndefined() // not stamped synchronously
    await store.flushPendingPersists()
    expect(store.getAssignmentById(a.id).supabaseAssignmentId).toBe('sb-assign-id')
  })

  it('creates the course row first when the course is not yet in Supabase', async () => {
    const courses = useCoursesStore()
    const course = courses.addCourse({ name: 'Chem 101' })
    await flushPromises() // let addCourse's own ensureSupabaseCourseRow settle
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'Lab 1', courseId: course.id })
    await store.flushPendingPersists()
    expect(persistCourseToSupabase).toHaveBeenCalled()
    expect(persistAssignmentToSupabase).toHaveBeenCalledWith(expect.anything(), 'sb-course-id')
  })

  it('skips the write entirely for an orphan assignment (no parent course)', async () => {
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'Orphan', courseId: 'no-such-course' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).not.toHaveBeenCalled()
  })

  it('skips the write when the parent course row cannot be ensured', async () => {
    const courses = seedPersistedCourse('c1', 'sb-course-1')
    courses.ensureSupabaseCourseRow = vi.fn().mockResolvedValue(null)
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'Lab 1', courseId: 'c1' })
    await store.flushPendingPersists()
    expect(courses.ensureSupabaseCourseRow).toHaveBeenCalledWith('c1')
    expect(persistAssignmentToSupabase).not.toHaveBeenCalled()
  })

  it('does not stamp an id when the write returns null', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    persistAssignmentToSupabase.mockResolvedValue(null)
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Write failed', courseId: 'c1' })
    await store.flushPendingPersists()
    expect(store.getAssignmentById(a.id).supabaseAssignmentId).toBeUndefined()
  })
})

// ── updateAssignment → persistence gating ─────────────────────────────────────

describe('updateAssignment persistence gating', () => {
  it('does not persist a row that is neither server-tracked nor LMS-linked', async () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'Local only', courseId: 'c1' })
    seedPersistedCourse('c1', 'sb-course-1')
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(store.assignments[0].title).toBe('Renamed')
    expect(persistAssignmentToSupabase).not.toHaveBeenCalled()
  })

  it('persists a row that already has a supabaseAssignmentId', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    store.assignments.push(serverRow({ id: 'a1', supabaseAssignmentId: 'sb-a1' }))
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', title: 'Renamed' }),
      'sb-course-1',
    )
  })

  it('persists a row tracked only by a Canvas id', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'Canvas row', courseId: 'c1', canvasAssignmentId: 12345 })
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).toHaveBeenCalledOnce()
  })

  it('persists a row tracked only by a Blackboard id', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'BB row', courseId: 'c1', blackboardId: '_123_1' })
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).toHaveBeenCalledOnce()
  })

  it('treats a blank external id as no external id', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'Blank ext', courseId: 'c1', canvasAssignmentId: '   ' })
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).not.toHaveBeenCalled()
  })

  it('skips the write when the parent course has no supabaseCourseId', async () => {
    const courses = useCoursesStore()
    courses.courses.push({ id: 'c1', name: 'Local course' }) // never persisted
    const store = useAssignmentsStore()
    store.assignments.push(serverRow({ id: 'a1' }))
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).not.toHaveBeenCalled()
  })

  it('stamps the returned id onto a row that only had an external id', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'Canvas row', courseId: 'c1', canvasAssignmentId: 12345 })
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(store.getAssignmentById('a1').supabaseAssignmentId).toBe('sb-assign-id')
  })

  it('never overwrites an existing supabaseAssignmentId', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    persistAssignmentToSupabase.mockResolvedValue('sb-different')
    const store = useAssignmentsStore()
    store.assignments.push(serverRow({ id: 'a1', supabaseAssignmentId: 'sb-original' }))
    store.updateAssignment('a1', { title: 'Renamed' })
    await store.flushPendingPersists()
    expect(store.getAssignmentById('a1').supabaseAssignmentId).toBe('sb-original')
  })

  it('does not queue a persist at all for an unknown id', async () => {
    const store = useAssignmentsStore()
    store.updateAssignment('ghost', { title: 'Nope' })
    await store.flushPendingPersists()
    expect(persistAssignmentToSupabase).not.toHaveBeenCalled()
  })
})

// ── flushPendingPersists ──────────────────────────────────────────────────────

describe('flushPendingPersists', () => {
  it('resolves immediately when nothing is in flight', async () => {
    const store = useAssignmentsStore()
    await expect(store.flushPendingPersists()).resolves.toBeUndefined()
  })

  it('waits for an in-flight create before resolving', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    let release
    persistAssignmentToSupabase.mockReturnValueOnce(new Promise(resolve => { release = resolve }))

    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Slow write', courseId: 'c1' })

    let settled = false
    const flushed = store.flushPendingPersists().then(() => { settled = true })
    await flushPromises()
    expect(settled).toBe(false)

    release('sb-late-id')
    await flushed
    expect(settled).toBe(true)
    expect(store.getAssignmentById(a.id).supabaseAssignmentId).toBe('sb-late-id')
  })

  it('stops tracking a persist once it has settled', async () => {
    seedPersistedCourse('c1', 'sb-course-1')
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'Quick write', courseId: 'c1' })
    await store.flushPendingPersists()

    // Second flush has nothing left to wait on, so it resolves within one tick.
    let settled = false
    store.flushPendingPersists().then(() => { settled = true })
    await flushPromises()
    expect(settled).toBe(true)
  })
})

// ── updateProgress edge cases ─────────────────────────────────────────────────

describe('updateProgress edge cases', () => {
  it('rounds to the nearest whole percent', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({
      title: 'Thirds',
      tasks: [{ id: 't1', completed: true }, { id: 't2', completed: false }, { id: 't3', completed: false }],
    })
    store.updateProgress(a.id)
    expect(store.getAssignmentById(a.id).progress).toBe(33)
  })

  it('reports 0% when no subtask is done and leaves status pending', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({
      title: 'Untouched',
      progress: 42,
      tasks: [{ id: 't1', completed: false }, { id: 't2', completed: false }],
    })
    store.updateProgress(a.id)
    expect(store.getAssignmentById(a.id).progress).toBe(0)
    expect(store.getAssignmentById(a.id).status).toBe('pending')
  })

  it('does not reopen an already-completed assignment when progress drops', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({
      title: 'Reopened subtask',
      status: 'completed',
      progress: 100,
      tasks: [{ id: 't1', completed: true }, { id: 't2', completed: false }],
    })
    store.updateProgress(a.id)
    expect(store.getAssignmentById(a.id).progress).toBe(50)
    expect(store.getAssignmentById(a.id).status).toBe('completed')
  })

  it('is a no-op for an unknown id', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Untouched', tasks: [{ id: 't1', completed: true }] })
    expect(() => store.updateProgress('ghost')).not.toThrow()
    expect(store.getAssignmentById(a.id).progress).toBe(0)
  })
})

// ── completion round-trip ─────────────────────────────────────────────────────

describe('completion round-trip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('stamps completedAt with the current time', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Timestamped' })
    store.markAssignmentComplete(a.id)
    expect(store.getAssignmentById(a.id).completedAt).toBe(new Date(2026, 5, 15, 12, 0, 0).toISOString())
  })

  it('returns to a clean pending state after complete then incomplete', () => {
    const store = useAssignmentsStore()
    const a = store.addAssignment({ title: 'Round trip' })
    store.markAssignmentComplete(a.id)
    store.markAssignmentIncomplete(a.id)
    expect(store.getAssignmentById(a.id)).toMatchObject({
      status: 'pending',
      progress: 0,
      completedAt: null,
    })
  })

  it('markAssignmentIncomplete tolerates a row with no tasks array', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'Hydrated row', status: 'completed', progress: 100 })
    expect(() => store.markAssignmentIncomplete('a1')).not.toThrow()
    expect(store.getAssignmentById('a1').progress).toBe(0)
  })

  it('markAssignmentComplete is a no-op for an unknown id', () => {
    const store = useAssignmentsStore()
    store.addAssignment({ title: 'Only row' })
    store.markAssignmentComplete('ghost')
    expect(store.assignments).toHaveLength(1)
    expect(store.assignments[0].status).toBe('pending')
  })

  it('markAssignmentIncomplete is a no-op for an unknown id', () => {
    const store = useAssignmentsStore()
    expect(() => store.markAssignmentIncomplete('ghost')).not.toThrow()
    expect(store.assignments).toHaveLength(0)
  })

  it('completing an assignment removes it from both active lists', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'a1', title: 'Due today', dueDate: '2026-06-15', status: 'pending' })
    expect(store.upcomingAssignments).toHaveLength(1)
    store.markAssignmentComplete('a1')
    expect(store.upcomingAssignments).toHaveLength(0)
    expect(store.overdueAssignments).toHaveLength(0)
  })
})

// ── replaceFromHydration ordering ─────────────────────────────────────────────

describe('replaceFromHydration ordering', () => {
  it('places incoming server rows ahead of the retained pending-local rows', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'local-1', title: 'Pending local' })
    store.replaceFromHydration([serverRow({ id: 's1' }), serverRow({ id: 's2', supabaseAssignmentId: 'sb-2' })])
    expect(store.assignments.map(a => a.id)).toEqual(['s1', 's2', 'local-1'])
  })

  it('drops every previously hydrated server row, keeping only the new snapshot', () => {
    const store = useAssignmentsStore()
    store.replaceFromHydration([serverRow({ id: 's1' })])
    store.replaceFromHydration([serverRow({ id: 's2', supabaseAssignmentId: 'sb-2' })])
    expect(store.assignments.map(a => a.id)).toEqual(['s2'])
  })

  it('keeps pending-local rows across repeated hydrations', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'local-1', title: 'Pending local' })
    store.replaceFromHydration([serverRow({ id: 's1' })])
    store.replaceFromHydration([serverRow({ id: 's1' })])
    expect(store.assignments.map(a => a.id)).toEqual(['s1', 'local-1'])
  })

  it('clearAll drops pending-local rows that hydration would have kept', () => {
    const store = useAssignmentsStore()
    store.assignments.push({ id: 'local-1', title: 'Pending local' })
    store.clearAll()
    store.replaceFromHydration([serverRow({ id: 's1' })])
    expect(store.assignments.map(a => a.id)).toEqual(['s1'])
  })
})
