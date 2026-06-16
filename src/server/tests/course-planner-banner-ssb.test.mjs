/**
 * Tests for banner-ssb.js factory (createBannerScraper).
 * This factory powers Baylor, TxState, MSU Texas, and UTRGV.
 * We instantiate a test scraper with a fake base URL.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import { createBannerScraper } from '../course-planner/banner-ssb.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body, { cookies = [] } = {}) {
  const setCookieArr = cookies.map((c) => `${c}; Path=/`)
  return {
    ok: true, status: 200,
    headers: {
      get: (k) => (k.toLowerCase() === 'set-cookie' ? setCookieArr.join(', ') : null),
      getSetCookie: () => setCookieArr,
      forEach: () => {},
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
  }
}

function makeFetch(dispatch) {
  return async (url) => {
    const key = Object.keys(dispatch).find((k) => url.includes(k))
    // fetch-cookie reads response.url to determine cookie domain for setCookie
    const res = key ? dispatch[key] : mockRes([])
    return { ...res, url }
  }
}

const scraper = createBannerScraper({ school: 'test-ssb', base: 'https://test.edu' })

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('banner-ssb getTerms', () => {
  it('returns mapped term list', async () => {
    globalThis.fetch = makeFetch({
      'registration': mockRes('', { cookies: ['JSESSIONID=sess'] }),
      'getTerms': mockRes([
        { code: '202510', description: 'Fall 2025 &amp; Summer' },
        { code: '202520', description: 'Spring 2026' },
      ]),
    })
    const terms = await scraper.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, '202510')
    // HTML entity should be decoded
    assert.equal(terms[0].label, 'Fall 2025 & Summer')
    assert.equal(terms[1].label, 'Spring 2026')
  })

  it('returns empty list when Banner returns empty array', async () => {
    cacheFlush()
    const s = createBannerScraper({ school: 'empty-ssb', base: 'https://empty.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'getTerms': mockRes([]),
    })
    assert.deepEqual(await s.getTerms(), [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('banner-ssb getSubjects', () => {
  it('returns subjects with decoded labels', async () => {
    const s = createBannerScraper({ school: 'subj-ssb', base: 'https://subj.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes('', { cookies: ['JSESSIONID=s1'] }),
      'term/search': mockRes(''),
      'get_subject': mockRes([
        { code: 'ACCT', description: 'Accounting &amp; Finance' },
        { code: 'BIOL', description: 'Biology' },
      ]),
    })
    const subjects = await s.getSubjects('202510')
    assert.equal(subjects.length, 2)
    assert.equal(subjects[0].code, 'ACCT')
    assert.equal(subjects[0].label, 'Accounting & Finance')
  })
})

// ── getSections / normalize ───────────────────────────────────────────────────

describe('banner-ssb getSections', () => {
  function sectionPayload(overrides = {}) {
    return {
      success: true,
      data: [{
        courseReferenceNumber: '11111',
        subject: 'CS',
        subjectDescription: 'Computer Science',
        courseNumber: '1301',
        sequenceNumber: '001',
        courseTitle: 'Intro &amp; Beyond',
        openSection: true,
        maximumEnrollment: 25,
        enrollment: 10,
        seatsAvailable: 15,
        creditHours: 3,
        faculty: [{ displayName: 'Prof &amp; Jones' }],
        termDesc: 'Fall 2025',
        meetingsFaculty: [{
          meetingTime: {
            monday: true, tuesday: false, wednesday: true, thursday: false,
            friday: true, saturday: false, sunday: false,
            beginTime: '1000', endTime: '1050',
            buildingDescription: 'CS Building', building: 'CS', room: '201',
          },
        }],
        ...overrides,
      }],
    }
  }

  it('normalizes a section with correct shape', async () => {
    const s = createBannerScraper({ school: 'norm-ssb', base: 'https://norm.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes('', { cookies: ['JSESSIONID=n1'] }),
      'term/search': mockRes(''),
      'searchResults': mockRes(sectionPayload()),
    })
    const sections = await s.getSections({ termCode: '202510', subjectCode: 'CS', termLabel: 'Fall 2025', subjectLabel: 'Computer Science' })
    assert.equal(sections.length, 1)
    const sec = sections[0]
    assert.equal(sec.school, 'norm-ssb')
  })

  it('decodes HTML entities in title and instructor', async () => {
    const s = createBannerScraper({ school: 'ent-ssb', base: 'https://ent.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'term/search': mockRes(''),
      'searchResults': mockRes(sectionPayload()),
    })
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.equal(sec.title, 'Intro & Beyond')
    assert.equal(sec.instructors[0], 'Prof & Jones')
  })

  it('maps openSection:false to "closed"', async () => {
    const s = createBannerScraper({ school: 'cls-ssb', base: 'https://cls.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'term/search': mockRes(''),
      'searchResults': mockRes(sectionPayload({ openSection: false })),
    })
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.equal(sec.status, 'closed')
  })

  it('maps openSection:null to "unknown"', async () => {
    const s = createBannerScraper({ school: 'unk-ssb', base: 'https://unk.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'term/search': mockRes(''),
      'searchResults': mockRes(sectionPayload({ openSection: null })),
    })
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.equal(sec.status, 'unknown')
  })

  it('maps MWF meeting days correctly', async () => {
    const s = createBannerScraper({ school: 'days-ssb', base: 'https://days.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'term/search': mockRes(''),
      'searchResults': mockRes(sectionPayload()),
    })
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.deepEqual(sec.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(sec.meetings[0].startTime, '10:00')
    assert.equal(sec.meetings[0].endTime, '10:50')
    assert.equal(sec.meetings[0].location, 'CS Building 201')
  })

  it('uses creditHourLow as fallback when creditHours is null', async () => {
    const s = createBannerScraper({ school: 'cred-ssb', base: 'https://cred.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'term/search': mockRes(''),
      'searchResults': mockRes(sectionPayload({ creditHours: null, creditHourLow: 4 })),
    })
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.equal(sec.credits, 4)
  })

  it('throws when Banner returns success:false', async () => {
    const s = createBannerScraper({ school: 'fail-ssb', base: 'https://fail.edu' })
    globalThis.fetch = makeFetch({
      'registration': mockRes(''),
      'term/search': mockRes(''),
      'searchResults': mockRes({ success: false }),
    })
    await assert.rejects(
      () => s.getSections({ termCode: '202510', subjectCode: 'CS' }),
      /no data/i
    )
  })

  it('handles mepCode by appending it to URLs', async () => {
    const seen = []
    const s = createBannerScraper({ school: 'mep-ssb', base: 'https://mep.edu', mepCode: 'TEST' })
    globalThis.fetch = async (url) => {
      seen.push(url)
      if (url.includes('registration')) return mockRes('')
      if (url.includes('getTerms')) return mockRes([])
      return mockRes([])
    }
    await s.getTerms()
    assert.ok(seen.some((u) => u.includes('mepCode=TEST')), 'mepCode should appear in at least one URL')
  })
})
