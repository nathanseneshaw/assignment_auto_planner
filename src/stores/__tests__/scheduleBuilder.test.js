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

/** Hand-controlled promise, so a test can assert state *while* a fetch is in flight. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Mock implementation that never settles until its AbortSignal fires. */
function hangUntilAborted(capture) {
  return (...args) =>
    new Promise((_resolve, reject) => {
      const { signal } = args[args.length - 1]
      capture?.(signal)
      signal.addEventListener('abort', () => reject(abortError()))
    })
}

/** Let the sequential fetch loop advance past one awaited promise. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
// ── candidate buckets: school + term keying ──────────────────────────────────

describe('candidate buckets', () => {
  it('keys the bucket on school as well as term', () => {
    useSchoolAndTerm('rice', '202610')
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ courseNumber: '140' }))

    useProfileStore().updateProfile({ school: 'ttu' })
    expect(store.candidates).toEqual([])
    store.addCandidate(sampleSection({ school: 'ttu', courseNumber: '250' }))
    expect(store.candidates.map((c) => c.courseNumber)).toEqual(['250'])

    useProfileStore().updateProfile({ school: 'rice' })
    expect(store.candidates.map((c) => c.courseNumber)).toEqual(['140'])
  })

  it('files a candidate under the section term even when none is selected yet', () => {
    useProfileStore().updateProfile({ school: 'rice' })
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ termCode: '202610' }))
    expect(store.candidates).toEqual([]) // nothing selected, so nothing to show
    useCoursePlannerStore().selectedTermCode = '202610'
    expect(store.candidates).toHaveLength(1)
  })

  it('leaves the stored bucket alone when no term is selected', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    useCoursePlannerStore().selectedTermCode = ''

    // Every mutator is guarded on the bucket key; none may touch the term the
    // user just navigated away from.
    store.removeCandidate('rice:202610:COMP:140')
    store.setPin('rice:202610:COMP:140', 'crn-pinned')
    store.clearCandidates()

    useCoursePlannerStore().selectedTermCode = '202610'
    expect(store.candidates).toHaveLength(1)
    expect(store.candidates[0].pinnedCrn).toBe(null)
  })
})

// ── candidate cap ────────────────────────────────────────────────────────────

describe('candidate cap', () => {
  it('canAddMore flips at the eighth course and recovers on removal', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    expect(store.canAddMore).toBe(true)
    for (let i = 1; i <= 7; i++) {
      store.addCandidate(sampleSection({ courseNumber: `10${i}` }))
    }
    expect(store.canAddMore).toBe(true)
    store.addCandidate(sampleSection({ courseNumber: '108' }))
    expect(store.canAddMore).toBe(false)
    store.removeCandidate('rice:202610:COMP:108')
    expect(store.canAddMore).toBe(true)
  })

  it('applies the cap per bucket, not globally', () => {
    useSchoolAndTerm('rice', '202610')
    const store = useScheduleBuilderStore()
    for (let i = 1; i <= 8; i++) {
      store.addCandidate(sampleSection({ courseNumber: String(100 + i) }))
    }
    expect(store.canAddMore).toBe(false)

    useCoursePlannerStore().selectedTermCode = '202620'
    expect(store.canAddMore).toBe(true)
    store.addCandidate(sampleSection({ termCode: '202620', courseNumber: '999' }))
    expect(store.candidates.map((c) => c.courseNumber)).toEqual(['999'])
  })

  it('re-adding a course already on the list keeps the generated results', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ sectionNumber: '001' }))
    await store.generate()
    expect(store.generated).toBe(true)

    // Same course, different section row: a no-op, so results stay put.
    store.addCandidate(sampleSection({ sectionNumber: '002' }))
    expect(store.generated).toBe(true)
    expect(store.combos.length).toBeGreaterThan(0)
  })
})

// ── isCandidate / candidateKey ───────────────────────────────────────────────

describe('isCandidate', () => {
  it('answers for the current bucket only', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const section = sampleSection()
    expect(store.candidateKey(section)).toBe('rice:202610:COMP:140')
    expect(store.isCandidate(section)).toBe(false)

    store.addCandidate(section)
    expect(store.isCandidate(section)).toBe(true)
    // Another course of the same subject is not a candidate...
    expect(store.isCandidate(sampleSection({ courseNumber: '200' }))).toBe(false)
    // ...and neither is the same course once the term changes.
    useCoursePlannerStore().selectedTermCode = '202620'
    expect(store.isCandidate(section)).toBe(false)
  })
})

// ── persistence details ──────────────────────────────────────────────────────

describe('persistence details', () => {
  it('round-trips pins and removals', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ courseNumber: '140' }))
    store.addCandidate(sampleSection({ courseNumber: '200' }))
    store.setPin('rice:202610:COMP:140', 'crn-pinned')
    store.removeCandidate('rice:202610:COMP:200')

    setActivePinia(createPinia())
    useSchoolAndTerm()
    const reloaded = useScheduleBuilderStore()
    expect(reloaded.candidates.map((c) => [c.courseNumber, c.pinnedCrn])).toEqual([
      ['140', 'crn-pinned'],
    ])
  })

  it('unpinning stores null rather than an empty string', () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    store.setPin('rice:202610:COMP:140', 'crn-pinned')
    store.setPin('rice:202610:COMP:140', '')
    expect(store.candidates[0].pinnedCrn).toBe(null)
    expect(JSON.parse(localStorage.getItem('coursePlanner:candidates'))['rice:202610'][0].pinnedCrn).toBe(null)
  })

  it('starts clean when the stored payload is corrupt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('coursePlanner:candidates', '{"rice:202610": [')
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    expect(store.candidates).toEqual([])
    store.addCandidate(sampleSection())
    expect(store.candidates).toHaveLength(1)
    warn.mockRestore()
  })

  it('ignores a stored payload that is not an object', () => {
    localStorage.setItem('coursePlanner:candidates', '"nope"')
    useSchoolAndTerm()
    expect(useScheduleBuilderStore().candidates).toEqual([])
  })
})

// ── ensureSections: progress reporting and cancellation ──────────────────────

describe('ensureSections progress', () => {
  it('reports the subject it is on, in candidate order, and clears when done', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection({ subjectCode: 'COMP', courseNumber: '140' }))
    store.addCandidate(
      sampleSection({ subjectCode: 'MATH', subjectLabel: 'Mathematics', courseNumber: '101' })
    )
    const comp = deferred()
    const math = deferred()
    api.getSections.mockReturnValueOnce(comp.promise).mockReturnValueOnce(math.promise)

    const run = store.ensureSections()
    expect(store.loading.sections).toBe(true)
    expect(store.fetchProgress).toBe('Loading COMP sections (1 of 2)')

    comp.resolve([])
    await tick()
    expect(store.fetchProgress).toBe('Loading MATH sections (2 of 2)')
    // Each subject carries its own label, not the previous one.
    expect(api.getSections).toHaveBeenLastCalledWith(
      'rice',
      expect.objectContaining({ subjectCode: 'MATH', subjectLabel: 'Mathematics' }),
      expect.anything(),
    )

    math.resolve([])
    expect(await run).toBe(true)
    expect(store.fetchProgress).toBe('')
    expect(store.loading.sections).toBe(false)
  })

  it('an aborted run does not clear the flags under the run that replaced it', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    let firstSignal
    api.getSections.mockImplementationOnce(hangUntilAborted((s) => { firstSignal = s }))
    const second = deferred()
    api.getSections.mockReturnValueOnce(second.promise)

    const first = store.ensureSections()
    const run = store.ensureSections()
    expect(await first).toBe(false)
    expect(firstSignal.aborted).toBe(true)
    // The replacement is still fetching: its progress must survive.
    expect(store.loading.sections).toBe(true)
    expect(store.fetchProgress).toBe('Loading COMP sections (1 of 1)')

    second.resolve([sampleSection()])
    expect(await run).toBe(true)
    expect(store.loading.sections).toBe(false)
    expect(store.fetchProgress).toBe('')
  })

  it('resolves true without fetching when there is nothing to load', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    expect(await store.ensureSections()).toBe(true)
    expect(api.getSections).not.toHaveBeenCalled()
    expect(store.loading.sections).toBe(false)
  })
})

// ── generate: pins ───────────────────────────────────────────────────────────

describe('generate pins', () => {
  const KEY = 'rice:202610:COMP:140'

  function twoSections() {
    return [
      sampleSection({ crn: 'A', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] }),
      sampleSection({ crn: 'B', sectionNumber: '002', meetings: [{ days: ['T'], startTime: '09:00', endTime: '09:50' }] }),
    ]
  }

  it('ignores a pin whose CRN is no longer in the catalog', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = twoSections()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])
    store.setPin(KEY, 'DELISTED')

    await store.generate()

    // The slot falls back to the whole course rather than producing nothing.
    expect(store.combos).toHaveLength(2)
    expect(store.emptySlots).toEqual([])
    expect(store.pinOverrides).toEqual([])
  })

  it('unpinning restores the other options', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = twoSections()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])

    store.setPin(KEY, 'B')
    await store.generate()
    expect(store.combos).toHaveLength(1)

    store.setPin(KEY, null)
    await store.generate()
    expect(store.combos).toHaveLength(2)
  })

  it('setting a pin discards the results that were generated without it', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = twoSections()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])
    await store.generate()
    expect(store.combos).toHaveLength(2)

    store.setPin(KEY, 'A')
    expect(store.generated).toBe(false)
    expect(store.combos).toEqual([])
  })
})

// ── generate: multi-component courses ────────────────────────────────────────

describe('generate component slots', () => {
  function lecLab() {
    return [
      sampleSection({ crn: 'L1', sectionNumber: 'LEC 001', meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] }),
      sampleSection({ crn: 'L2', sectionNumber: 'LEC 002', meetings: [{ days: ['T'], startTime: '09:00', endTime: '09:50' }] }),
      sampleSection({ crn: 'B1', sectionNumber: 'LAB 101', meetings: [{ days: ['W'], startTime: '14:00', endTime: '15:50' }] }),
      sampleSection({ crn: 'B2', sectionNumber: 'LAB 102', meetings: [{ days: ['R'], startTime: '14:00', endTime: '15:50' }] }),
    ]
  }

  it('pairs a lecture with a lab, and a pin narrows only its own component', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = lecLab()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])

    await store.generate()
    expect(store.combos).toHaveLength(4) // 2 lectures x 2 labs
    expect(store.combos[0].sections).toHaveLength(2)

    store.setPin('rice:202610:COMP:140', 'L2')
    await store.generate()
    expect(store.combos).toHaveLength(2)
    expect(store.combos.every((c) => c.sections.some((s) => s.crn === 'L2'))).toBe(true)
    // The lab slot keeps both of its options.
    const labs = store.combos.map((c) => c.sections.find((s) => s.sectionNumber.startsWith('LAB')).crn)
    expect([...labs].sort()).toEqual(['B1', 'B2'])
  })

  it('names the component in an empty-slot report', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = lecLab()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])
    store.setFilters({ daysOff: ['W', 'R'] }) // kills every lab, no lecture

    await store.generate()

    expect(store.combos).toEqual([])
    expect(store.emptySlots.map((s) => [s.label, s.reason])).toEqual([
      ['COMP 140 LAB', 'filtered-out'],
    ])
  })
})

// ── generate: filters ────────────────────────────────────────────────────────

describe('generate filters', () => {
  it('openOnly (the default) drops full sections and can be switched off', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const open = sampleSection({ crn: 'OPEN', sectionNumber: '001' })
    const full = sampleSection({
      crn: 'FULL',
      sectionNumber: '002',
      enrollment: { max: 30, current: 30, available: 0 },
    })
    api.getSections.mockResolvedValue([open, full])
    store.addCandidate(open)

    await store.generate()
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['OPEN'])

    store.setFilters({ openOnly: false })
    await store.generate()
    expect(store.combos).toHaveLength(2)
  })

  it('daysOff removes sections that meet on a blocked day', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const mon = sampleSection({ crn: 'MON', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '10:00', endTime: '10:50' }] })
    const fri = sampleSection({ crn: 'FRI', sectionNumber: '002', meetings: [{ days: ['F'], startTime: '10:00', endTime: '10:50' }] })
    api.getSections.mockResolvedValue([mon, fri])
    store.addCandidate(mon)
    store.setFilters({ daysOff: ['F'] })

    await store.generate()
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['MON'])
    expect(store.emptySlots).toEqual([])
  })

  it('latestEnd removes sections that run past it', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const morning = sampleSection({ crn: 'AM', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
    const evening = sampleSection({ crn: 'PM', sectionNumber: '002', meetings: [{ days: ['M'], startTime: '16:00', endTime: '17:50' }] })
    api.getSections.mockResolvedValue([morning, evening])
    store.addCandidate(morning)
    store.setFilters({ latestEnd: '13:00' })

    await store.generate()
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['AM'])
  })

  it('keeps async sections whatever the time filters say', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const online = sampleSection({ crn: 'ONLINE', meetings: [] })
    api.getSections.mockResolvedValue([online])
    store.addCandidate(online)
    store.setFilters({ earliestStart: '10:00', latestEnd: '11:00', daysOff: ['M', 'T', 'W', 'R', 'F'] })

    await store.generate()
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['ONLINE'])
    expect(store.combos[0].metrics.daysOnCampus).toBe(0)
  })
})

// ── generate: limits and empty results ───────────────────────────────────────

describe('generate limits', () => {
  it('caps the list at 200 combos and flags the truncation', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    // 3 courses x 6 async sections = 216 conflict-free combinations.
    const rows = []
    for (const courseNumber of ['140', '200', '300']) {
      for (let i = 1; i <= 6; i++) {
        rows.push(sampleSection({ courseNumber, sectionNumber: `00${i}`, meetings: [] }))
      }
    }
    api.getSections.mockResolvedValue(rows)
    for (const courseNumber of ['140', '200', '300']) {
      store.addCandidate(sampleSection({ courseNumber }))
    }

    await store.generate()
    expect(store.combos).toHaveLength(200)
    expect(store.truncated).toBe(true)

    // Drop a course and the whole space fits again.
    store.removeCandidate('rice:202610:COMP:300')
    await store.generate()
    expect(store.combos).toHaveLength(36)
    expect(store.truncated).toBe(false)
  })

  it('reports a candidate the catalog no longer lists', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    api.getSections.mockResolvedValue([sampleSection({ courseNumber: '999' })])
    store.addCandidate(sampleSection({ courseNumber: '140' }))

    await store.generate()

    expect(store.combos).toEqual([])
    expect(store.emptySlots.map((s) => [s.label, s.reason])).toEqual([['COMP 140', 'no-sections']])
    // The run still counts as generated: the UI shows "no schedules", not "not run yet".
    expect(store.generated).toBe(true)
  })

  it('does nothing at all without candidates', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    await store.generate()
    expect(api.getSections).not.toHaveBeenCalled()
    expect(store.generated).toBe(false)
    expect(store.combos).toEqual([])
  })

  it('reuses the cached sections on a second generate', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    await store.generate()
    await store.generate()
    expect(api.getSections).toHaveBeenCalledTimes(1)
    expect(store.combos.length).toBeGreaterThan(0)
  })
})

// ── sorting ──────────────────────────────────────────────────────────────────

describe('sorting', () => {
  /** One course, two options: a single early Monday vs. a two-day mid-morning. */
  function twoShapes() {
    return [
      sampleSection({ crn: 'EARLY', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] }),
      sampleSection({ crn: 'LATE', sectionNumber: '002', meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '09:50' }] }),
    ]
  }

  it('re-sorts the existing combos without refetching and resets the cursor', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = twoShapes()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])

    await store.generate() // default: fewestDays
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['EARLY', 'LATE'])
    store.comboIndex = 1

    store.setSortKey('latestStart')
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['LATE', 'EARLY'])
    expect(store.comboIndex).toBe(0)
    expect(api.getSections).toHaveBeenCalledTimes(1)
  })

  it('falls back to fewest days for an unknown sort key', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = twoShapes()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])
    await store.generate()

    store.setSortKey('latestStart')
    store.setSortKey('not-a-real-key')
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['EARLY', 'LATE'])
  })

  it('generate honours the sort key that is already selected', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    const rows = twoShapes()
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])
    store.setSortKey('latestStart')

    await store.generate()
    expect(store.combos.map((c) => c.sections[0].crn)).toEqual(['LATE', 'EARLY'])
  })
})

// ── active combo cursor ──────────────────────────────────────────────────────

describe('active combo cursor', () => {
  async function generateTwo(store) {
    const rows = [
      sampleSection({ crn: 'FIRST', sectionNumber: '001', meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] }),
      sampleSection({ crn: 'SECOND', sectionNumber: '002', meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '09:50' }] }),
    ]
    api.getSections.mockResolvedValue(rows)
    store.addCandidate(rows[0])
    await store.generate()
  }

  it('follows comboIndex and reads empty past the end', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    await generateTwo(store)

    expect(store.previewSections.map((s) => s.crn)).toEqual(['FIRST'])
    store.comboIndex = 1
    expect(store.previewSections.map((s) => s.crn)).toEqual(['SECOND'])
    store.comboIndex = 99
    expect(store.activeCombo).toBe(null)
    expect(store.previewSections).toEqual([])
  })

  it('clearResults wipes the results and the cursor but keeps the candidates', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    await generateTwo(store)
    store.comboIndex = 1

    store.clearResults()

    expect(store.combos).toEqual([])
    expect(store.comboIndex).toBe(0)
    expect(store.truncated).toBe(false)
    expect(store.emptySlots).toEqual([])
    expect(store.pinOverrides).toEqual([])
    expect(store.generated).toBe(false)
    expect(store.candidates).toHaveLength(1)
  })
})

// ── resetForSchoolChange: cancellation ───────────────────────────────────────

describe('resetForSchoolChange cancellation', () => {
  it('aborts the in-flight fetch and clears its progress', async () => {
    useSchoolAndTerm()
    const store = useScheduleBuilderStore()
    store.addCandidate(sampleSection())
    let signal
    api.getSections.mockImplementationOnce(hangUntilAborted((s) => { signal = s }))

    const run = store.ensureSections()
    expect(store.loading.sections).toBe(true)

    store.resetForSchoolChange()

    expect(await run).toBe(false)
    expect(signal.aborted).toBe(true)
    expect(store.loading.sections).toBe(false)
    expect(store.fetchProgress).toBe('')
    expect(store.errors.sections).toBe('')
  })
})
