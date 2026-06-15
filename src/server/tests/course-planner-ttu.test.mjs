/**
 * Tests for Texas Tech scraper (ttu-scraper.js).
 *
 * TTU uses the Banner SSB JSON API with manual cookie forwarding (no fetch-cookie
 * library). We test the pure cookie helpers directly via the exported module, and
 * test the public API by mocking globalThis.fetch.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as ttu from '../course-planner/ttu-scraper.js'

// ── Mock fetch helpers ────────────────────────────────────────────────────────

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

function mockRes(body, { status = 200, cookies = [] } = {}) {
  const setCookieArr = cookies.map((c) => `${c}; Path=/`)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => (k.toLowerCase() === 'set-cookie' ? setCookieArr.join(', ') : null),
      getSetCookie: () => setCookieArr,
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
  }
}

function makeFetch(dispatch) {
  return async (url) => {
    const key = Object.keys(dispatch).find((k) => url.includes(k))
    if (key) return dispatch[key]
    return mockRes([])
  }
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('ttu.getTerms', () => {
  it('returns mapped term list', async () => {
    const termData = [
      { code: '202510', description: 'Fall 2025' },
      { code: '202520', description: 'Spring 2026' },
    ]
    globalThis.fetch = makeFetch({
      'ssb/registration': mockRes('', { cookies: ['JSESSIONID=abc123'] }),
      'classSearch/getTerms': mockRes(termData),
    })
    const terms = await ttu.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, '202510')
    assert.equal(terms[0].label, 'Fall 2025')
  })

  it('returns empty list when Banner returns empty array', async () => {
    globalThis.fetch = makeFetch({
      'ssb/registration': mockRes('', { cookies: [] }),
      'classSearch/getTerms': mockRes([]),
    })
    const terms = await ttu.getTerms()
    assert.deepEqual(terms, [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('ttu.getSubjects', () => {
  it('returns mapped subject list', async () => {
    const subjectData = [
      { code: 'CS', description: 'Computer Science' },
      { code: 'MATH', description: 'Mathematics' },
    ]
    globalThis.fetch = makeFetch({
      'ssb/registration': mockRes('', { cookies: ['JSESSIONID=abc'] }),
      'ssb/term/search': mockRes(''),
      'classSearch/get_subject': mockRes(subjectData),
    })
    const subjects = await ttu.getSubjects('202510')
    assert.equal(subjects.length, 2)
    assert.equal(subjects[0].code, 'CS')
    assert.equal(subjects[0].label, 'Computer Science')
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('ttu.getSections', () => {
  it('returns sections with correct normalized shape', async () => {
    const sectionData = {
      success: true,
      data: [
        {
          courseReferenceNumber: '12345',
          subject: 'CS',
          subjectDescription: 'Computer Science',
          courseNumber: '1301',
          sequenceNumber: '001',
          courseTitle: 'Intro to CS',
          openSection: true,
          maximumEnrollment: 30,
          enrollment: 20,
          seatsAvailable: 10,
          creditHours: 3,
          faculty: [{ displayName: 'Dr. Smith' }],
          termDesc: 'Fall 2025',
          meetingsFaculty: [
            {
              meetingTime: {
                monday: true,
                wednesday: true,
                friday: true,
                tuesday: false,
                thursday: false,
                saturday: false,
                sunday: false,
                beginTime: '0900',
                endTime: '0950',
                buildingDescription: 'Engineering',
                room: '101',
              },
            },
          ],
        },
      ],
    }
    globalThis.fetch = makeFetch({
      'ssb/registration': mockRes('', { cookies: ['JSESSIONID=abc'] }),
      'ssb/term/search': mockRes(''),
      'searchResults/searchResults': mockRes(sectionData),
    })
    const sections = await ttu.getSections({ termCode: '202510', subjectCode: 'CS', termLabel: 'Fall 2025', subjectLabel: 'Computer Science' })
    assert.equal(sections.length, 1)
    const s = sections[0]
    assert.equal(s.school, 'ttu')
    assert.equal(s.crn, '12345')
    assert.equal(s.title, 'Intro to CS')
    assert.equal(s.status, 'open')
    assert.equal(s.credits, 3)
    assert.equal(s.enrollment.max, 30)
    assert.equal(s.enrollment.current, 20)
    assert.equal(s.enrollment.available, 10)
    assert.deepEqual(s.instructors, ['Dr. Smith'])
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '09:00')
    assert.equal(s.meetings[0].endTime, '09:50')
    assert.equal(s.meetings[0].location, 'Engineering 101')
  })

  it('maps openSection:false to closed status', async () => {
    const sectionData = {
      success: true,
      data: [{ courseReferenceNumber: '99999', subject: 'MATH', courseNumber: '1000',
               sequenceNumber: '001', courseTitle: 'Math', openSection: false,
               maximumEnrollment: 30, enrollment: 30, seatsAvailable: 0,
               creditHours: 3, faculty: [], termDesc: '', meetingsFaculty: [] }],
    }
    globalThis.fetch = makeFetch({
      'ssb/registration': mockRes('', { cookies: [] }),
      'ssb/term/search': mockRes(''),
      'searchResults/searchResults': mockRes(sectionData),
    })
    const [s] = await ttu.getSections({ termCode: '202510', subjectCode: 'MATH' })
    assert.equal(s.status, 'closed')
  })

  it('throws when Banner returns success:false', async () => {
    globalThis.fetch = makeFetch({
      'ssb/registration': mockRes('', { cookies: [] }),
      'ssb/term/search': mockRes(''),
      'searchResults/searchResults': mockRes({ success: false }),
    })
    await assert.rejects(
      () => ttu.getSections({ termCode: '202510', subjectCode: 'CS' }),
      /no data/i
    )
  })
})
