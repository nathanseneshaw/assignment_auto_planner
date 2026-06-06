import { setActivePinia, createPinia } from 'pinia'
import { useCoursesStore } from '../courses.js'

vi.mock('../../services/lmsSupabaseSync', () => ({
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-course-id'),
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-assign-id'),
}))

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
})
