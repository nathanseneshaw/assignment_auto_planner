import { setActivePinia, createPinia } from 'pinia'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The builder fetches sections through the same service as the planner store.
// Mock the whole module so no test ever touches the network.
vi.mock('../../services/coursePlannerApi.js', () => ({
  listSchools: vi.fn(),
  getTerms: vi.fn(),
  getSubjects: vi.fn(),
  getSections: vi.fn(),
}))

import * as api from '../../services/coursePlannerApi.js'
import { useScheduleBuilderStore } from '../scheduleBuilder.js'
import { useCoursePlannerStore } from '../coursePlanner.js'
import { useProfileStore } from '../profile.js'

let crnCounter = 0

/** Open section with seats; override any field per test. */
function sampleSection(over = {}) {
  return {
    school: 'rice',
    termCode: '202610',
    subjectCode: 'COMP',
    subjectLabel: 'Computer Science',
    courseNumber: '140',
    sectionNumber: '001',
    crn: `crn-${++crnCounter}`,
    title: 'Intro to Programming',
    instructors: [],
    credits: 3,
    enrollment: { max: 30, current: 10, available: 20 },
    status: 'open',
    meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '09:50', location: '' }],
    ...over,
  }
}

/** Point the stores at a school + term (candidates are bucketed by both). */
function useSchoolAndTerm(school = 'rice', term = '202610') {
  useProfileStore().updateProfile({ school })
  useCoursePlannerStore().selectedTermCode = term
}

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  api.getSections.mockResolvedValue([sampleSection()])
})

// ── candidates: add / dedup / cap / remove ────────────────────────────────────

describe('candidates', () => {
  it('derives a candidate from a section row', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    expect(store.candidates).toHaveLength(1)
    expect(store.candidates[0]).toEqual({
      school: 'rice',
      termCode: '202610',
      subjectCode: 'COMP',
      subjectLabel: 'Computer Science',
      courseNumber: '140',
      title: 'Intro to Programming',
      pinnedCrn: null,
    })
  })

  it('dedups by course - two sections of the same course add once', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ sectionNumber: '001' }))
    store.addCandidate(sampleSection({ sectionNumber: '002' }))
    expect(store.candidates).toHaveLength(1)
  })

  it('caps at 8 candidates and exposes canAddMore', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    for (let i = 1; i <= 9; i++) {
      store.addCandidate(sampleSection({ courseNumber: String(100 + i) }))
    }
    expect(store.candidates).toHaveLength(8)
    expect(store.canAddMore).toBe(false)
  })

  it('removeCandidate drops by key; clearCandidates empties the bucket', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ courseNumber: '140' }))
    store.addCandidate(sampleSection({ courseNumber: '200' }))
    store.removeCandidate('rice:202610:COMP:140')
    expect(store.candidates.map((c) => c.courseNumber)).toEqual(['200'])
    store.clearCandidates()
    expect(store.candidates).toHaveLength(0)
  })

  it('buckets candidates per school:term - switching terms shows that bucket', () => {
    useSchoolAndTerm('rice', '202610')
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    useCoursePlannerStore().selectedTermCode = '202620'
    expect(store.candidates).toHaveLength(0)
    store.addCandidate(sampleSection({ termCode: '202620', courseNumber: '300' }))
    expect(store.candidates.map((c) => c.courseNumber)).toEqual(['300'])
    useCoursePlannerStore().selectedTermCode = '202610'
    expect(store.candidates.map((c) => c.courseNumber)).toEqual(['140'])
  })

  it('mutating candidates clears any generated results', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    await store.generate()
    expect(store.generated).toBe(true)
    store.addCandidate(sampleSection({ courseNumber: '200' }))
    expect(store.generated).toBe(false)
    expect(store.combos).toHaveLength(0)
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('persistence', () => {
  it('round-trips candidates through localStorage', () => {
    useSchoolAndTerm()
    useScheduleBuilderStore().addCandidate(sampleSection())
    const raw = JSON.parse(localStorage.getItem('coursePlanner:candidates'))
    expect(raw['rice:202610']).toHaveLength(1)

    setActivePinia(createPinia())
    useSchoolAndTerm()
    expect(useScheduleBuilderStore().candidates).toHaveLength(1)
  })
})

// ── ensureSections ────────────────────────────────────────────────────────────

describe('ensureSections', () => {
  it('fetches each distinct subject once and skips cache hits after', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ courseNumber: '140' }))
    store.addCandidate(sampleSection({ courseNumber: '200' }))
    store.addCandidate(sampleSection({ subjectCode: 'MATH', courseNumber: '101' }))
    expect(await store.ensureSections()).toBe(true)
    expect(api.getSections).toHaveBeenCalledTimes(2) // COMP once, MATH once
    expect(await store.ensureSections()).toBe(true)
    expect(api.getSections).toHaveBeenCalledTimes(2) // all cached now
  })

  it('a second call aborts the first (double-click guard) without surfacing an error', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    let firstSignal
    api.getSections.mockImplementationOnce((school, params, { signal }) =>
      new Promise((resolve, reject) => {
        firstSignal = signal
        signal.addEventListener('abort', () => reject(abortError()))
      })
    )
    const first = store.ensureSections()
    const second = store.ensureSections()
    expect(await first).toBe(false)
    expect(firstSignal.aborted).toBe(true)
    expect(await second).toBe(true)
    expect(store.errors.sections).toBe('')
    expect(store.loading.sections).toBe(false)
  })

  it('surfaces a fetch failure and keeps already-cached subjects', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    await store.ensureSections() // caches COMP
    store.addCandidate(sampleSection({ subjectCode: 'MATH', courseNumber: '101' }))
    api.getSections.mockRejectedValueOnce(new Error('scrape timed out'))
    expect(await store.ensureSections()).toBe(false)
    expect(store.errors.sections).toBe('scrape timed out')
    // COMP stayed cached: retry only refetches MATH.
    api.getSections.mockClear()
    api.getSections.mockResolvedValueOnce([sampleSection({ subjectCode: 'MATH', courseNumber: '101' })])
    expect(await store.ensureSections()).toBe(true)
    expect(api.getSections).toHaveBeenCalledTimes(1)
  })
})

// ── generate ──────────────────────────────────────────────────────────────────

describe('generate', () => {
  it('builds conflict-free combos and a work shift prunes overlapping sections', async () => {
    useSchoolAndTerm()
    const planner = useCoursePlannerStore()
    const store = useScheduleBuilderStore()
    const nine = sampleSection({ crn: 'NINE', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
    const one = sampleSection({ crn: 'ONE', sectionNumber: '002', meetings: [{ days: ['M'], startTime: '13:00', endTime: '13:50' }] })
    api.getSections.mockResolvedValue([nine, one])
    store.addCandidate(nine)
    planner.setWorkShifts([{ id: 'w1', days: ['M'], startTime: '08:00', endTime: '12:00' }])

    await store.generate()
    expect(store.generated).toBe(true)
    expect(store.combos).toHaveLength(1)
    expect(store.combos[0].sections[0].crn).toBe('ONE')
    expect(store.activeCombo).toBe(store.combos[0])
    expect(store.previewSections).toHaveLength(1)
  })

  it('a fetch failure yields no combos and an error message', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    api.getSections.mockRejectedValueOnce(new Error('upstream down'))
    await store.generate()
    expect(store.errors.sections).toBe('upstream down')
    expect(store.combos).toHaveLength(0)
    expect(store.generated).toBe(false)
  })

  it('a pinned section constrains every combo', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const s1 = sampleSection({ crn: 'A', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
    const s2 = sampleSection({ crn: 'B', sectionNumber: '002', meetings: [{ days: ['T'], startTime: '09:00', endTime: '09:50' }] })
    api.getSections.mockResolvedValue([s1, s2])
    store.addCandidate(s1)

    await store.generate()
    expect(store.combos).toHaveLength(2)

    store.setPin('rice:202610:COMP:140', 'B')
    await store.generate()
    expect(store.combos).toHaveLength(1)
    expect(store.combos[0].sections[0].crn).toBe('B')
  })

  it('a pin survives filters that would drop it and is flagged', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const early = sampleSection({ crn: 'EARLY', meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] })
    api.getSections.mockResolvedValue([early])
    store.addCandidate(early)
    store.setPin('rice:202610:COMP:140', 'EARLY')
    store.setFilters({ earliestStart: '09:00' })

    await store.generate()
    expect(store.combos).toHaveLength(1)
    expect(store.combos[0].sections[0].crn).toBe('EARLY')
    expect(store.pinOverrides).toEqual(['COMP 140'])
  })

  it('reports emptySlots when filters remove every section of a course', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const early = sampleSection({ meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] })
    api.getSections.mockResolvedValue([early])
    store.addCandidate(early)
    store.setFilters({ earliestStart: '09:00' })

    await store.generate()
    expect(store.combos).toHaveLength(0)
    expect(store.emptySlots).toHaveLength(1)
    expect(store.emptySlots[0].reason).toBe('filtered-out')
    expect(store.emptySlots[0].label).toBe('COMP 140')
  })

  it('changing filters clears results until the next generate', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    await store.generate()
    expect(store.generated).toBe(true)
    store.setFilters({ daysOff: ['F'] })
    expect(store.generated).toBe(false)
    expect(store.combos).toHaveLength(0)
  })
})

// ── resetForSchoolChange ──────────────────────────────────────────────────────

describe('resetForSchoolChange', () => {
  it('clears buckets, cache, results, and errors', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    await store.generate()
    store.errors.sections = 'boom'

    store.resetForSchoolChange()

    expect(store.candidates).toHaveLength(0)
    expect(store.combos).toHaveLength(0)
    expect(store.generated).toBe(false)
    expect(store.errors.sections).toBe('')
    expect(JSON.parse(localStorage.getItem('coursePlanner:candidates'))).toEqual({})

    // Cache is gone: the same candidate refetches.
    api.getSections.mockClear()
    useCoursePlannerStore().selectedTermCode = '202610'
    store.addCandidate(sampleSection())
    await store.ensureSections()
    expect(api.getSections).toHaveBeenCalledTimes(1)
  })
})
