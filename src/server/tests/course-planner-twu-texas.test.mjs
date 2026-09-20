/**
 * Tests for twu-scraper.js — Texas Woman's University, the one Ellucian
 * Colleague Self-Service school in this build.
 *
 * The engine itself is covered by course-planner-colleague.test.mjs, so this
 * file pins the part that is TWU's own: the host it talks to, the antiforgery
 * round-trip against that host, the section shape it hands the planner, and the
 * `legacyApi` question — the project notes describe a Colleague cohort where
 * four schools need `legacyApi: true`, but neither colleague.js nor TWU knows
 * that option in this tree, so a re-added school passing it would be silently
 * ignored. That is asserted here rather than assumed.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cacheFlush } from '../course-planner/cache.js'
import * as twu from '../course-planner/twu-scraper.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const plannerDir = path.resolve(here, '..', 'course-planner')

const BASE = 'https://selfservice.twu.edu'
const TOKEN = 'twu-antiforgery-token'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
  cacheFlush()
})

function mockRes(body, url) {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

const LANDING = `<html><body>
  <input name="__RequestVerificationToken" type="hidden" value="${TOKEN}" />
</body></html>`

const FACETS = {
  Terms: [
    { Item1: '2026FA', Item2: 'Fall 2026' },
    { Item1: '2027SP', Item2: 'Spring 2027 &amp; Mini' },
    { Item1: '', Item2: 'placeholder with no code' },
  ],
  Subjects: [
    { Code: 'CSCI', Description: 'Computer Science &amp; Info Systems' },
    { Code: 'MATH', Description: 'Mathematics' },
    { Code: 'HIDE', Description: 'Not in search', ShowInCourseSearch: false },
  ],
}

function twuSection(overrides = {}) {
  return {
    CourseName: 'CSCI*2315',
    Number: '01',
    Synonym: '70001',
    Title: 'Data Structures &amp; Algorithms',
    MinimumCredits: 3,
    FacultyDisplay: ['Dr. Ann Rivera', 'Dr. Ann Rivera', 'Staff'],
    Capacity: 30,
    Enrolled: 22,
    Available: 8,
    HasUnlimitedSeats: false,
    AvailabilityStatusDisplay: 'Open',
    TermDisplay: 'Fall 2026',
    FormattedMeetingTimes: [
      {
        Days: [2, 4],
        StartTime: '13:00:00',
        EndTime: '14:20:00',
        BuildingDisplay: 'ACT',
        RoomDisplay: '301',
      },
      { Days: [], StartTime: null, EndTime: null }, // online / TBA row is dropped
    ],
    ...overrides,
  }
}

/** A TWU Colleague Self-Service conversation, recording every request. */
function twuFetch(log, { sections = [], totalPages = 1, facets = FACETS } = {}) {
  return async (url, init = {}) => {
    const target = String(url)
    log.push({ url: target, method: init.method || 'GET', headers: init.headers || {}, body: String(init.body || '') })
    if (target.includes('/Student/Courses/GetCatalogAdvancedSearchAsync')) {
      return mockRes(facets, target)
    }
    if (target.includes('/Student/Courses/SearchAsync')) {
      const page = JSON.parse(JSON.parse(init.body).searchParameters).pageNumber
      return mockRes({ Sections: page <= totalPages ? sections : [], TotalPages: totalPages }, target)
    }
    return mockRes(LANDING, target)
  }
}

// ── host + antiforgery wiring ─────────────────────────────────────────────────

describe('twu is wired to the TWU Colleague host', () => {
  it('only ever talks to selfservice.twu.edu', async () => {
    const log = []
    globalThis.fetch = twuFetch(log, { sections: [twuSection()] })
    await twu.getTerms()
    cacheFlush()
    globalThis.fetch = twuFetch(log, { sections: [twuSection()] })
    await twu.getSubjects('2026FA')
    cacheFlush()
    globalThis.fetch = twuFetch(log, { sections: [twuSection()] })
    await twu.getSections({ termCode: '2026FA', subjectCode: 'CSCI' })
    assert.ok(log.length >= 6)
    for (const entry of log) assert.ok(entry.url.startsWith(`${BASE}/`), entry.url)
  })

  it('harvests the antiforgery token and echoes it on every JSON call', async () => {
    const log = []
    globalThis.fetch = twuFetch(log, { sections: [twuSection()] })
    await twu.getSections({ termCode: '2026FA', subjectCode: 'CSCI' })
    const landing = log.filter((e) => e.url === `${BASE}/Student/Courses`)
    assert.ok(landing.length >= 1, 'the catalog landing page provides the token + cookie')
    for (const entry of log.filter((e) => e.url.includes('Async'))) {
      assert.equal(entry.headers.__RequestVerificationToken, TOKEN, entry.url)
    }
  })

  it('fails loudly when the landing page carries no antiforgery token', async () => {
    globalThis.fetch = async (url) => mockRes('<html><body>maintenance</body></html>', String(url))
    await assert.rejects(() => twu.getTerms(), /no antiforgery token/i)
  })
})

// ── the three contract calls ──────────────────────────────────────────────────

describe('twu getTerms', () => {
  it('maps the Terms tuples and decodes entities', async () => {
    globalThis.fetch = twuFetch([])
    assert.deepEqual(await twu.getTerms(), [
      { code: '2026FA', label: 'Fall 2026' },
      { code: '2027SP', label: 'Spring 2027 & Mini' },
    ])
  })

  it('hands over every term (term-window.js does the trimming)', async () => {
    const many = ['2025FA', '2026SP', '2026FA', '2027SP']
    globalThis.fetch = twuFetch([], {
      facets: { Terms: many.map((c) => ({ Item1: c, Item2: c })), Subjects: [] },
    })
    assert.equal((await twu.getTerms()).length, many.length)
  })
})

describe('twu getSubjects', () => {
  it('drops subjects hidden from course search and sorts by code', async () => {
    globalThis.fetch = twuFetch([])
    assert.deepEqual(await twu.getSubjects('2026FA'), [
      { code: 'CSCI', label: 'Computer Science & Info Systems' },
      { code: 'MATH', label: 'Mathematics' },
    ])
  })
})

describe('twu getSections', () => {
  it('normalizes a section, including full Colleague enrollment', async () => {
    globalThis.fetch = twuFetch([], { sections: [twuSection()] })
    const [sec] = await twu.getSections({
      termCode: '2026FA',
      subjectCode: 'CSCI',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    assert.equal(sec.school, 'twu')
    assert.equal(sec.crn, '70001')
    assert.equal(sec.subjectCode, 'CSCI')
    assert.equal(sec.courseNumber, '2315')
    assert.equal(sec.sectionNumber, '01')
    assert.equal(sec.title, 'Data Structures & Algorithms')
    assert.equal(sec.credits, 3)
    assert.deepEqual(sec.instructors, ['Dr. Ann Rivera'], 'deduped, Staff dropped')
    assert.deepEqual(sec.enrollment, { max: 30, current: 22, available: 8 })
    assert.equal(sec.status, 'open')
    assert.deepEqual(sec.meetings, [
      { days: ['T', 'R'], startTime: '13:00', endTime: '14:20', location: 'ACT 301' },
    ])
  })

  it('marks a full section closed', async () => {
    globalThis.fetch = twuFetch([], {
      sections: [twuSection({ Enrolled: 30, Available: 0, AvailabilityStatusDisplay: 'Closed' })],
    })
    const [sec] = await twu.getSections({ termCode: '2026FA', subjectCode: 'CSCI' })
    assert.equal(sec.status, 'closed')
    assert.equal(sec.enrollment.available, 0)
  })

  it('scopes the search POST to the requested term + subject', async () => {
    const log = []
    globalThis.fetch = twuFetch(log, { sections: [twuSection()] })
    await twu.getSections({ termCode: '2026FA', subjectCode: 'CSCI' })
    const search = log.find((e) => e.url.includes('SearchAsync'))
    const criteria = JSON.parse(JSON.parse(search.body).searchParameters)
    assert.deepEqual(criteria.terms, ['2026FA'])
    assert.deepEqual(criteria.subjects, ['CSCI'])
    assert.equal(criteria.openSections, null, 'closed sections must stay in the results')
  })

  it('walks every reported page', async () => {
    const log = []
    globalThis.fetch = twuFetch(log, { sections: [twuSection()], totalPages: 3 })
    const out = await twu.getSections({ termCode: '2026FA', subjectCode: 'CSCI' })
    assert.equal(out.length, 3)
    const pages = log
      .filter((e) => e.url.includes('SearchAsync'))
      .map((e) => JSON.parse(JSON.parse(e.body).searchParameters).pageNumber)
    assert.deepEqual(pages, [1, 2, 3])
  })

  it('returns an empty list for a subject with no sections', async () => {
    globalThis.fetch = twuFetch([], { sections: [] })
    assert.deepEqual(await twu.getSections({ termCode: '2026FA', subjectCode: 'ZZZZ' }), [])
  })
})

// ── the legacyApi flag ────────────────────────────────────────────────────────

describe('Colleague legacyApi flag', () => {
  const colleagueSrc = fs.readFileSync(path.join(plannerDir, 'colleague.js'), 'utf8')
  const twuSrc = fs.readFileSync(path.join(plannerDir, 'twu-scraper.js'), 'utf8')

  it('TWU is the correct Colleague school and does NOT need the flag', () => {
    // Project notes say TWU / Dallas College / TCC / McLennan / Southwestern /
    // Hardin-Simmons are Colleague and the last four need `legacyApi: true`.
    // Only TWU ships here, and TWU is on the modern SearchAsync API, so no flag
    // is expected — and none exists.
    assert.match(twuSrc, /createColleagueScraper\(\{[\s\S]*base: 'https:\/\/selfservice\.twu\.edu'/)
    assert.ok(!/legacyApi/.test(twuSrc), 'twu-scraper.js should not pass legacyApi')
  })

  it('colleague.js has no legacyApi option, so passing one would be a silent no-op', () => {
    const opts = colleagueSrc.match(/export function createColleagueScraper\(\{([^}]*)\}\)/)
    assert.ok(opts, 'could not read createColleagueScraper options')
    const names = opts[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter(Boolean)
    assert.deepEqual(names, ['school', 'base'])
    assert.ok(
      !/legacyApi/.test(colleagueSrc),
      'if a legacy-Colleague school is re-added, colleague.js must grow the option first'
    )
  })
})
