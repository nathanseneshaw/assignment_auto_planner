/**
 * Tests for utd-scraper.js (UT Dallas via the UTDNebula public API).
 *
 * UTD's own CourseBook is reCAPTCHA/NetID-gated, so this scraper consumes
 * api.utdnebula.com, which requires a free `x-api-key` read from
 * process.env.NEBULA_API_KEY. Everything here is stubbed: no test needs a real
 * key, and no test makes a real request.
 *
 * Coverage: the missing-key failure path (must fail cleanly and name the var
 * without echoing any secret), the envelope/paging walk, term-label formatting,
 * course + professor index joins, meeting mapping, and empty/error responses.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as utd from '../course-planner/utd-scraper.js'

const KEY = 'test-nebula-key'

let savedFetch
let savedKey
beforeEach(() => {
  savedFetch = globalThis.fetch
  savedKey = process.env.NEBULA_API_KEY
  process.env.NEBULA_API_KEY = KEY
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
  if (savedKey === undefined) delete process.env.NEBULA_API_KEY
  else process.env.NEBULA_API_KEY = savedKey
  cacheFlush()
})

/** Nebula wraps every payload in { status, message, data }. */
function mockRes(data, { ok = true, status = 200, message = '' } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    json: async () => ({ status, message, data }),
    text: async () => JSON.stringify({ status, message, data }),
  }
}

/**
 * Route Nebula paths to canned payloads. Any unmatched path answers with an
 * empty array, which is how the scraper detects the end of an offset walk.
 */
function makeFetch(routes, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url: String(url), init })
    for (const [needle, payload] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        return typeof payload === 'function' ? payload(String(url)) : mockRes(payload)
      }
    }
    return mockRes([])
  }
}

const COURSES = [
  {
    _id: 'c-cs1337',
    subject_prefix: 'cs',
    course_number: '1337',
    title: 'Computer Science I',
    credit_hours: '3',
  },
  {
    _id: 'c-math2413',
    subject_prefix: 'MATH',
    course_number: '2413',
    title: 'Differential Calculus',
    credit_hours: '4',
  },
]

const PROFESSORS = [
  { _id: 'p-1', first_name: 'Ada', last_name: 'Lovelace' },
  { _id: 'p-2', first_name: '', last_name: '' }, // nameless rows are dropped
]

function section(overrides = {}) {
  return {
    _id: 's-1',
    internal_class_number: '82345',
    section_number: '001',
    course_reference: 'c-cs1337',
    professors: ['p-1', 'p-unknown'],
    academic_session: { name: '26F' },
    meetings: [
      {
        meeting_days: ['Monday', 'Wednesday'],
        start_time: '1000',
        end_time: '1115',
        location: { building: 'ECSS', room: '2.410' },
      },
    ],
    ...overrides,
  }
}

// ── the API key ───────────────────────────────────────────────────────────────

describe('utd NEBULA_API_KEY handling', () => {
  it('getSubjects fails cleanly (no crash) when the key is missing', async () => {
    delete process.env.NEBULA_API_KEY
    let called = false
    globalThis.fetch = async () => {
      called = true
      throw new Error('a request was made without an API key')
    }
    await assert.rejects(() => utd.getSubjects('26F'), /NEBULA_API_KEY is not set/)
    assert.equal(called, false, 'the key check must short-circuit before any request')
  })

  it('getTerms fails cleanly when the key is missing', async () => {
    delete process.env.NEBULA_API_KEY
    globalThis.fetch = async () => {
      throw new Error('should not be reached')
    }
    await assert.rejects(() => utd.getTerms(), /NEBULA_API_KEY/)
  })

  it('getSections fails cleanly when the key is missing', async () => {
    delete process.env.NEBULA_API_KEY
    globalThis.fetch = async () => {
      throw new Error('should not be reached')
    }
    await assert.rejects(
      () => utd.getSections({ termCode: '26F', subjectCode: 'CS' }),
      /NEBULA_API_KEY/
    )
  })

  it('the missing-key error names the var but leaks no secret material', async () => {
    process.env.NEBULA_API_KEY = ''
    globalThis.fetch = async () => mockRes([])
    const err = await utd.getTerms().then(
      () => null,
      (e) => e
    )
    assert.ok(err, 'expected a rejection for an empty key')
    assert.match(err.message, /NEBULA_API_KEY/)
    assert.ok(!err.message.includes(KEY), 'error message must not echo a key')
  })

  it('sends the key as an x-api-key header, never in the URL', async () => {
    const seen = []
    globalThis.fetch = makeFetch({ '/course/all': COURSES }, seen)
    await utd.getSubjects('26F')
    assert.ok(seen.length > 0)
    for (const { url, init } of seen) {
      assert.ok(url.startsWith('https://api.utdnebula.com/'), `unexpected host: ${url}`)
      assert.ok(!url.includes(KEY), 'the key must never appear in a URL')
      assert.equal(init.headers['x-api-key'], KEY)
    }
  })
})

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('utd getTerms', () => {
  it('derives terms from the CS 1337 staple and formats "Season YYYY" labels', async () => {
    globalThis.fetch = makeFetch({
      '/course/sections': (url) =>
        url.includes('former_offset=0') && url.includes('latter_offset=0')
          ? mockRes([
              { academic_session: { name: '26F' } },
              { academic_session: { name: '26S' } },
              { academic_session: { name: '25U' } },
              { academic_session: { name: '26W' } },
              { academic_session: { name: '26F' } }, // duplicate collapses
            ])
          : mockRes([]),
    })
    const terms = await utd.getTerms()
    assert.deepEqual(terms, [
      { code: '26F', label: 'Fall 2026' },
      { code: '26S', label: 'Spring 2026' },
      { code: '25U', label: 'Summer 2025' },
      { code: '26W', label: 'Winter 2026' },
    ])
  })

  it('accepts the 4-digit year spelling and passes unknown codes through', async () => {
    globalThis.fetch = makeFetch({
      '/course/sections': (url) =>
        url.includes('former_offset=0') && url.includes('latter_offset=0')
          ? mockRes([
              { academic_session: { name: '2026F' } },
              { academic_session: { name: 'WEIRD' } },
              { academic_session: {} }, // no name at all -> skipped
            ])
          : mockRes([]),
    })
    const terms = await utd.getTerms()
    assert.deepEqual(terms, [
      { code: '2026F', label: 'Fall 2026' },
      { code: 'WEIRD', label: 'WEIRD' },
    ])
  })

  it('returns an empty list when Nebula has no sections', async () => {
    globalThis.fetch = makeFetch({})
    assert.deepEqual(await utd.getTerms(), [])
  })

  it('does not trim the term list itself (term-window.js owns that)', async () => {
    const codes = ['24F', '25S', '25F', '26S', '26F']
    globalThis.fetch = makeFetch({
      '/course/sections': (url) =>
        url.includes('former_offset=0') && url.includes('latter_offset=0')
          ? mockRes(codes.map((c) => ({ academic_session: { name: c } })))
          : mockRes([]),
    })
    const terms = await utd.getTerms()
    assert.deepEqual(terms.map((t) => t.code), codes)
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('utd getSubjects', () => {
  it('returns distinct upper-cased subject prefixes, sorted', async () => {
    globalThis.fetch = makeFetch({
      '/course/all': [
        ...COURSES,
        { _id: 'c-cs2336', subject_prefix: 'CS', course_number: '2336' },
        { _id: 'c-blank', subject_prefix: '', course_number: '1' },
      ],
    })
    assert.deepEqual(await utd.getSubjects('26F'), [
      { code: 'CS', label: 'CS' },
      { code: 'MATH', label: 'MATH' },
    ])
  })

  it('returns an empty list when the course index comes back empty', async () => {
    globalThis.fetch = makeFetch({ '/course/all': null })
    assert.deepEqual(await utd.getSubjects('26F'), [])
  })

  it('throws a descriptive error on an API failure', async () => {
    globalThis.fetch = makeFetch({
      '/course/all': () => mockRes(null, { ok: false, status: 401, message: 'unauthorized' }),
    })
    await assert.rejects(() => utd.getSubjects('26F'), /HTTP 401/)
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('utd getSections', () => {
  const routes = (sections) => ({
    '/course/all': COURSES,
    '/professor/all': PROFESSORS,
    '/section?': (url) => (url.includes('offset=0&') || url.endsWith('offset=0') ? mockRes(sections) : mockRes([])),
  })

  it('maps a section into the unified shape', async () => {
    globalThis.fetch = makeFetch(routes([section()]))
    const out = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.equal(out.length, 1)
    assert.deepEqual(out[0], {
      school: 'utd',
      termCode: '26F',
      termLabel: 'Fall 2026',
      subjectCode: 'CS',
      subjectLabel: 'CS',
      courseNumber: '1337',
      sectionNumber: '001',
      crn: '82345',
      title: 'Computer Science I',
      instructors: ['Ada Lovelace'],
      credits: 3,
      enrollment: { max: null, current: null, available: null },
      status: 'unknown',
      meetings: [{ days: ['M', 'W'], startTime: '10:00', endTime: '11:15', location: 'ECSS 2.410' }],
    })
  })

  it('filters to the requested subject via the course index', async () => {
    globalThis.fetch = makeFetch(
      routes([
        section(),
        section({ _id: 's-2', internal_class_number: '9', course_reference: 'c-math2413' }),
        section({ _id: 's-3', internal_class_number: '10', course_reference: 'c-missing' }),
      ])
    )
    const cs = await utd.getSections({ termCode: '26F', subjectCode: 'cs' })
    assert.deepEqual(cs.map((s) => s.crn), ['82345'])
    cacheFlush()
    globalThis.fetch = makeFetch(
      routes([
        section(),
        section({ _id: 's-2', internal_class_number: '9', course_reference: 'c-math2413' }),
      ])
    )
    const math = await utd.getSections({ termCode: '26F', subjectCode: 'MATH' })
    assert.deepEqual(math.map((s) => s.courseNumber), ['2413'])
  })

  it('falls back to the Mongo id when no internal class number exists', async () => {
    globalThis.fetch = makeFetch(routes([section({ internal_class_number: null })]))
    const [sec] = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.equal(sec.crn, 's-1')
  })

  it('drops unknown professor ids and keeps the resolvable ones', async () => {
    globalThis.fetch = makeFetch(routes([section({ professors: ['p-unknown', 'p-2', 'p-1'] })]))
    const [sec] = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.deepEqual(sec.instructors, ['Ada Lovelace'])
  })

  it('handles a missing professors array', async () => {
    globalThis.fetch = makeFetch(routes([section({ professors: null })]))
    const [sec] = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.deepEqual(sec.instructors, [])
  })

  it('drops TBA meetings with no days, time or location', async () => {
    globalThis.fetch = makeFetch(
      routes([
        section({
          meetings: [
            { meeting_days: [], start_time: '', end_time: '', location: {} },
            { meeting_days: ['Friday'], start_time: '1300', end_time: '1350', location: {} },
          ],
        }),
      ])
    )
    const [sec] = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.equal(sec.meetings.length, 1)
    assert.deepEqual(sec.meetings[0].days, ['F'])
    assert.equal(sec.meetings[0].location, '')
  })

  it('maps every full day name to the unified single-letter code', async () => {
    globalThis.fetch = makeFetch(
      routes([
        section({
          meetings: [
            {
              meeting_days: [
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
                'Sunday',
                'Monday',
              ],
              start_time: '0800',
              end_time: '0850',
              location: { building: 'JO', room: '1.1' },
            },
          ],
        }),
      ])
    )
    const [sec] = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.deepEqual(sec.meetings[0].days, ['M', 'T', 'W', 'R', 'F', 'S', 'U'])
  })

  it('prefers the caller-supplied term label when present', async () => {
    globalThis.fetch = makeFetch(routes([section()]))
    const [sec] = await utd.getSections({
      termCode: '26F',
      subjectCode: 'CS',
      termLabel: 'Fall 2026',
    })
    assert.equal(sec.termLabel, 'Fall 2026')
  })

  it('never reports seat data (Nebula exposes none)', async () => {
    globalThis.fetch = makeFetch(routes([section(), section({ _id: 's-9', internal_class_number: '99' })]))
    const out = await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    assert.equal(out.length, 2)
    for (const s of out) {
      assert.equal(s.status, 'unknown')
      assert.deepEqual(s.enrollment, { max: null, current: null, available: null })
    }
  })

  it('returns an empty list when the term has no sections', async () => {
    globalThis.fetch = makeFetch({ '/course/all': COURSES, '/professor/all': PROFESSORS })
    assert.deepEqual(await utd.getSections({ termCode: '26F', subjectCode: 'CS' }), [])
  })

  it('surfaces an upstream error rather than silently returning nothing', async () => {
    globalThis.fetch = makeFetch({
      '/course/all': COURSES,
      '/professor/all': PROFESSORS,
      '/section?': () => mockRes(null, { ok: false, status: 500, message: 'boom' }),
    })
    await assert.rejects(
      () => utd.getSections({ termCode: '26F', subjectCode: 'CS' }),
      /HTTP 500/
    )
  })

  it('scopes the section request to the requested term', async () => {
    const seen = []
    globalThis.fetch = makeFetch(routes([section()]), seen)
    await utd.getSections({ termCode: '26F', subjectCode: 'CS' })
    const sectionCalls = seen.filter((s) => s.url.includes('/section?'))
    assert.ok(sectionCalls.length > 0)
    for (const call of sectionCalls) {
      assert.ok(call.url.includes('academic_session.name=26F'), call.url)
    }
  })
})
