import { setActivePinia, createPinia } from 'pinia'
import { useCoursesStore } from '../courses.js'

vi.mock('../../services/lmsSupabaseSync', () => ({
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-course-id'),
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-assign-id'),
  deleteCourseAndAssignmentsFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

import {
  persistCourseToSupabase,
  deleteCourseAndAssignmentsFromSupabase,
} from '../../services/lmsSupabaseSync'
import { useAssignmentsStore } from '../assignments.js'

/**
 * Push a raw row straight into state, bypassing `addCourse` so no background
 * persist is already in flight when the test starts.
 */
function seedCourse(store, overrides = {}) {
  const course = { id: 'local-1', name: 'CS 3340', ...overrides }
  store.courses.push(course)
  return course
}

/** Externally-resolvable promise, used to hold a persist in flight. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Drain the microtask + timer queues so fire-and-forget persists settle. */
const settleBackgroundWork = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

// ── addCourse ─────────────────────────────────────────────────────────────────

describe('addCourse', () => {
  it('adds a course and returns it', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Data Structures' })
    expect(store.courses).toHaveLength(1)
    expect(c.name).toBe('Data Structures')
  })

  it('assigns a unique id and createdAt', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Algorithms' })
    expect(c.id).toBeDefined()
    expect(c.createdAt).toBeDefined()
  })

  it('assigns a color from the palette', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Physics' })
    expect(c.color).toHaveProperty('bg')
    expect(c.color).toHaveProperty('text')
    expect(c.color).toHaveProperty('border')
  })

  it('cycles through colors for successive courses', () => {
    const store = useCoursesStore()
    // Add 9 courses — the 9th should wrap back to the first color
    const courses = Array.from({ length: 9 }, (_, i) => store.addCourse({ name: `Course ${i}` }))
    expect(courses[0].color.bg).toBe(courses[8].color.bg)
  })

  it('gives the first eight courses eight distinct colors', () => {
    const store = useCoursesStore()
    const bgs = Array.from({ length: 8 }, (_, i) => store.addCourse({ name: `Course ${i}` }).color.bg)
    expect(new Set(bgs).size).toBe(8)
  })

  it('indexes the palette by list length, so a delete makes the next add reuse a color', () => {
    const store = useCoursesStore()
    const first = store.addCourse({ name: 'A' })
    const second = store.addCourse({ name: 'B' })
    store.deleteCourse(first.id)
    // Length is back to 1, so the next course takes the same slot as `second`.
    const third = store.addCourse({ name: 'C' })
    expect(third.color.bg).toBe(second.color.bg)
  })

  it('kicks off a background persist and stores the returned supabase id', async () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Compilers' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ id: c.id, name: 'Compilers' })
    )
    expect(store.getCourseById(c.id).supabaseCourseId).toBe('sb-course-id')
  })

  it('caller-supplied fields override defaults', () => {
    const store = useCoursesStore()
    const fixedColor = { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' }
    const c = store.addCourse({ name: 'Override', color: fixedColor })
    expect(c.color.bg).toBe('bg-yellow-100')
  })
})

// ── updateCourse ──────────────────────────────────────────────────────────────

describe('updateCourse', () => {
  it('patches an existing course', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Old Name' })
    store.updateCourse(c.id, { name: 'New Name' })
    expect(store.getCourseById(c.id).name).toBe('New Name')
  })

  it('does nothing for an unknown id', () => {
    const store = useCoursesStore()
    store.addCourse({ name: 'A' })
    store.updateCourse('no-such-id', { name: 'Ghost' })
    expect(store.courses[0].name).toBe('A')
  })

  it('preserves un-patched fields', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'CS 3340', instructor: 'Dr. Smith' })
    store.updateCourse(c.id, { name: 'CS 3340 Updated' })
    expect(store.getCourseById(c.id).instructor).toBe('Dr. Smith')
  })
})

// ── deleteCourse ──────────────────────────────────────────────────────────────

describe('deleteCourse', () => {
  it('removes the course from the list', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Delete me' })
    store.deleteCourse(c.id)
    expect(store.courses).toHaveLength(0)
  })

  it('only removes the targeted course', () => {
    const store = useCoursesStore()
    const c1 = store.addCourse({ name: 'Keep' })
    const c2 = store.addCourse({ name: 'Remove' })
    store.deleteCourse(c2.id)
    expect(store.courses).toHaveLength(1)
    expect(store.courses[0].id).toBe(c1.id)
  })
})

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('empties the courses list', () => {
    const store = useCoursesStore()
    store.addCourse({ name: 'A' })
    store.addCourse({ name: 'B' })
    store.clearAll()
    expect(store.courses).toHaveLength(0)
  })
})

// ── getCourseById ─────────────────────────────────────────────────────────────

describe('getCourseById', () => {
  it('returns the matching course', () => {
    const store = useCoursesStore()
    const c = store.addCourse({ name: 'Find me' })
    expect(store.getCourseById(c.id)?.name).toBe('Find me')
  })

  it('returns undefined for an unknown id', () => {
    const store = useCoursesStore()
    expect(store.getCourseById('no-such-id')).toBeUndefined()
  })
})

// ── replaceFromHydration ──────────────────────────────────────────────────────

describe('replaceFromHydration', () => {
  it('replaces server-tracked courses with incoming list', () => {
    const store = useCoursesStore()
    store.courses.push({ id: 'old-1', name: 'Old', supabaseCourseId: 'sb-old' })
    store.replaceFromHydration([{ id: 'new-1', name: 'From server', supabaseCourseId: 'sb-new' }])
    expect(store.courses.some(c => c.id === 'old-1')).toBe(false)
    expect(store.courses.some(c => c.id === 'new-1')).toBe(true)
  })

  it('keeps pending-local courses (no supabaseCourseId) after hydration', () => {
    const store = useCoursesStore()
    store.courses.push({ id: 'local-1', name: 'Not yet persisted' }) // no supabaseCourseId
    store.replaceFromHydration([{ id: 'server-1', name: 'From server', supabaseCourseId: 'sb-1' }])
    expect(store.courses).toHaveLength(2)
    expect(store.courses.some(c => c.id === 'local-1')).toBe(true)
    expect(store.courses.some(c => c.id === 'server-1')).toBe(true)
  })

  it('handles non-array input gracefully', () => {
    const store = useCoursesStore()
    expect(() => store.replaceFromHydration(null)).not.toThrow()
  })
})

// ── coursesSorted ─────────────────────────────────────────────────────────────

describe('coursesSorted', () => {
  it('returns courses sorted alphabetically by name', () => {
    const store = useCoursesStore()
    store.courses.push(
      { id: '1', name: 'Zoology' },
      { id: '2', name: 'Algorithms' },
      { id: '3', name: 'Mathematics' },
    )
    const sorted = store.coursesSorted
    expect(sorted[0].name).toBe('Algorithms')
    expect(sorted[1].name).toBe('Mathematics')
    expect(sorted[2].name).toBe('Zoology')
  })

  it('does not mutate the original courses array', () => {
    const store = useCoursesStore()
    store.courses.push({ id: '1', name: 'Z' }, { id: '2', name: 'A' })
    store.coursesSorted // access the computed
    expect(store.courses[0].name).toBe('Z') // original order preserved
  })

  it('sorts case-insensitively rather than by raw char code', () => {
    const store = useCoursesStore()
    // A naive `a < b` sort would put 'Biology' first because 'B' (66) < 'a' (97).
    store.courses.push({ id: '1', name: 'Biology' }, { id: '2', name: 'algorithms' })
    expect(store.coursesSorted.map((c) => c.name)).toEqual(['algorithms', 'Biology'])
  })

  it('treats a missing name as empty instead of throwing', () => {
    const store = useCoursesStore()
    store.courses.push({ id: '1', name: 'Physics' }, { id: '2' })
    expect(() => store.coursesSorted).not.toThrow()
    expect(store.coursesSorted[0].id).toBe('2')
  })

  it('re-sorts after a rename', () => {
    const store = useCoursesStore()
    const a = seedCourse(store, { id: 'a', name: 'Anthropology' })
    seedCourse(store, { id: 'b', name: 'Biology' })
    store.updateCourse(a.id, { name: 'Zoology' })
    expect(store.coursesSorted.map((c) => c.id)).toEqual(['b', 'a'])
  })
})

// ── ensureSupabaseCourseRow ───────────────────────────────────────────────────
//
// The dedup map is the interesting part: assignments persist through this
// helper, so a burst of them on a brand-new course must not race into several
// INSERTs of the same row.

describe('ensureSupabaseCourseRow', () => {
  it('returns null and never persists for an unknown local id', async () => {
    const store = useCoursesStore()
    await expect(store.ensureSupabaseCourseRow('no-such-id')).resolves.toBeNull()
    expect(persistCourseToSupabase).not.toHaveBeenCalled()
  })

  it('short-circuits to a known supabase id without a round-trip', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store, { supabaseCourseId: 'sb-known' })
    await expect(store.ensureSupabaseCourseRow(c.id)).resolves.toBe('sb-known')
    expect(persistCourseToSupabase).not.toHaveBeenCalled()
  })

  it('persists the row and writes the returned id back onto it', async () => {
    persistCourseToSupabase.mockResolvedValueOnce('sb-new')
    const store = useCoursesStore()
    const c = seedCourse(store)
    await expect(store.ensureSupabaseCourseRow(c.id)).resolves.toBe('sb-new')
    expect(persistCourseToSupabase).toHaveBeenCalledWith(expect.objectContaining({ id: c.id }))
    expect(store.getCourseById(c.id).supabaseCourseId).toBe('sb-new')
  })

  it('collapses concurrent calls for the same course into one persist', async () => {
    const inFlight = deferred()
    persistCourseToSupabase.mockReturnValueOnce(inFlight.promise)
    const store = useCoursesStore()
    const c = seedCourse(store)

    const first = store.ensureSupabaseCourseRow(c.id)
    const second = store.ensureSupabaseCourseRow(c.id)
    inFlight.resolve('sb-shared')

    expect(await first).toBe('sb-shared')
    expect(await second).toBe('sb-shared')
    expect(persistCourseToSupabase).toHaveBeenCalledTimes(1)
  })

  it('still persists two different courses that race each other', async () => {
    const store = useCoursesStore()
    seedCourse(store, { id: 'local-a' })
    seedCourse(store, { id: 'local-b' })
    await Promise.all([
      store.ensureSupabaseCourseRow('local-a'),
      store.ensureSupabaseCourseRow('local-b'),
    ])
    expect(persistCourseToSupabase).toHaveBeenCalledTimes(2)
  })

  it('leaves the row untracked when the server returns no id', async () => {
    persistCourseToSupabase.mockResolvedValueOnce(null)
    const store = useCoursesStore()
    const c = seedCourse(store)
    await expect(store.ensureSupabaseCourseRow(c.id)).resolves.toBeNull()
    expect(store.getCourseById(c.id).supabaseCourseId).toBeUndefined()
  })

  it('frees the in-flight slot once settled so a failed attempt can be retried', async () => {
    persistCourseToSupabase.mockResolvedValueOnce(null) // first attempt yields nothing
    const store = useCoursesStore()
    const c = seedCourse(store)
    await store.ensureSupabaseCourseRow(c.id)
    await store.ensureSupabaseCourseRow(c.id)
    expect(persistCourseToSupabase).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite an id the row gained while the persist was in flight', async () => {
    const inFlight = deferred()
    persistCourseToSupabase.mockReturnValueOnce(inFlight.promise)
    const store = useCoursesStore()
    const c = seedCourse(store)
    const p = store.ensureSupabaseCourseRow(c.id)

    // A hydration lands the authoritative id before the persist answers.
    store.courses[0] = { ...store.courses[0], supabaseCourseId: 'sb-from-hydration' }
    inFlight.resolve('sb-late')

    await expect(p).resolves.toBe('sb-late')
    expect(store.getCourseById(c.id).supabaseCourseId).toBe('sb-from-hydration')
  })

  it('does not resurrect a course deleted while its persist was in flight', async () => {
    const inFlight = deferred()
    persistCourseToSupabase.mockReturnValueOnce(inFlight.promise)
    const store = useCoursesStore()
    const c = seedCourse(store)
    const p = store.ensureSupabaseCourseRow(c.id)

    store.deleteCourse(c.id)
    inFlight.resolve('sb-late')
    await p

    expect(store.courses).toHaveLength(0)
  })
})

// ── updateCourse persistence ──────────────────────────────────────────────────
//
// Purely-local rows are left to the background sync; anything the server can
// already address (a supabase id, or a Canvas/Blackboard id it can upsert on)
// is written through immediately.

describe('updateCourse persistence', () => {
  it('skips the network for a course that has never reached Supabase', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store)
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).not.toHaveBeenCalled()
  })

  it('persists a course already tracked server-side', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store, { supabaseCourseId: 'sb-1' })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({ id: c.id, name: 'Renamed', supabaseCourseId: 'sb-1' })
    )
  })

  it('persists a course that carries a canvas id', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store, { canvasCourseId: 'canvas-77' })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).toHaveBeenCalledOnce()
  })

  it('persists a course that carries a blackboard id', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store, { blackboardId: '_1234_1' })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).toHaveBeenCalledOnce()
  })

  it('accepts a numeric external id', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store, { canvasCourseId: 4321 })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).toHaveBeenCalledOnce()
  })

  it('treats a blank external id as absent', async () => {
    const store = useCoursesStore()
    const c = seedCourse(store, { canvasCourseId: '   ', blackboardId: '' })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).not.toHaveBeenCalled()
  })

  it('adopts the supabase id returned by the write-through', async () => {
    persistCourseToSupabase.mockResolvedValueOnce('sb-fresh')
    const store = useCoursesStore()
    const c = seedCourse(store, { canvasCourseId: 'canvas-77' })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(store.getCourseById(c.id).supabaseCourseId).toBe('sb-fresh')
  })

  it('keeps the existing supabase id when the write-through reports a different one', async () => {
    persistCourseToSupabase.mockResolvedValueOnce('sb-other')
    const store = useCoursesStore()
    const c = seedCourse(store, { supabaseCourseId: 'sb-original' })
    store.updateCourse(c.id, { name: 'Renamed' })
    await settleBackgroundWork()
    expect(store.getCourseById(c.id).supabaseCourseId).toBe('sb-original')
  })

  it('does not persist an unknown id', async () => {
    const store = useCoursesStore()
    seedCourse(store, { supabaseCourseId: 'sb-1' })
    store.updateCourse('no-such-id', { name: 'Ghost' })
    await settleBackgroundWork()
    expect(persistCourseToSupabase).not.toHaveBeenCalled()
  })
})

// ── unenrollCourse ────────────────────────────────────────────────────────────

describe('unenrollCourse', () => {
  it('is a no-op for an unknown id', async () => {
    const store = useCoursesStore()
    seedCourse(store)
    await store.unenrollCourse('no-such-id')
    expect(store.courses).toHaveLength(1)
    expect(deleteCourseAndAssignmentsFromSupabase).not.toHaveBeenCalled()
  })

  it('removes the course and cascades into its assignments only', async () => {
    const store = useCoursesStore()
    const assignments = useAssignmentsStore()
    seedCourse(store, { id: 'c1' })
    seedCourse(store, { id: 'c2', name: 'Keeper' })
    assignments.assignments.push(
      { id: 'a1', courseId: 'c1', title: 'HW1' },
      { id: 'a2', courseId: 'c1', title: 'HW2' },
      { id: 'a3', courseId: 'c2', title: 'Other course HW' },
    )

    await store.unenrollCourse('c1')

    expect(store.courses.map((c) => c.id)).toEqual(['c2'])
    expect(assignments.assignments.map((a) => a.id)).toEqual(['a3'])
  })

  it('deletes the remote rows for a course tracked server-side', async () => {
    const store = useCoursesStore()
    seedCourse(store, { id: 'c1', supabaseCourseId: 'sb-1' })
    await store.unenrollCourse('c1')
    expect(deleteCourseAndAssignmentsFromSupabase).toHaveBeenCalledWith('sb-1')
  })

  it('skips the remote delete for a course that never reached Supabase', async () => {
    const store = useCoursesStore()
    seedCourse(store, { id: 'c1' })
    await store.unenrollCourse('c1')
    expect(deleteCourseAndAssignmentsFromSupabase).not.toHaveBeenCalled()
    expect(store.courses).toHaveLength(0)
  })

  it('surfaces a remote failure but keeps the optimistic local wipe', async () => {
    deleteCourseAndAssignmentsFromSupabase.mockRejectedValueOnce(new Error('RLS denied'))
    const store = useCoursesStore()
    const assignments = useAssignmentsStore()
    seedCourse(store, { id: 'c1', supabaseCourseId: 'sb-1' })
    assignments.assignments.push({ id: 'a1', courseId: 'c1', title: 'HW1' })

    await expect(store.unenrollCourse('c1')).rejects.toThrow('RLS denied')

    expect(store.courses).toHaveLength(0)
    expect(assignments.assignments).toHaveLength(0)
  })
})

// ── flushPendingPersists ──────────────────────────────────────────────────────

describe('flushPendingPersists', () => {
  it('resolves immediately when nothing is in flight', async () => {
    const store = useCoursesStore()
    await expect(store.flushPendingPersists()).resolves.toBeUndefined()
  })

  it('waits for an in-flight persist before resolving', async () => {
    const inFlight = deferred()
    persistCourseToSupabase.mockReturnValueOnce(inFlight.promise)
    const store = useCoursesStore()
    const c = seedCourse(store)
    const ensure = store.ensureSupabaseCourseRow(c.id)

    let flushed = false
    const flush = store.flushPendingPersists().then(() => { flushed = true })
    await settleBackgroundWork()
    expect(flushed).toBe(false)

    inFlight.resolve('sb-1')
    await flush
    await ensure
    expect(flushed).toBe(true)
  })

  it('resolves even when the in-flight persist rejects', async () => {
    persistCourseToSupabase.mockRejectedValueOnce(new Error('offline'))
    const store = useCoursesStore()
    const c = seedCourse(store)
    store.ensureSupabaseCourseRow(c.id).catch(() => {})
    await expect(store.flushPendingPersists()).resolves.toBeUndefined()
  })
})

// ── hydration / sign-out interaction with in-flight persists ──────────────────

describe('replaceFromHydration and clearAll vs in-flight persists', () => {
  it('clears the dedup map, so a later ensure issues a fresh persist', async () => {
    const inFlight = deferred()
    persistCourseToSupabase.mockReturnValueOnce(inFlight.promise)
    const store = useCoursesStore()
    const c = seedCourse(store)

    const first = store.ensureSupabaseCourseRow(c.id)
    store.replaceFromHydration([]) // keeps the un-persisted row, drops the bookkeeping
    const second = store.ensureSupabaseCourseRow(c.id)

    expect(persistCourseToSupabase).toHaveBeenCalledTimes(2)
    inFlight.resolve('sb-1')
    await Promise.all([first, second])
  })

  it('keeps the incoming order with pending local rows appended', () => {
    const store = useCoursesStore()
    seedCourse(store, { id: 'local-1' })
    store.replaceFromHydration([
      { id: 'server-1', supabaseCourseId: 'sb-1' },
      { id: 'server-2', supabaseCourseId: 'sb-2' },
    ])
    expect(store.courses.map((c) => c.id)).toEqual(['server-1', 'server-2', 'local-1'])
  })

  it('clearAll drops even un-persisted rows', () => {
    const store = useCoursesStore()
    seedCourse(store, { id: 'local-1' })
    seedCourse(store, { id: 'server-1', supabaseCourseId: 'sb-1' })
    store.clearAll()
    expect(store.courses).toHaveLength(0)
  })

  it('a persist that lands after clearAll does not resurrect the course', async () => {
    const inFlight = deferred()
    persistCourseToSupabase.mockReturnValueOnce(inFlight.promise)
    const store = useCoursesStore()
    const c = seedCourse(store)
    const p = store.ensureSupabaseCourseRow(c.id)

    store.clearAll()
    inFlight.resolve('sb-late')
    await p

    expect(store.courses).toHaveLength(0)
  })
})
