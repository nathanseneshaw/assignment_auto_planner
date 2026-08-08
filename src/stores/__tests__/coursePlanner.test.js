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
