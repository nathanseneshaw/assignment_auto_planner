/**
 * Tests for banner-ssb.js campus scoping — the `campus` / `campusRe` options
 * added for the shared multi-university Banner instances (South Dakota's Board
 * of Regents, the University of Hawaii system, the University of Alaska system).
 *
 * The behaviour worth pinning is that on those instances the catalog-wide
 * `get_subject` facet must NOT be used: it lists every campus's subjects, so the
 * picker would offer subjects that return no sections. Campus-scoped schools
 * derive their subject list from their own sections instead.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import { createBannerScraper } from '../course-planner/banner-ssb.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

function mockRes(body) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k) => (k.toLowerCase() === 'set-cookie' ? 'JSESSIONID=s; Path=/' : null),
      getSetCookie: () => ['JSESSIONID=s; Path=/'],
      forEach: () => {},
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
  }
}

/** A section row as Banner's searchResults returns it. */
function row({ subject, subjectDescription, courseNumber, campusDescription, crn }) {
  return {
    subject,
    subjectDescription,
    courseNumber,
    sequenceNumber: '001',
    courseReferenceNumber: crn,
    courseTitle: `${subject} ${courseNumber}`,
    campusDescription,
    maximumEnrollment: 30,
    enrollment: 10,
    seatsAvailable: 20,
    openSection: true,
    faculty: [],
    meetingsFaculty: [],
  }
}

const ALL_ROWS = [
  row({ subject: 'CSC', subjectDescription: 'Computer Science', courseNumber: '150', campusDescription: 'SDSU South Dakota State Univ', crn: '1' }),
  row({ subject: 'CSC', subjectDescription: 'Computer Science', courseNumber: '105', campusDescription: 'USD University of South Dakota', crn: '2' }),
  row({ subject: 'NURS', subjectDescription: 'Nursing', courseNumber: '200', campusDescription: 'USD University of South Dakota', crn: '3' }),
  row({ subject: 'AVIA', subjectDescription: 'Aviation', courseNumber: '101', campusDescription: 'DSU Dakota State University', crn: '4' }),
]

/** Route requests, recording every URL so the tests can assert on the query. */
function makeFetch({ subjects, results }) {
  const seen = []
  globalThis.fetch = async (url) => {
    seen.push(url)
    let res
    if (url.includes('get_subject')) res = mockRes(subjects)
    else if (url.includes('searchResults')) res = mockRes(results(url))
    else res = mockRes('')
    return { ...res, url }
  }
  return seen
}

describe('banner-ssb campus scoping', () => {
  it('sends txt_campus on the section search when `campus` is set', async () => {
    const scraper = createBannerScraper({
      school: 'test-campus',
      base: 'https://test.edu',
      campus: 'S',
    })
    const seen = makeFetch({
      subjects: [],
      results: () => ({ totalCount: 1, data: [ALL_ROWS[0]] }),
    })
    await scraper.getSections({ termCode: '202680', subjectCode: 'CSC' })
    const search = seen.find((u) => u.includes('searchResults'))
    assert.ok(search.includes('txt_campus=S'), `expected txt_campus in ${search}`)
  })

  it('derives subjects from this campus rather than the catalog facet', async () => {
    const scraper = createBannerScraper({
      school: 'test-campus-subj',
      base: 'https://test.edu',
      campusRe: /^USD\b/,
    })
    // The catalog facet lists every campus's subjects — if it were used, ART
    // would leak into the picker.
    const seen = makeFetch({
      subjects: [{ code: 'ART', description: 'Art' }],
      results: () => ({ totalCount: ALL_ROWS.length, data: ALL_ROWS }),
    })
    const subjects = await scraper.getSubjects('202680')
    assert.deepEqual(
      subjects.map((s) => s.code),
      ['CSC', 'NURS']
    )
    assert.equal(subjects[0].label, 'Computer Science')
    assert.ok(!seen.some((u) => u.includes('get_subject')), 'must not call get_subject')
  })

  it('uses the catalog facet when the school is not campus-scoped', async () => {
    const scraper = createBannerScraper({ school: 'test-plain', base: 'https://test.edu' })
    const seen = makeFetch({
      subjects: [{ code: 'ART', description: 'Art' }],
      results: () => ({ totalCount: 0, data: [] }),
    })
    const subjects = await scraper.getSubjects('202680')
    assert.deepEqual(subjects, [{ code: 'ART', label: 'Art' }])
    assert.ok(seen.some((u) => u.includes('get_subject')))
  })

  it('filters section rows by campusDescription when txt_campus is a no-op', async () => {
    // Alaska's instance accepts txt_campus and ignores it, so the factory has to
    // drop the other campuses' rows itself.
    const scraper = createBannerScraper({
      school: 'test-alaska',
      base: 'https://test.edu',
      campusRe: /^USD\b/,
    })
    makeFetch({ subjects: [], results: () => ({ totalCount: ALL_ROWS.length, data: ALL_ROWS }) })
    const sections = await scraper.getSections({ termCode: '202680', subjectCode: 'CSC' })
    assert.equal(sections.length, 2)
    assert.deepEqual(
      sections.map((s) => s.crn),
      ['2', '3']
    )
  })

  it('walks every page when the campus catalogue spans more than one', async () => {
    const scraper = createBannerScraper({
      school: 'test-paged',
      base: 'https://test.edu',
      campus: 'S',
    })
    const page = (n) =>
      Array.from({ length: n }, (_, i) =>
        row({
          subject: 'CSC',
          subjectDescription: 'Computer Science',
          courseNumber: String(100 + i),
          campusDescription: 'SDSU South Dakota State Univ',
          crn: String(i),
        })
      )
    makeFetch({
      subjects: [],
      results: (url) => {
        const offset = Number(new URL(url).searchParams.get('pageOffset'))
        return { totalCount: 700, data: offset === 0 ? page(500) : page(200) }
      },
    })
    const sections = await scraper.getSections({ termCode: '202680', subjectCode: 'CSC' })
    assert.equal(sections.length, 700)
  })
})
