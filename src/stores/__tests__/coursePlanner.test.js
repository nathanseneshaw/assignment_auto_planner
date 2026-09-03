import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The store fetches every catalog resource through this service. Mock the whole
// module so no test ever touches the network; each loader test drives the
// resolved/rejected value it needs.
vi.mock('../../services/coursePlannerApi.js', () => ({
  listSchools: vi.fn(),
  getTerms: vi.fn(),
  getSubjects: vi.fn(),
  getSections: vi.fn(),
}))

import * as api from '../../services/coursePlannerApi.js'
import { useCoursePlannerStore } from '../coursePlanner.js'
import { useProfileStore } from '../profile.js'

// A realistic open section with seats to spare — the happy path for addSection.
function sampleSection(over = {}) {
  return {
    school: 'rice',
    termCode: '202610',
    crn: '12345',
    subjectCode: 'COMP',
    courseNumber: '140',
    sectionNumber: '001',
    title: 'Intro to Programming',
    status: 'open',
    instructors: ['Dr. X'],
    enrollment: { max: 30, current: 10, available: 20 },
    meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '10:00' }],
    ...over,
  }
}

/** Point the store at a school (it reads the code off the profile store). */
function useSchool(code = 'rice') {
  useProfileStore().updateProfile({ school: code })
}

/** Hand-controlled promise, so a test can assert state *while* a load is in flight. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
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

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // Sensible defaults; individual tests override with mock*ValueOnce.
  api.getTerms.mockResolvedValue([{ code: '202610', label: 'Fall 2026' }])
  api.getSubjects.mockResolvedValue([{ code: 'COMP', label: 'Computer Science' }])
  api.getSections.mockResolvedValue([sampleSection()])
})

// ── schoolCode wiring ─────────────────────────────────────────────────────────

describe('schoolCode', () => {
  it('mirrors the profile store school', () => {
    useSchool('ttu')
    expect(useCoursePlannerStore().schoolCode).toBe('ttu')
  })

  it('is an empty string when no school is set', () => {
    expect(useCoursePlannerStore().schoolCode).toBe('')
  })
})

// ── loadTerms ─────────────────────────────────────────────────────────────────

describe('loadTerms', () => {
  it('does nothing when no school is selected', async () => {
    const store = useCoursePlannerStore()
    await store.loadTerms()
    expect(api.getTerms).not.toHaveBeenCalled()
    expect(store.terms).toEqual([])
  })

  it('populates terms for the active school', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    await store.loadTerms()
    expect(api.getTerms).toHaveBeenCalledWith('rice', expect.objectContaining({ signal: expect.anything() }))
    expect(store.terms).toEqual([{ code: '202610', label: 'Fall 2026' }])
    expect(store.loading.terms).toBe(false)
  })

  it('records an error message when the fetch fails', async () => {
    useSchool('rice')
    api.getTerms.mockRejectedValueOnce(new Error('upstream down'))
    const store = useCoursePlannerStore()
    await store.loadTerms()
    expect(store.errors.terms).toBe('upstream down')
    expect(store.terms).toEqual([])
    expect(store.loading.terms).toBe(false)
  })

  it('swallows an AbortError without surfacing an error', async () => {
    useSchool('rice')
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    api.getTerms.mockRejectedValueOnce(abort)
    const store = useCoursePlannerStore()
    await store.loadTerms()
    expect(store.errors.terms).toBe('')
  })
})

// ── loadSubjects ──────────────────────────────────────────────────────────────

describe('loadSubjects', () => {
  it('does nothing without a selected term', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    await store.loadSubjects()
    expect(api.getSubjects).not.toHaveBeenCalled()
  })

  it('populates subjects once a term is selected', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    await store.loadSubjects()
    expect(api.getSubjects).toHaveBeenCalledWith('rice', '202610', expect.anything())
    expect(store.subjects).toEqual([{ code: 'COMP', label: 'Computer Science' }])
  })
})

// ── loadSections ──────────────────────────────────────────────────────────────

describe('loadSections', () => {
  it('does nothing until school + term + subject are all set', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    await store.loadSections()
    expect(api.getSections).not.toHaveBeenCalled()
  })

  it('loads sections and passes the current term/subject selection', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    store.selectedTermLabel = 'Fall 2026'
    store.selectedSubjectCode = 'COMP'
    store.selectedSubjectLabel = 'Computer Science'
    await store.loadSections()
    expect(api.getSections).toHaveBeenCalledWith(
      'rice',
      expect.objectContaining({
        termCode: '202610',
        subjectCode: 'COMP',
        termLabel: 'Fall 2026',
        subjectLabel: 'Computer Science',
      }),
      expect.anything(),
    )
    expect(store.sections).toHaveLength(1)
  })

  it('records an error when the section fetch fails', async () => {
    useSchool('rice')
    api.getSections.mockRejectedValueOnce(new Error('scrape timed out'))
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    store.selectedSubjectCode = 'COMP'
    await store.loadSections()
    expect(store.errors.sections).toBe('scrape timed out')
  })
})

// ── setTerm / setSubject cascades ─────────────────────────────────────────────

describe('setTerm', () => {
  it('sets term, clears the downstream subject/section state, and loads subjects', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedSubjectCode = 'STALE'
    store.sections = [sampleSection()]

    store.setTerm('202610', 'Fall 2026')
    expect(store.selectedTermCode).toBe('202610')
    expect(store.selectedTermLabel).toBe('Fall 2026')
    expect(store.selectedSubjectCode).toBe('')
    expect(store.sections).toEqual([])

    await flushPromises()
    expect(api.getSubjects).toHaveBeenCalledOnce()
  })

  it('clearing the term (empty code) does not trigger a subject load', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.setTerm('')
    await flushPromises()
    expect(api.getSubjects).not.toHaveBeenCalled()
  })
})

describe('setSubject', () => {
  it('sets the subject, clears sections, and loads sections', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    store.setSubject('COMP', 'Computer Science')
    expect(store.selectedSubjectCode).toBe('COMP')
    await flushPromises()
    expect(api.getSections).toHaveBeenCalledOnce()
  })
})

// ── addSection: open / full / closed gating ───────────────────────────────────

describe('addSection availability gating', () => {
  it('saves an open section that has seats', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection())
    expect(store.savedSections).toHaveLength(1)
  })

  it('rejects a section whose status is closed', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ status: 'closed' }))
    expect(store.savedSections).toHaveLength(0)
  })

  it('rejects a full section (available <= 0)', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ enrollment: { max: 30, current: 30, available: 0 } }))
    expect(store.savedSections).toHaveLength(0)
  })

  it('rejects a full section (current >= max even if available is missing)', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ enrollment: { max: 25, current: 25, available: null } }))
    expect(store.savedSections).toHaveLength(0)
  })

  it('saves a section with no enrollment data (status open, counts unknown)', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ enrollment: { max: null, current: null, available: null } }))
    expect(store.savedSections).toHaveLength(1)
  })

  it('ignores a section without a school', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ school: undefined }))
    expect(store.savedSections).toHaveLength(0)
  })

  it('does not add the same section twice', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection())
    store.addSection(sampleSection())
    expect(store.savedSections).toHaveLength(1)
  })
})

// ── visibleSections: the hide-unavailable browse preference ───────────────────

describe('visibleSections', () => {
  const open = sampleSection({ crn: 'OPEN' })
  const closed = sampleSection({ crn: 'CLOSED', courseNumber: '182', status: 'closed' })
  const full = sampleSection({ crn: 'FULL', courseNumber: '215', enrollment: { max: 20, current: 20, available: 0 } })

  it('defaults to hiding full and closed sections', () => {
    const store = useCoursePlannerStore()
    expect(store.hideUnavailable).toBe(true)
    store.sections = [open, closed, full]
    expect(store.visibleSections.map((s) => s.crn)).toEqual(['OPEN'])
    expect(store.hiddenSectionCount).toBe(2)
  })

  it('passes every section through once the preference is off', () => {
    const store = useCoursePlannerStore()
    store.sections = [open, closed, full]
    store.setHideUnavailable(false)
    expect(store.visibleSections).toHaveLength(3)
    expect(store.hiddenSectionCount).toBe(0)
  })

  it('keeps sections whose availability the school does not publish', () => {
    const store = useCoursePlannerStore()
    store.sections = [sampleSection({ status: 'unknown', enrollment: { max: null, current: null, available: null } })]
    expect(store.visibleSections).toHaveLength(1)
  })

  it('persists the preference and restores it for the next store', () => {
    useCoursePlannerStore().setHideUnavailable(false)
    expect(localStorage.getItem('coursePlanner:hideUnavailable')).toBe('false')
    setActivePinia(createPinia())
    expect(useCoursePlannerStore().hideUnavailable).toBe(false)
  })

  it('falls back to hiding when nothing is stored yet', () => {
    localStorage.removeItem('coursePlanner:hideUnavailable')
    expect(useCoursePlannerStore().hideUnavailable).toBe(true)
  })
})

// ── saved sections: per-school keying, isSaved, remove ────────────────────────

describe('saved sections bucketing', () => {
  it('keeps saved sections in a per-school bucket', () => {
    const store = useCoursePlannerStore()
    // Save under rice.
    useSchool('rice')
    store.addSection(sampleSection({ school: 'rice', crn: 'R1' }))
    expect(store.savedSections.map((s) => s.crn)).toEqual(['R1'])
    // Switch schools — a ttu section is invisible from rice and vice-versa.
    useSchool('ttu')
    expect(store.savedSections).toEqual([])
    store.addSection(sampleSection({ school: 'ttu', crn: 'T1' }))
    expect(store.savedSections.map((s) => s.crn)).toEqual(['T1'])
    useSchool('rice')
    expect(store.savedSections.map((s) => s.crn)).toEqual(['R1'])
  })

  it('isSaved reflects whether a section is in the current school bucket', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    const s = sampleSection()
    expect(store.isSaved(s)).toBe(false)
    store.addSection(s)
    expect(store.isSaved(s)).toBe(true)
  })

  it('removeSection drops the section from its bucket', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    const s = sampleSection()
    store.addSection(s)
    store.removeSection(s)
    expect(store.savedSections).toHaveLength(0)
  })
})

// ── persistence round-trip ────────────────────────────────────────────────────

describe('persistence', () => {
  it('persists saved sections to localStorage and reloads them into a fresh store', () => {
    useSchool('rice')
    useCoursePlannerStore().addSection(sampleSection({ crn: 'PERSIST' }))
    expect(JSON.parse(localStorage.getItem('coursePlanner:saved')).rice[0].crn).toBe('PERSIST')

    // A brand-new store (new pinia, same localStorage) hydrates from disk.
    setActivePinia(createPinia())
    useSchool('rice')
    expect(useCoursePlannerStore().savedSections.map((s) => s.crn)).toEqual(['PERSIST'])
  })

  it('persists work shifts and reloads them', () => {
    const shifts = [{ id: 'w1', days: ['M', 'W'], startTime: '09:00', endTime: '17:00' }]
    useCoursePlannerStore().setWorkShifts(shifts)
    expect(JSON.parse(localStorage.getItem('coursePlanner:work'))).toEqual(shifts)

    setActivePinia(createPinia())
    expect(useCoursePlannerStore().workShifts).toEqual(shifts)
  })

  it('setWorkShifts coerces a non-array to an empty list', () => {
    const store = useCoursePlannerStore()
    store.setWorkShifts(null)
    expect(store.workShifts).toEqual([])
  })
})

// ── applyCombo ────────────────────────────────────────────────────────────────

describe('applyCombo', () => {
  it('replaces the whole saved bucket for the combo school', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ crn: 'OLD1' }))
    store.addSection(sampleSection({ crn: 'OLD2' }))
    store.applyCombo([sampleSection({ crn: 'NEW1' }), sampleSection({ crn: 'NEW2' }), sampleSection({ crn: 'NEW3' })])
    expect(store.savedSections.map((s) => s.crn)).toEqual(['NEW1', 'NEW2', 'NEW3'])
  })

  it('leaves other school buckets untouched', () => {
    const store = useCoursePlannerStore()
    useSchool('ttu')
    store.addSection(sampleSection({ school: 'ttu', crn: 'T1' }))
    useSchool('rice')
    store.applyCombo([sampleSection({ crn: 'R1' })])
    useSchool('ttu')
    expect(store.savedSections.map((s) => s.crn)).toEqual(['T1'])
  })

  it('ignores empty or non-array input', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ crn: 'KEEP' }))
    store.applyCombo([])
    store.applyCombo(null)
    expect(store.savedSections.map((s) => s.crn)).toEqual(['KEEP'])
  })

  it('persists the replacement', () => {
    useSchool('rice')
    useCoursePlannerStore().applyCombo([sampleSection({ crn: 'APPLIED' })])
    expect(JSON.parse(localStorage.getItem('coursePlanner:saved')).rice.map((s) => s.crn)).toEqual(['APPLIED'])
  })
})

// ── resetForSchoolChange ──────────────────────────────────────────────────────

describe('resetForSchoolChange', () => {
  it('clears live search state, selection, errors, and every saved bucket', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.terms = [{ code: '202610', label: 'Fall 2026' }]
    store.subjects = [{ code: 'COMP', label: 'CS' }]
    store.sections = [sampleSection()]
    store.selectedTermCode = '202610'
    store.selectedSubjectCode = 'COMP'
    store.errors.terms = 'boom'
    store.addSection(sampleSection({ crn: 'KEEPME' }))
    expect(store.savedSections).toHaveLength(1)

    store.resetForSchoolChange()

    expect(store.terms).toEqual([])
    expect(store.subjects).toEqual([])
    expect(store.sections).toEqual([])
    expect(store.selectedTermCode).toBe('')
    expect(store.selectedSubjectCode).toBe('')
    expect(store.errors.terms).toBe('')
    expect(store.savedSections).toEqual([])
    // The wipe is persisted, not just in-memory.
    expect(JSON.parse(localStorage.getItem('coursePlanner:saved'))).toEqual({})
  })

  it('leaves work shifts untouched (a job is not tied to the catalog)', () => {
    const store = useCoursePlannerStore()
    store.setWorkShifts([{ id: 'w1', days: ['M'], startTime: '08:00', endTime: '12:00' }])
    store.resetForSchoolChange()
    expect(store.workShifts).toHaveLength(1)
  })
})
// ── loader request lifecycle: in-flight flags, supersede, error fallbacks ─────

describe('loader request lifecycle', () => {
  it('holds loading.terms up for the life of the request and drops stale rows first', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.terms = [{ code: 'STALE', label: 'Last school' }]
    const d = deferred()
    api.getTerms.mockReturnValueOnce(d.promise)

    const pending = store.loadTerms()
    // The old list is cleared up front so the dropdown cannot offer another
    // school's terms while the new ones are still on the wire.
    expect(store.terms).toEqual([])
    expect(store.loading.terms).toBe(true)

    d.resolve([{ code: '202620', label: 'Spring 2027' }])
    await pending
    expect(store.terms).toEqual([{ code: '202620', label: 'Spring 2027' }])
    expect(store.loading.terms).toBe(false)
  })

  it('lets the newest term load win when two overlap', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    let firstSignal
    api.getTerms.mockImplementationOnce(hangUntilAborted((s) => { firstSignal = s }))
    api.getTerms.mockResolvedValueOnce([{ code: 'NEW', label: 'Newest' }])

    const first = store.loadTerms()
    const second = store.loadTerms()
    await Promise.all([first, second])

    expect(firstSignal.aborted).toBe(true)
    expect(store.terms).toEqual([{ code: 'NEW', label: 'Newest' }])
    expect(store.errors.terms).toBe('')
    // The superseded run must not switch the spinner off under its replacement.
    expect(store.loading.terms).toBe(false)
  })

  it('falls back to a generic message when the failure carries none', async () => {
    useSchool('rice')
    api.getTerms.mockRejectedValueOnce({})
    api.getSubjects.mockRejectedValueOnce({})
    api.getSections.mockRejectedValueOnce({})
    const store = useCoursePlannerStore()

    await store.loadTerms()
    store.selectedTermCode = '202610'
    await store.loadSubjects()
    store.selectedSubjectCode = 'COMP'
    await store.loadSections()

    expect(store.errors.terms).toBe('Failed to load terms.')
    expect(store.errors.subjects).toBe('Failed to load subjects.')
    expect(store.errors.sections).toBe('Failed to load sections.')
  })

  it('surfaces a subject failure and leaves the picker empty', async () => {
    useSchool('rice')
    api.getSubjects.mockRejectedValueOnce(new Error('subject scrape failed'))
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    await store.loadSubjects()
    expect(store.errors.subjects).toBe('subject scrape failed')
    expect(store.subjects).toEqual([])
    expect(store.loading.subjects).toBe(false)
  })

  it('drops the previous result list before the new sections land', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    store.selectedSubjectCode = 'COMP'
    store.sections = [sampleSection({ crn: 'STALE' })]
    const d = deferred()
    api.getSections.mockReturnValueOnce(d.promise)

    const pending = store.loadSections()
    expect(store.sections).toEqual([])
    expect(store.loading.sections).toBe(true)

    d.resolve([sampleSection({ crn: 'FRESH' })])
    await pending
    expect(store.sections.map((s) => s.crn)).toEqual(['FRESH'])
    expect(store.loading.sections).toBe(false)
  })

  it('ignores an AbortError on the subject and section loads', async () => {
    useSchool('rice')
    api.getSubjects.mockRejectedValueOnce(abortError())
    api.getSections.mockRejectedValueOnce(abortError())
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    await store.loadSubjects()
    store.selectedSubjectCode = 'COMP'
    await store.loadSections()
    expect(store.errors.subjects).toBe('')
    expect(store.errors.sections).toBe('')
  })
})

// ── selection cascade: labels and empty selections ───────────────────────────

describe('selection cascade', () => {
  it('setTerm without a label clears the stale labels and subject list', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.subjects = [{ code: 'OLD', label: 'Old subject' }]
    store.selectedTermLabel = 'Fall 2026'
    store.selectedSubjectCode = 'OLD'
    store.selectedSubjectLabel = 'Old subject'

    store.setTerm('202620')

    expect(store.selectedTermCode).toBe('202620')
    expect(store.selectedTermLabel).toBe('')
    expect(store.selectedSubjectCode).toBe('')
    expect(store.selectedSubjectLabel).toBe('')
    expect(store.subjects).toEqual([])
    await flushPromises() // let the cascaded subject load settle
  })

  it('clearing the subject empties the results without a fetch', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.selectedTermCode = '202610'
    store.sections = [sampleSection()]

    store.setSubject('')

    expect(store.selectedSubjectCode).toBe('')
    expect(store.sections).toEqual([])
    await flushPromises()
    expect(api.getSections).not.toHaveBeenCalled()
  })
})

// ── addSection bucketing rules ───────────────────────────────────────────────

describe('addSection bucketing rules', () => {
  it('files a section under its own school, not the active one', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ school: 'ttu', crn: 'T9' }))
    expect(store.savedSections).toEqual([])
    useSchool('ttu')
    expect(store.savedSections.map((s) => s.crn)).toEqual(['T9'])
  })

  it('treats the same CRN in another term as a different section', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    const fall = sampleSection({ crn: '12345', termCode: '202610' })
    const spring = sampleSection({ crn: '12345', termCode: '202620' })
    store.addSection(fall)
    expect(store.isSaved(spring)).toBe(false)
    store.addSection(spring)
    expect(store.savedSections.map((s) => s.termCode)).toEqual(['202610', '202620'])
  })

  it('accepts a waitlisted section that still has open seats (only closed blocks)', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(
      sampleSection({ status: 'waitlist', enrollment: { max: 30, current: 28, available: 2 } })
    )
    expect(store.savedSections).toHaveLength(1)
  })
})

// ── hide-unavailable: edge cases and its relationship to the saved plan ──────

describe('hide-unavailable edge cases', () => {
  it('hides a waitlist-only section - open seats decide, not the waitlist', () => {
    const store = useCoursePlannerStore()
    const waitlisted = sampleSection({
      crn: 'WL',
      status: 'waitlist',
      enrollment: { max: 30, current: 30, available: 0, waitlistAvailable: 5 },
    })
    store.sections = [waitlisted]
    expect(store.visibleSections).toEqual([])
    // ...but the escape hatch still surfaces it for a student watching the list.
    store.setHideUnavailable(false)
    expect(store.visibleSections.map((s) => s.crn)).toEqual(['WL'])
  })

  it('keeps a saved section that has since filled up, and still lets you remove it', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ crn: 'SAVED' }))
    // The same section comes back full on the next search.
    const nowFull = sampleSection({ crn: 'SAVED', enrollment: { max: 30, current: 30, available: 0 } })
    store.sections = [nowFull]

    expect(store.visibleSections).toEqual([]) // gone from the results list
    expect(store.savedSections).toHaveLength(1) // but still on the weekly grid
    expect(store.isSaved(nowFull)).toBe(true)
    store.removeSection(nowFull)
    expect(store.savedSections).toEqual([])
  })

  it('showing unavailable rows does not make them addable', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.sections = [sampleSection({ crn: 'CLOSED', status: 'closed' })]
    store.setHideUnavailable(false)
    expect(store.visibleSections).toHaveLength(1)
    store.addSection(store.visibleSections[0])
    expect(store.savedSections).toEqual([])
  })

  it('reports no hidden rows when the result list is empty', () => {
    const store = useCoursePlannerStore()
    expect(store.hiddenSectionCount).toBe(0)
    store.sections = [sampleSection({ crn: 'A' }), sampleSection({ crn: 'B', status: 'closed' })]
    expect(store.hiddenSectionCount).toBe(1)
    store.setSubject('') // clearing the subject empties the list
    expect(store.hiddenSectionCount).toBe(0)
  })

  it('filters what a live search returns without discarding the raw rows', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    api.getSections.mockResolvedValueOnce([
      sampleSection({ crn: 'A' }),
      sampleSection({ crn: 'B', status: 'closed' }),
      sampleSection({ crn: 'C', enrollment: { max: 10, current: 10, available: 0 } }),
    ])
    store.selectedTermCode = '202610'
    store.selectedSubjectCode = 'COMP'
    await store.loadSections()

    expect(store.sections).toHaveLength(3)
    expect(store.visibleSections.map((s) => s.crn)).toEqual(['A'])
    expect(store.hiddenSectionCount).toBe(2)
  })

  it('coerces whatever the toggle hands it into a stored boolean', () => {
    const store = useCoursePlannerStore()
    store.setHideUnavailable('')
    expect(store.hideUnavailable).toBe(false)
    expect(localStorage.getItem('coursePlanner:hideUnavailable')).toBe('false')
    store.setHideUnavailable(1)
    expect(store.hideUnavailable).toBe(true)
    expect(localStorage.getItem('coursePlanner:hideUnavailable')).toBe('true')
  })

  it('falls back to hiding when the stored preference is unparseable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('coursePlanner:hideUnavailable', '{')
    expect(useCoursePlannerStore().hideUnavailable).toBe(true)
    warn.mockRestore()
  })

  it('only the JSON literal true keeps the filter on', () => {
    // Anything else that parses (a quoted string, a number) reads as "off".
    localStorage.setItem('coursePlanner:hideUnavailable', '"true"')
    expect(useCoursePlannerStore().hideUnavailable).toBe(false)
  })

  it('survives a school change - it is a browse preference, not school state', () => {
    const store = useCoursePlannerStore()
    store.setHideUnavailable(false)
    store.resetForSchoolChange()
    expect(store.hideUnavailable).toBe(false)
  })
})

// ── removeSection ────────────────────────────────────────────────────────────

describe('removeSection', () => {
  it('removes only the matching row and persists the result', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ crn: 'A' }))
    store.addSection(sampleSection({ crn: 'B' }))

    store.removeSection(sampleSection({ crn: 'NOT-SAVED' }))
    expect(store.savedSections.map((s) => s.crn)).toEqual(['A', 'B'])

    store.removeSection(sampleSection({ crn: 'A' }))
    expect(store.savedSections.map((s) => s.crn)).toEqual(['B'])
    expect(JSON.parse(localStorage.getItem('coursePlanner:saved')).rice.map((s) => s.crn)).toEqual(['B'])
  })

  it('is harmless for a school that has nothing saved', () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    store.addSection(sampleSection({ crn: 'KEEP' }))
    store.removeSection(sampleSection({ school: 'ttu', crn: 'GHOST' }))
    expect(store.savedSections.map((s) => s.crn)).toEqual(['KEEP'])
  })
})

// ── storage recovery ─────────────────────────────────────────────────────────

describe('storage recovery', () => {
  it('starts clean when the saved-section payload is corrupt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('coursePlanner:saved', '{"rice": [')
    useSchool('rice')
    const store = useCoursePlannerStore()
    expect(store.savedSections).toEqual([])
    // ...and the store is still usable afterwards.
    store.addSection(sampleSection({ crn: 'RECOVERED' }))
    expect(store.savedSections.map((s) => s.crn)).toEqual(['RECOVERED'])
    warn.mockRestore()
  })

  it('ignores a saved payload that is not an object', () => {
    localStorage.setItem('coursePlanner:saved', '"nope"')
    useSchool('rice')
    expect(useCoursePlannerStore().savedSections).toEqual([])
  })

  it('starts with no work shifts when their payload is corrupt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('coursePlanner:work', 'not json at all')
    expect(useCoursePlannerStore().workShifts).toEqual([])
    warn.mockRestore()
  })

  it('ignores a work payload that is not an array', () => {
    localStorage.setItem('coursePlanner:work', '{"days":["M"]}')
    expect(useCoursePlannerStore().workShifts).toEqual([])
  })
})

// ── resetForSchoolChange: cancellation ───────────────────────────────────────

describe('resetForSchoolChange cancellation', () => {
  it('aborts every in-flight load and drops the spinners', async () => {
    useSchool('rice')
    const store = useCoursePlannerStore()
    let termsSignal
    let subjectsSignal
    api.getTerms.mockImplementationOnce(hangUntilAborted((s) => { termsSignal = s }))
    api.getSubjects.mockImplementationOnce(hangUntilAborted((s) => { subjectsSignal = s }))
    store.selectedTermCode = '202610'
    const termsRun = store.loadTerms()
    const subjectsRun = store.loadSubjects()
    expect(store.loading.terms).toBe(true)
    expect(store.loading.subjects).toBe(true)

    store.resetForSchoolChange()
    await Promise.all([termsRun, subjectsRun])

    expect(termsSignal.aborted).toBe(true)
    expect(subjectsSignal.aborted).toBe(true)
    expect(store.loading.terms).toBe(false)
    expect(store.loading.subjects).toBe(false)
    // The cancelled requests must not have written anything back.
    expect(store.terms).toEqual([])
    expect(store.subjects).toEqual([])
    expect(store.errors.terms).toBe('')
    expect(store.errors.subjects).toBe('')
  })
})
