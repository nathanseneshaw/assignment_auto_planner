/**
 * Tests for colleague.js factory (createColleagueScraper).
 * This factory powers TWU and any other Ellucian Colleague Self-Service school.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import { createColleagueScraper } from '../course-planner/colleague.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
  }
}

// Minimal landing page HTML with antiforgery token
const LANDING_HTML = `<html><body>
  <input name="__RequestVerificationToken" value="test-csrf-token" />
</body></html>`

// Typical advanced-search facet response
function advancedSearchData({ terms = [], subjects = [] } = {}) {
  return { Terms: terms, Subjects: subjects }
}

// Typical section search response
function sectionSearchData({ sections = [], totalPages = 1 } = {}) {
  return { Sections: sections, TotalPages: totalPages }
}

function makeScraper(id = 'test') {
  return createColleagueScraper({ school: `colleague-${id}`, base: `https://${id}.edu` })
}

function makeSection(overrides = {}) {
  return {
    CourseName: 'ACCT*2301',
    Number: '01',
    Synonym: '10001',
    Title: 'Principles of Financial Accounting',
    SectionTitleDisplay: 'Principles of Financial Accounting',
    MinimumCredits: 3,
    FacultyDisplay: ['Dr. Smith'],
    Capacity: 30,
    Enrolled: 20,
    Available: 10,
    HasUnlimitedSeats: false,
    AvailabilityStatusDisplay: 'Open',
    TermDisplay: 'Fall 2025',
    FormattedMeetingTimes: [
      {
        Days: [1, 3, 5], // M W F
        StartTime: '09:00:00',
        EndTime: '09:50:00',
        BuildingDisplay: 'Business',
        RoomDisplay: '101',
      },
    ],
    ...overrides,
  }
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('colleague getTerms', () => {
  it('maps Terms array from advanced-search', async () => {
    const s = makeScraper('terms1')
    globalThis.fetch = async (url) => {
      if (url.includes('Student/Courses/GetCatalogAdvancedSearch')) {
        return mockRes(advancedSearchData({
          terms: [
            { Item1: '2025FA', Item2: 'Fall 2025' },
            { Item1: '2026SP', Item2: 'Spring 2026 &amp; Mini' },
          ],
        }))
      }
      return mockRes(LANDING_HTML)
    }
    const terms = await s.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, '2025FA')
    assert.equal(terms[0].label, 'Fall 2025')
    // HTML entity should be decoded
    assert.equal(terms[1].label, 'Spring 2026 & Mini')
  })

  it('filters out terms with empty code', async () => {
    const s = makeScraper('terms2')
    globalThis.fetch = async (url) => {
      if (url.includes('AdvancedSearch')) return mockRes(advancedSearchData({ terms: [{ Item1: '', Item2: 'Bad' }, { Item1: 'GOOD', Item2: 'Good' }] }))
      return mockRes(LANDING_HTML)
    }
    const terms = await s.getTerms()
    assert.equal(terms.length, 1)
    assert.equal(terms[0].code, 'GOOD')
  })

  it('throws when landing page has no antiforgery token', async () => {
    const s = makeScraper('notoken')
    globalThis.fetch = async () => mockRes('<html><body>no token here</body></html>')
    await assert.rejects(() => s.getTerms(), /antiforgery/i)
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('colleague getSubjects', () => {
  it('maps Subjects array and extracts Description', async () => {
    const s = makeScraper('subj1')
    globalThis.fetch = async (url) => {
      if (url.includes('AdvancedSearch')) return mockRes(advancedSearchData({
        subjects: [
          { Code: 'ACCT', Description: 'Accounting', ShowInCourseSearch: true },
          { Code: 'BIOL', Description: 'Biology', ShowInCourseSearch: true },
          { Code: 'HIDDEN', Description: 'Hidden', ShowInCourseSearch: false },
        ],
      }))
      return mockRes(LANDING_HTML)
    }
    const subjects = await s.getSubjects()
    assert.equal(subjects.length, 2)
    assert.equal(subjects[0].code, 'ACCT')
    assert.equal(subjects[0].label, 'Accounting')
    // ShowInCourseSearch:false should be excluded
    assert.ok(!subjects.some((s) => s.code === 'HIDDEN'))
  })

  it('sorts subjects alphabetically by code', async () => {
    const s = makeScraper('subj2')
    globalThis.fetch = async (url) => {
      if (url.includes('AdvancedSearch')) return mockRes(advancedSearchData({
        subjects: [{ Code: 'ZOOL', Description: 'Zoology' }, { Code: 'ACC', Description: 'Acc' }],
      }))
      return mockRes(LANDING_HTML)
    }
    const subjects = await s.getSubjects()
    assert.equal(subjects[0].code, 'ACC')
    assert.equal(subjects[1].code, 'ZOOL')
  })
})

// ── getSections / normalize ───────────────────────────────────────────────────

describe('colleague getSections', () => {
  it('returns a fully normalized section', async () => {
    const s = makeScraper('sec1')
    globalThis.fetch = async (url) => {
      if (url.includes('SearchAsync')) return mockRes(sectionSearchData({ sections: [makeSection()] }))
      return mockRes(LANDING_HTML)
    }
    const sections = await s.getSections({ termCode: '2025FA', subjectCode: 'ACCT', termLabel: 'Fall 2025', subjectLabel: 'Accounting' })
    assert.equal(sections.length, 1)
    const sec = sections[0]
    assert.equal(sec.school, 'colleague-sec1')
    assert.equal(sec.crn, '10001')
    assert.equal(sec.subjectCode, 'ACCT')
    assert.equal(sec.courseNumber, '2301')
    assert.equal(sec.sectionNumber, '01')
    assert.equal(sec.title, 'Principles of Financial Accounting')
    assert.equal(sec.credits, 3)
    assert.equal(sec.status, 'open')
    assert.equal(sec.enrollment.max, 30)
    assert.equal(sec.enrollment.current, 20)
    assert.equal(sec.enrollment.available, 10)
    assert.deepEqual(sec.instructors, ['Dr. Smith'])
    assert.equal(sec.meetings.length, 1)
    assert.deepEqual(sec.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(sec.meetings[0].startTime, '09:00')
    assert.equal(sec.meetings[0].endTime, '09:50')
    assert.equal(sec.meetings[0].location, 'Business 101')
  })

  it('maps AvailabilityStatusDisplay "Closed" to "closed"', async () => {
    const s = makeScraper('sec2')
    globalThis.fetch = async (url) => {
      if (url.includes('SearchAsync')) return mockRes(sectionSearchData({ sections: [makeSection({ AvailabilityStatusDisplay: 'Closed', Available: 0 })] }))
      return mockRes(LANDING_HTML)
    }
    const [sec] = await s.getSections({ termCode: '2025FA', subjectCode: 'ACCT' })
    assert.equal(sec.status, 'closed')
  })

  it('maps HasUnlimitedSeats:true to open with null max', async () => {
    const s = makeScraper('sec3')
    globalThis.fetch = async (url) => {
      if (url.includes('SearchAsync')) return mockRes(sectionSearchData({ sections: [makeSection({ HasUnlimitedSeats: true, Capacity: 9999, AvailabilityStatusDisplay: '' })] }))
      return mockRes(LANDING_HTML)
    }
    const [sec] = await s.getSections({ termCode: '2025FA', subjectCode: 'ACCT' })
    assert.equal(sec.enrollment.max, null)
    assert.equal(sec.status, 'open')
  })

  it('omits online/TBA meetings with no days', async () => {
    const online = makeSection({
      FormattedMeetingTimes: [{ Days: [], StartTime: null, EndTime: null, BuildingDisplay: 'Online', RoomDisplay: '' }],
    })
    const s = makeScraper('sec4')
    globalThis.fetch = async (url) => {
      if (url.includes('SearchAsync')) return mockRes(sectionSearchData({ sections: [online] }))
      return mockRes(LANDING_HTML)
    }
    const [sec] = await s.getSections({ termCode: '2025FA', subjectCode: 'ACCT' })
    assert.equal(sec.meetings.length, 0)
  })

  it('paginates when TotalPages > 1', async () => {
    let page1Called = false, page2Called = false
    const s = makeScraper('pages')
    globalThis.fetch = async (url, opts) => {
      if (url.includes('SearchAsync')) {
        const body = JSON.parse(opts.body)
        const params = JSON.parse(body.searchParameters)
        if (params.pageNumber === 1) { page1Called = true; return mockRes(sectionSearchData({ sections: [makeSection({ Synonym: '11111' })], totalPages: 2 })) }
        if (params.pageNumber === 2) { page2Called = true; return mockRes(sectionSearchData({ sections: [makeSection({ Synonym: '22222' })], totalPages: 2 })) }
      }
      return mockRes(LANDING_HTML)
    }
    const sections = await s.getSections({ termCode: '2025FA', subjectCode: 'ACCT' })
    assert.ok(page1Called)
    assert.ok(page2Called)
    assert.equal(sections.length, 2)
  })

  it('filters out Staff placeholder instructors', async () => {
    const sec = makeSection({ FacultyDisplay: ['Staff', 'Dr. Real'] })
    const s = makeScraper('staff')
    globalThis.fetch = async (url) => {
      if (url.includes('SearchAsync')) return mockRes(sectionSearchData({ sections: [sec] }))
      return mockRes(LANDING_HTML)
    }
    const [result] = await s.getSections({ termCode: '2025FA', subjectCode: 'ACCT' })
    assert.deepEqual(result.instructors, ['Dr. Real'])
  })
})
