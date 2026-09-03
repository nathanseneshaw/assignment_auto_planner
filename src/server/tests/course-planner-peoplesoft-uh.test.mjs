/**
 * Tests for peoplesoft-uh.js (createUhSystemScraper) and the four schools that
 * ride it: UH (00730), UH-Downtown (00784), UH-Clear Lake (00759) and
 * TAMU-Victoria (00765).
 *
 * One public COMMUNITY_ACCESS.CLASS_SEARCH component at saprd.my.uh.edu serves
 * every campus; only the INSTITUTION code selects whose sections come back, so
 * a wrong/missing code silently returns another campus's catalog. Every test
 * stubs globalThis.fetch — nothing here talks to UH.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import { createUhSystemScraper } from '../course-planner/peoplesoft-uh.js'
import * as uh from '../course-planner/uh-scraper.js'
import * as uhd from '../course-planner/uhd-scraper.js'
import * as uhcl from '../course-planner/uhcl-scraper.js'
import * as tamuv from '../course-planner/tamuv-scraper.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
  cacheFlush()
})

const COMPONENT = 'https://saprd.my.uh.edu/psc/saprd/EMPLOYEE/HRMS/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL'

// PeopleSoft suffixes field names with $N occurrence indices; the scraper looks
// them up by prefix, so the suffixes here are deliberately arbitrary.
const INSTITUTION_FIELD = 'CLASS_SRCH_WRK2_INSTITUTION$31$'
const TERM_FIELD = 'CLASS_SRCH_WRK2_STRM$35$'
const SUBJECT_FIELD = 'SSR_CLSRCH_WRK_SUBJECT_SRCH$0'
const OPEN_ONLY_FIELD = 'SSR_CLSRCH_WRK_SSR_OPEN_ONLY$4$'

const FORM_HTML = `<html><body><form id="win0" name="win0">
  <input name="ICSID" value="sid-uh-1" />
  <select name="${INSTITUTION_FIELD}">
    <option value="00730" selected>University of Houston</option>
    <option value="00784">UH-Downtown</option>
    <option value="00759">UH-Clear Lake</option>
    <option value="00765">Texas A&amp;M-Victoria</option>
  </select>
  <select name="${TERM_FIELD}">
    <option value="">select</option>
    <option value="2620" selected>2026 Fall</option>
    <option value="2610">2026 Spring</option>
    <option value="2550">2025 Summer</option>
  </select>
  <select name="${SUBJECT_FIELD}">
    <option value="">select subject</option>
    <option value="COSC" selected>COSC (Computer Science)</option>
    <option value="MATH">MATH (Mathematics)</option>
    <option value="ODDONE">ODDONE</option>
  </select>
  <input type="checkbox" name="${OPEN_ONLY_FIELD}" value="Y" checked />
  <input type="button" name="CLASS_SRCH_WRK2_SSR_PB_CLEAR" value="Clear" />
</form></body></html>`

function sectionRow(i, { crn, classname, daytime, room, instr, status }) {
  return `
    <span id="MTG_CLASS_NBR$${i}">${crn}</span>
    <span id="MTG_CLASSNAME$${i}">${classname}</span>
    <span id="MTG_DAYTIME$${i}">${daytime}</span>
    <span id="MTG_ROOM$${i}">${room}</span>
    <span id="MTG_INSTR$${i}">${instr}</span>
    <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${i}"><img alt="${status}" /></div>`
}

const RESULTS_HTML = `<html><body>
  <input name="ICSID" value="sid-uh-1" />
  <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0">
    <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$0">COSC 1336 - Programming Fundamentals</div>
    ${sectionRow(0, {
      crn: '11111',
      classname: '001-LEC',
      daytime: 'MoWe 9:00AM - 10:30AM',
      room: 'PGH 232',
      instr: 'Jane Smith',
      status: 'Open',
    })}
    ${sectionRow(1, {
      crn: '22222',
      classname: '002-LEC',
      daytime: 'TuTh 1:00PM - 2:30PM',
      room: 'PGH 218',
      instr: 'Staff',
      status: 'Closed',
    })}
  </div>
</body></html>`

/** Class-detail panel with the Class Availability numbers the seat walk reads. */
function detailHtml({ cap, tot, avail }) {
  return `<html><body>
    <input name="ICSID" value="sid-uh-1" />
    <span id="SSR_CLS_DTL_WRK_ENRL_CAP">${cap}</span>
    <span id="SSR_CLS_DTL_WRK_ENRL_TOT">${tot}</span>
    <span id="SSR_CLS_DTL_WRK_AVAILABLE_SEATS">${avail}</span>
  </body></html>`
}

const SEATS_BY_INDEX = {
  0: { cap: 40, tot: 31, avail: 9 },
  1: { cap: 35, tot: 35, avail: 0 },
}

function mockRes(body) {
  return {
    ok: true,
    status: 200,
    url: COMPONENT,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

/**
 * A whole UH PeopleSoft conversation: GET -> search form, POST search ->
 * results, POST MTG_CLASSNAME$N -> that section's detail panel, POST BACK ->
 * results again. Records every POST body so tests can assert the criteria.
 */
function makeFetch({ posts = [], seats = true } = {}) {
  return async (url, init = {}) => {
    if (!init.method || init.method === 'GET') return mockRes(FORM_HTML)
    const body = new URLSearchParams(String(init.body || ''))
    posts.push(body)
    const action = body.get('ICAction') || ''
    const detail = action.match(/^MTG_CLASSNAME\$(\d+)$/)
    if (detail) {
      if (!seats) return mockRes('<html><body>no availability here</body></html>')
      return mockRes(detailHtml(SEATS_BY_INDEX[detail[1]] || { cap: 0, tot: 0, avail: 0 }))
    }
    return mockRes(RESULTS_HTML)
  }
}

const scraper = createUhSystemScraper({ school: 'uh-test', institution: '00730' })

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('uh-system getTerms', () => {
  it('maps the term dropdown, keeping the raw labels for term-window.js', async () => {
    globalThis.fetch = makeFetch()
    assert.deepEqual(await scraper.getTerms(), [
      { code: '2620', label: '2026 Fall' },
      { code: '2610', label: '2026 Spring' },
      { code: '2550', label: '2025 Summer' },
    ])
  })

  it('skips the empty placeholder option', async () => {
    globalThis.fetch = makeFetch()
    const terms = await scraper.getTerms()
    assert.ok(terms.every((t) => t.code !== ''))
  })

  it('returns an empty list when the form has no term select', async () => {
    const s = createUhSystemScraper({ school: 'uh-noterms', institution: '00730' })
    globalThis.fetch = async () => mockRes('<html><body><form id="win0"></form></body></html>')
    assert.deepEqual(await s.getTerms(), [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('uh-system getSubjects', () => {
  it('prefers the parenthetical as the subject label', async () => {
    const s = createUhSystemScraper({ school: 'uh-subj', institution: '00730' })
    globalThis.fetch = makeFetch()
    assert.deepEqual(await s.getSubjects('2620'), [
      { code: 'COSC', label: 'Computer Science' },
      { code: 'MATH', label: 'Mathematics' },
      { code: 'ODDONE', label: 'ODDONE' },
    ])
  })

  it('caches the subject list independently of the term', async () => {
    const s = createUhSystemScraper({ school: 'uh-subjcache', institution: '00730' })
    let gets = 0
    globalThis.fetch = async (url, init = {}) => {
      if (!init.method) gets += 1
      return mockRes(FORM_HTML)
    }
    await s.getSubjects('2620')
    await s.getSubjects('2610')
    assert.equal(gets, 1, 'subject list is campus-wide, not per-term')
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('uh-system getSections', () => {
  it('parses sections, meetings and open/closed status', async () => {
    const s = createUhSystemScraper({ school: 'uh-sec', institution: '00730' })
    globalThis.fetch = makeFetch()
    const sections = await s.getSections({
      termCode: '2620',
      subjectCode: 'COSC',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)
    const [first, second] = sections
    assert.equal(first.school, 'uh-sec')
    assert.equal(first.crn, '11111')
    assert.equal(first.subjectCode, 'COSC')
    assert.equal(first.courseNumber, '1336')
    assert.equal(first.title, 'Programming Fundamentals')
    assert.equal(first.sectionNumber, '001')
    assert.equal(first.termLabel, 'Fall 2026')
    assert.equal(first.subjectLabel, 'Computer Science')
    assert.deepEqual(first.instructors, ['Jane Smith'])
    assert.deepEqual(first.meetings, [
      { days: ['M', 'W'], startTime: '09:00', endTime: '10:30', location: 'PGH 232' },
    ])
    assert.equal(second.crn, '22222')
    assert.deepEqual(second.instructors, [], 'the Staff placeholder is dropped')
    assert.deepEqual(second.meetings[0].days, ['T', 'R'])
  })

  it('fills enrollment from the class-detail walk', async () => {
    const s = createUhSystemScraper({ school: 'uh-seats', institution: '00730' })
    globalThis.fetch = makeFetch()
    const sections = await s.getSections({ termCode: '2620', subjectCode: 'COSC' })
    const byCrn = Object.fromEntries(sections.map((x) => [x.crn, x]))
    assert.deepEqual(byCrn['11111'].enrollment, { max: 40, current: 31, available: 9 })
    assert.deepEqual(byCrn['22222'].enrollment, { max: 35, current: 35, available: 0 })
    assert.equal(byCrn['11111'].status, 'open')
    assert.equal(byCrn['22222'].status, 'closed')
  })

  it('still returns sections when the seat walk finds no availability panel', async () => {
    const s = createUhSystemScraper({ school: 'uh-noseats', institution: '00730' })
    globalThis.fetch = makeFetch({ seats: false })
    const sections = await s.getSections({ termCode: '2620', subjectCode: 'COSC' })
    assert.equal(sections.length, 2)
    for (const sec of sections) {
      assert.deepEqual(sec.enrollment, { max: null, current: null, available: null })
    }
  })

  it('posts the campus institution code with the search', async () => {
    const posts = []
    const s = createUhSystemScraper({ school: 'uh-inst', institution: '00759' })
    globalThis.fetch = makeFetch({ posts })
    await s.getSections({ termCode: '2620', subjectCode: 'COSC' })
    const search = posts.find(
      (p) => p.get('ICAction') === 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH'
    )
    assert.ok(search, 'expected a class-search POST')
    assert.equal(search.get(INSTITUTION_FIELD), '00759')
    assert.equal(search.get(TERM_FIELD), '2620')
    assert.equal(search.get(SUBJECT_FIELD), 'COSC')
    assert.equal(search.get('ICSID'), 'sid-uh-1')
    assert.equal(search.get('ICAJAX'), '1')
  })

  it('never restricts the search to open sections', async () => {
    const posts = []
    const s = createUhSystemScraper({ school: 'uh-openonly', institution: '00730' })
    globalThis.fetch = makeFetch({ posts })
    await s.getSections({ termCode: '2620', subjectCode: 'COSC' })
    for (const body of posts) {
      assert.equal(body.get(OPEN_ONLY_FIELD), null, 'open-only filter must be stripped')
    }
  })

  it('returns an empty list when the search finds nothing', async () => {
    const s = createUhSystemScraper({ school: 'uh-empty', institution: '00730' })
    globalThis.fetch = async (url, init = {}) => {
      if (!init.method) return mockRes(FORM_HTML)
      return mockRes('<html><body>Your search did not return any results.</body></html>')
    }
    assert.deepEqual(await s.getSections({ termCode: '2620', subjectCode: 'ZZZZ' }), [])
  })

  it('caches sections per term+subject', async () => {
    const posts = []
    const s = createUhSystemScraper({ school: 'uh-cache', institution: '00730' })
    globalThis.fetch = makeFetch({ posts })
    await s.getSections({ termCode: '2620', subjectCode: 'COSC' })
    const afterFirst = posts.length
    await s.getSections({ termCode: '2620', subjectCode: 'COSC' })
    assert.equal(posts.length, afterFirst, 'a repeat click must not re-hit UH')
  })
})

// ── the four registered campuses ──────────────────────────────────────────────

describe('UH-system campuses are wired to distinct institution codes', () => {
  const CAMPUSES = [
    ['uh', uh, '00730'],
    ['uhd', uhd, '00784'],
    ['uhcl', uhcl, '00759'],
    ['tamuv', tamuv, '00765'],
  ]

  for (const [name, mod, institution] of CAMPUSES) {
    it(`${name} searches institution ${institution} on the shared component`, async () => {
      cacheFlush()
      const posts = []
      const urls = []
      globalThis.fetch = async (url, init = {}) => {
        urls.push(String(url))
        return makeFetch({ posts })(url, init)
      }
      const sections = await mod.getSections({ termCode: '2620', subjectCode: 'COSC' })
      const search = posts.find(
        (p) => p.get('ICAction') === 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH'
      )
      assert.ok(search, `${name}: expected a class-search POST`)
      assert.equal(search.get(INSTITUTION_FIELD), institution)
      assert.ok(urls.every((u) => u === COMPONENT), `${name}: unexpected host ${urls[0]}`)
      assert.equal(sections[0].school, name, 'sections must be tagged with this campus')
    })
  }

  it('uses four distinct institution codes', () => {
    const codes = CAMPUSES.map(([, , code]) => code)
    assert.equal(new Set(codes).size, codes.length)
  })
})
