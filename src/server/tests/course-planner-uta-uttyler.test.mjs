/**
 * Tests for the two hand-rolled UT Share PeopleSoft scrapers.
 *
 *  - uta-scraper.js       free-text SUBJECT field, so the subject list comes
 *                         from the lookup button walked one alphabet tab at a
 *                         time; searches need a second criterion (catalog >= 0).
 *  - uttyler-scraper.js   NOT reachable cold: the class-search component
 *                         302s into SAML SSO unless a guest PS_TOKEN cookie is
 *                         already in the jar. The scraper gets one by hitting
 *                         the my.uttyler.edu landing page FIRST. A regression
 *                         in that warm-up silently returns zero sections, so
 *                         the ordering and the cookie hand-off are pinned here.
 *
 * Every request is stubbed; nothing in this file touches utshare.utsystem.edu.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as uta from '../course-planner/uta-scraper.js'
import * as uttyler from '../course-planner/uttyler-scraper.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
  cacheFlush()
})

function mockRes(body, { url, cookies = [] } = {}) {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get: (k) => (k.toLowerCase() === 'set-cookie' && cookies.length ? cookies.join(', ') : null),
      getSetCookie: () => cookies,
      forEach: () => {},
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

function sectionRow(i, { crn, classname, daytime, room, instr, status }) {
  return `
    <span id="MTG_CLASS_NBR$${i}">${crn}</span>
    <span id="MTG_CLASSNAME$${i}">${classname}</span>
    <span id="MTG_DAYTIME$${i}">${daytime}</span>
    <span id="MTG_ROOM$${i}">${room}</span>
    <span id="MTG_INSTR$${i}">${instr}</span>
    <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${i}"><img alt="${status}" /></div>`
}

function resultsHtml(header, rows) {
  return `<html><body>
    <input name="ICSID" value="sid-2" />
    <input name="ICStateNum" value="3" />
    <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0">
      <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$0">${header}</div>
      ${rows}
    </div>
  </body></html>`
}

function detailHtml({ cap, tot, avail }) {
  return `<html><body>
    <input name="ICSID" value="sid-2" />
    <input name="ICStateNum" value="4" />
    <span id="SSR_CLS_DTL_WRK_ENRL_CAP">${cap}</span>
    <span id="SSR_CLS_DTL_WRK_ENRL_TOT">${tot}</span>
    <span id="SSR_CLS_DTL_WRK_AVAILABLE_SEATS">${avail}</span>
  </body></html>`
}

// ══ UT Arlington ══════════════════════════════════════════════════════════════

const UTA_URL =
  'https://arcs-prd.utshare.utsystem.edu/psc/ARCSPRD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL'
const UTA_INST = 'CLASS_SRCH_WRK2_INSTITUTION$31$'
const UTA_TERM = 'CLASS_SRCH_WRK2_STRM$35$'
const UTA_SUBJ = 'SSR_CLSRCH_WRK_SUBJECT$0'
const UTA_CAT = 'SSR_CLSRCH_WRK_CATALOG_NBR$1'
const UTA_MATCH = 'SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$2'
const UTA_OPEN_ONLY = 'SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3'

const UTA_FORM = `<html><body><form id="win0" name="win0">
  <input name="ICSID" value="sid-1" />
  <select name="${UTA_INST}"><option value="UTARL" selected>UT Arlington</option></select>
  <select name="${UTA_TERM}">
    <option value="">select</option>
    <option value="2268" selected>2026 Fall</option>
    <option value="2262">2026 Spring</option>
  </select>
  <input name="${UTA_SUBJ}" value="" />
  <input name="${UTA_CAT}" value="" />
  <select name="${UTA_MATCH}"><option value="E" selected>is exactly</option><option value="G">greater than or equal to</option></select>
  <input type="checkbox" name="${UTA_OPEN_ONLY}" value="Y" checked />
  <input type="button" name="CLASS_SRCH_WRK2_SSR_PB_CLEAR" value="Clear" />
</form></body></html>`

/** One subject-lookup letter tab. */
function utaLetterTab(rows) {
  const cells = rows
    .map(
      ([code, label], n) => `
        <span id="UTA_CLSRCH_SUBJ_SUBJECT$${n}">${code}</span>
        <span id="SUBJECT_TBL_DESCRFORMAL$${n}">${label}</span>`
    )
    .join('')
  return `<html><body><input name="ICSID" value="sid-rotated" />${cells}</body></html>`
}

const UTA_RESULTS = resultsHtml(
  'CSE 1310 - Introduction to Computers &amp; Programming',
  sectionRow(0, {
    crn: '30001',
    classname: '001-LEC',
    daytime: 'MoWeFr 10:00AM - 10:50AM',
    room: 'ERB 129',
    instr: 'Alan Turing',
    status: 'Open',
  }) +
    sectionRow(1, {
      crn: '30002',
      classname: '002-LEC',
      daytime: 'TuTh 2:00PM - 3:20PM',
      room: 'ERB 130',
      instr: 'Staff',
      status: 'Closed',
    })
)

const UTA_SEATS = { 0: { cap: 60, tot: 45, avail: 15 }, 1: { cap: 60, tot: 60, avail: 0 } }

function utaFetch({ posts = [], letterTabs = {}, searchResponses = null } = {}) {
  let searches = 0
  return async (url, init = {}) => {
    assert.equal(String(url), UTA_URL, `unexpected UTA host: ${url}`)
    if (!init.method) return mockRes(UTA_FORM, { url: UTA_URL })
    const body = new URLSearchParams(String(init.body || ''))
    posts.push(body)
    const action = body.get('ICAction') || ''
    if (action === 'CLASS_SRCH_WRK2_SSR_PB_SUBJ_SRCH$0') {
      return mockRes(letterTabs.A || utaLetterTab([]), { url: UTA_URL })
    }
    const letter = action.match(/^SSR_CLSRCH_WRK2_SSR_ALPHANUM_([A-Z])$/)
    if (letter) return mockRes(letterTabs[letter[1]] || utaLetterTab([]), { url: UTA_URL })
    const detail = action.match(/^MTG_CLASSNAME\$(\d+)$/)
    if (detail) return mockRes(detailHtml(UTA_SEATS[detail[1]]), { url: UTA_URL })
    if (action === 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH') {
      const canned = searchResponses ? searchResponses[Math.min(searches, searchResponses.length - 1)] : null
      searches += 1
      return mockRes(canned || UTA_RESULTS, { url: UTA_URL })
    }
    return mockRes(UTA_RESULTS, { url: UTA_URL })
  }
}

describe('uta getTerms', () => {
  it('reads the term dropdown and leaves the labels alone', async () => {
    globalThis.fetch = utaFetch()
    assert.deepEqual(await uta.getTerms(), [
      { code: '2268', label: '2026 Fall' },
      { code: '2262', label: '2026 Spring' },
    ])
  })
})

describe('uta getSubjects (alphabet-tab lookup walk)', () => {
  it('merges every letter tab, dedupes and sorts by code', async () => {
    const posts = []
    globalThis.fetch = utaFetch({
      posts,
      letterTabs: {
        A: utaLetterTab([['ARCH', 'Architecture'], ['ACCT', 'Accounting']]),
        C: utaLetterTab([['CSE', 'Computer Science & Engineering'], ['ACCT', 'Accounting']]),
        M: utaLetterTab([['MATH', 'Mathematics']]),
      },
    })
    const subjects = await uta.getSubjects('2268')
    assert.deepEqual(subjects, [
      { code: 'ACCT', label: 'Accounting' },
      { code: 'ARCH', label: 'Architecture' },
      { code: 'CSE', label: 'Computer Science & Engineering' },
      { code: 'MATH', label: 'Mathematics' },
    ])
    // Lookup button + 25 remaining letter tabs, all on one session.
    assert.equal(posts.length, 26)
    assert.equal(posts[0].get('ICAction'), 'CLASS_SRCH_WRK2_SSR_PB_SUBJ_SRCH$0')
    assert.equal(posts[1].get('ICAction'), 'SSR_CLSRCH_WRK2_SSR_ALPHANUM_B')
  })

  it('pins the institution and term on every lookup post', async () => {
    const posts = []
    globalThis.fetch = utaFetch({ posts, letterTabs: { A: utaLetterTab([['ACCT', 'Accounting']]) } })
    await uta.getSubjects('2262')
    for (const body of posts) {
      assert.equal(body.get(UTA_INST), 'UTARL')
      assert.equal(body.get(UTA_TERM), '2262')
    }
  })

  it('advances ICStateNum and follows a rotated ICSID', async () => {
    const posts = []
    globalThis.fetch = utaFetch({ posts, letterTabs: { A: utaLetterTab([['ACCT', 'Accounting']]) } })
    await uta.getSubjects('2268')
    assert.equal(posts[0].get('ICSID'), 'sid-1')
    assert.equal(posts[0].get('ICStateNum'), '1')
    assert.equal(posts[1].get('ICSID'), 'sid-rotated', 'PeopleSoft rotates ICSID per response')
    assert.equal(posts[1].get('ICStateNum'), '2')
  })

  it('throws rather than reporting an empty subject list', async () => {
    globalThis.fetch = utaFetch()
    await assert.rejects(() => uta.getSubjects('2268'), /returned no subjects/i)
  })
})

describe('uta getSections', () => {
  it('parses sections and fills seats from the class-detail walk', async () => {
    globalThis.fetch = utaFetch()
    const sections = await uta.getSections({
      termCode: '2268',
      subjectCode: 'CSE',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science & Engineering',
    })
    assert.equal(sections.length, 2)
    const [a, b] = sections
    assert.equal(a.school, 'uta')
    assert.equal(a.crn, '30001')
    assert.equal(a.subjectCode, 'CSE')
    assert.equal(a.courseNumber, '1310')
    assert.equal(a.title, 'Introduction to Computers & Programming')
    assert.deepEqual(a.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(a.meetings[0].location, 'ERB 129')
    assert.deepEqual(a.enrollment, { max: 60, current: 45, available: 15 })
    assert.equal(a.status, 'open')
    assert.deepEqual(b.enrollment, { max: 60, current: 60, available: 0 })
    assert.equal(b.status, 'closed')
  })

  it('sends the two required criteria (subject + catalog number >= 0)', async () => {
    const posts = []
    globalThis.fetch = utaFetch({ posts })
    await uta.getSections({ termCode: '2268', subjectCode: 'CSE' })
    const search = posts.find((p) => p.get('ICAction') === 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH')
    assert.ok(search)
    assert.equal(search.get(UTA_INST), 'UTARL')
    assert.equal(search.get(UTA_TERM), '2268')
    assert.equal(search.get(UTA_SUBJ), 'CSE')
    assert.equal(search.get(UTA_CAT), '0')
    assert.equal(search.get(UTA_MATCH), 'G')
    assert.equal(search.get(UTA_OPEN_ONLY), null, 'closed sections must stay in the results')
  })

  it('retries the cold-session "select at least 2 search criteria" bounce', async () => {
    const posts = []
    globalThis.fetch = utaFetch({
      posts,
      searchResponses: [
        '<html><body>Select at least 2 search criteria.</body></html>',
        UTA_RESULTS,
      ],
    })
    const sections = await uta.getSections({ termCode: '2268', subjectCode: 'CSE' })
    assert.equal(sections.length, 2)
    const searches = posts.filter((p) => p.get('ICAction') === 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH')
    assert.ok(searches.length >= 2, 'the bounce must trigger a fresh-session retry')
  })

  it('returns an empty list for a subject with no classes', async () => {
    globalThis.fetch = async (url, init = {}) => {
      if (!init.method) return mockRes(UTA_FORM, { url: UTA_URL })
      return mockRes('<html><body>Your search did not return any results.</body></html>', {
        url: UTA_URL,
      })
    }
    assert.deepEqual(await uta.getSections({ termCode: '2268', subjectCode: 'ZZZZ' }), [])
  })
})

// ══ UT Tyler ══════════════════════════════════════════════════════════════════

const TYLER_BASE = 'https://tycs-prd.utshare.utsystem.edu'
const TYLER_LANDING = `${TYLER_BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`
const TYLER_SEARCH = `${TYLER_BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL`
const GUEST_COOKIE = 'PS_TOKEN=guest-token-abc'

const T_INST = 'CLASS_SRCH_WRK2_INSTITUTION$31$'
const T_TERM = 'CLASS_SRCH_WRK2_STRM$35$'
const T_CAREER = 'SSR_CLSRCH_WRK_ACAD_CAREER$2'
const T_SUBJ = 'SSR_CLSRCH_WRK_SUBJECT_SRCH$0'
const T_CAT = 'SSR_CLSRCH_WRK_CATALOG_NBR$1'
const T_MATCH = 'SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$3'
const T_OPEN_ONLY = 'SSR_CLSRCH_WRK_SSR_OPEN_ONLY$4'
const T_SEARCH_BTN = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH'

const TERMS = [
  ['2268', '2026 Fall'],
  ['2262', '2026 Spring'],
  ['2265', '2026 Summer - SOM'],
]
const SUBJECTS_BY_CAREER = {
  UGRD: [['COSC', 'Computer Science'], ['MATH', 'Mathematics']],
  GRAD: [['COSC', 'Computer Science']],
  MEDS: [['MDED', 'Medical Education']],
  PHAR: [],
  HSCT: [],
}

function opt(value, label, selected) {
  return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`
}

/** The guest class-search form as PeopleSoft would render it in a given state. */
function tylerForm({ term = '', career = '' } = {}) {
  const subjects = SUBJECTS_BY_CAREER[career] || []
  return `<html><body><form id="CLASS_SEARCH" name="win0">
    <input name="ICSID" value="tyl-sid" />
    <input name="ICStateNum" value="2" />
    <select id="${T_INST}" name="${T_INST}">${opt('UTTYL', 'UT Tyler', true)}</select>
    <select id="${T_TERM}" name="${T_TERM}">
      ${opt('', 'select', !term)}
      ${TERMS.map(([c, l]) => opt(c, l, c === term)).join('')}
    </select>
    <select id="${T_CAREER}" name="${T_CAREER}">
      ${opt('', 'select', !career)}
      ${Object.keys(SUBJECTS_BY_CAREER).map((c) => opt(c, c, c === career)).join('')}
    </select>
    <select id="${T_SUBJ}" name="${T_SUBJ}">${subjects.map(([c, l]) => opt(c, l, false)).join('')}</select>
    <input id="${T_CAT}" name="${T_CAT}" value="" />
    <select id="${T_MATCH}" name="${T_MATCH}">${opt('E', 'is exactly', true)}${opt('G', 'greater than or equal to', false)}</select>
    <input type="checkbox" name="${T_OPEN_ONLY}" value="Y" checked />
    <input type="button" name="${T_SEARCH_BTN}" value="Search" />
  </form></body></html>`
}

const TYLER_RESULTS = resultsHtml(
  'COSC 1436 - Programming Fundamentals I',
  sectionRow(0, {
    crn: '40001',
    classname: '001-LEC',
    daytime: 'MoWe 8:00AM - 9:20AM',
    room: 'RBN 3011',
    instr: 'Grace Hopper',
    status: 'Open',
  }) +
    sectionRow(1, {
      crn: '40002',
      classname: '002-LEC',
      daytime: 'Fr 9:00AM - 11:45AM',
      room: 'RBN 3012',
      instr: 'Staff',
      status: 'Closed',
    })
)

const TYLER_WARNING =
  '<html><body><input name="ICSID" value="tyl-sid" /><div id="SSR_SS_WARNING">Your search will return over 50 classes, continue?</div></body></html>'

const TYLER_SEATS = { 0: { cap: 30, tot: 12, avail: 18 }, 1: { cap: 30, tot: 30, avail: 0 } }

/**
 * A UT Tyler guest server. Refuses the class-search component to any request
 * that has not already collected the guest PS_TOKEN from the landing page —
 * exactly as SAML SSO does — so a missing warm-up fails the test loudly.
 */
function tylerFetch({ log = [], warnOnce = false } = {}) {
  let warned = false
  return async (url, init = {}) => {
    const target = String(url)
    const cookie = (init.headers || {}).cookie || ''
    log.push({ url: target, method: init.method || 'GET', cookie, body: String(init.body || '') })

    if (target === TYLER_LANDING) {
      return mockRes('<html><body>Guest landing</body></html>', {
        url: target,
        cookies: [`${GUEST_COOKIE}; Path=/`],
      })
    }
    assert.equal(target, TYLER_SEARCH, `unexpected UT Tyler host: ${target}`)
    if (!cookie.includes('PS_TOKEN')) {
      // What the real host does without the guest token.
      return mockRes('<html><body>redirecting to SAMLAUTH cmd=login</body></html>', { url: target })
    }
    if (!init.method) return mockRes(tylerForm(), { url: target })

    const body = new URLSearchParams(String(init.body || ''))
    const action = body.get('ICAction') || ''
    const term = body.get(T_TERM) || ''
    const career = body.get(T_CAREER) || ''
    const detail = action.match(/^MTG_CLASSNAME\$(\d+)$/)
    if (detail) return mockRes(detailHtml(TYLER_SEATS[detail[1]]), { url: target })
    if (action === 'CLASS_SRCH_WRK2_SSR_PB_BACK') return mockRes(TYLER_RESULTS, { url: target })
    if (action === T_SEARCH_BTN) {
      if (warnOnce && !warned) {
        warned = true
        return mockRes(TYLER_WARNING, { url: target })
      }
      const offered = (SUBJECTS_BY_CAREER[career] || []).some(([c]) => c === body.get(T_SUBJ))
      return mockRes(
        offered ? TYLER_RESULTS : '<html><body>Your search did not return any classes.</body></html>',
        { url: target }
      )
    }
    if (action === '#ICSave') return mockRes(TYLER_RESULTS, { url: target })
    return mockRes(tylerForm({ term, career }), { url: target })
  }
}

describe('uttyler guest warm-up', () => {
  it('hits the landing page BEFORE the class search and carries the PS_TOKEN forward', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getTerms()
    assert.ok(log.length >= 2)
    assert.equal(log[0].url, TYLER_LANDING, 'the guest landing page must be requested first')
    assert.equal(log[1].url, TYLER_SEARCH, 'the class search must come second')
    assert.equal(log[0].cookie, '', 'the landing page is fetched with a cold jar')
    assert.ok(
      log[1].cookie.includes(GUEST_COOKIE),
      `class search must carry the guest PS_TOKEN, got "${log[1].cookie}"`
    )
  })

  it('fails loudly when the class-search form comes back as an SSO redirect', async () => {
    globalThis.fetch = async (url) =>
      mockRes('<html><body>SAMLAUTH cmd=login</body></html>', { url: String(url) })
    await assert.rejects(() => uttyler.getTerms(), /guest class-search form did not load/i)
  })

  it('only ever talks to the UT Tyler host', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getTerms()
    for (const entry of log) assert.ok(entry.url.startsWith(TYLER_BASE), entry.url)
  })
})

describe('uttyler getTerms', () => {
  it('returns every term, SOM cohorts included (term-window.js does the trimming)', async () => {
    globalThis.fetch = tylerFetch()
    assert.deepEqual(await uttyler.getTerms(), [
      { code: '2268', label: '2026 Fall' },
      { code: '2262', label: '2026 Spring' },
      { code: '2265', label: '2026 Summer - SOM' },
    ])
  })
})

describe('uttyler getSubjects', () => {
  it('merges the subject lists of every academic career', async () => {
    globalThis.fetch = tylerFetch()
    assert.deepEqual(await uttyler.getSubjects('2268'), [
      { code: 'COSC', label: 'Computer Science' },
      { code: 'MDED', label: 'Medical Education' },
      { code: 'MATH', label: 'Mathematics' },
    ].sort((a, b) => a.code.localeCompare(b.code)))
  })

  it('drives term then career before reading the subject dropdown', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getSubjects('2268')
    const posts = log.filter((e) => e.method === 'POST').map((e) => new URLSearchParams(e.body))
    const termPosts = posts.filter((p) => p.get('ICAction') === T_TERM)
    const careerPosts = posts.filter((p) => p.get('ICAction') === T_CAREER)
    assert.equal(termPosts.length, careerPosts.length, 'term is always bound before career')
    for (const p of termPosts) assert.equal(p.get(T_TERM), '2268')
    const attempts = {}
    for (const p of careerPosts) {
      const c = p.get(T_CAREER)
      attempts[c] = (attempts[c] || 0) + 1
    }
    assert.deepEqual(Object.keys(attempts).sort(), ['GRAD', 'HSCT', 'MEDS', 'PHAR', 'UGRD'])
    // A career that yields subjects is driven once; an empty one burns its
    // 3-attempt retry budget, because an empty dropdown is indistinguishable
    // from the transient state hiccup the retry exists for.
    assert.equal(attempts.UGRD, 1)
    assert.equal(attempts.GRAD, 1)
    assert.equal(attempts.MEDS, 1)
    assert.equal(attempts.PHAR, 3)
    assert.equal(attempts.HSCT, 3)
  })

  it('never posts the pushbutton values (they overflow a maxlen-1 field)', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getSubjects('2268')
    for (const entry of log.filter((e) => e.method === 'POST')) {
      const body = new URLSearchParams(entry.body)
      assert.equal(body.get(T_SEARCH_BTN), null)
    }
  })
})

describe('uttyler getSections', () => {
  it('parses sections and fills seats via the class-detail walk', async () => {
    globalThis.fetch = tylerFetch()
    const sections = await uttyler.getSections({
      termCode: '2268',
      subjectCode: 'COSC',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    const byCrn = Object.fromEntries(sections.map((s) => [s.crn, s]))
    assert.deepEqual(Object.keys(byCrn).sort(), ['40001', '40002'])
    assert.equal(byCrn['40001'].school, 'uttyler')
    assert.equal(byCrn['40001'].courseNumber, '1436')
    assert.deepEqual(byCrn['40001'].meetings[0].days, ['M', 'W'])
    assert.equal(byCrn['40001'].meetings[0].location, 'RBN 3011')
    assert.deepEqual(byCrn['40001'].enrollment, { max: 30, current: 12, available: 18 })
    assert.equal(byCrn['40002'].status, 'closed')
  })

  it('sends subject + catalog >= 0 and drops the open-only filter', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getSections({ termCode: '2268', subjectCode: 'COSC' })
    const searches = log
      .filter((e) => e.method === 'POST')
      .map((e) => new URLSearchParams(e.body))
      .filter((p) => p.get('ICAction') === T_SEARCH_BTN)
    assert.ok(searches.length > 0)
    for (const p of searches) {
      assert.equal(p.get(T_INST), 'UTTYL')
      assert.equal(p.get(T_TERM), '2268')
      assert.equal(p.get(T_SUBJ), 'COSC')
      assert.equal(p.get(T_CAT), '0')
      assert.equal(p.get(T_MATCH), 'G')
      assert.equal(p.get('ICAJAX'), '1', 'a full-page post silently swallows the query')
      assert.equal(p.get(T_OPEN_ONLY), null)
    }
  })

  it('acknowledges the "over 50 classes" soft warning', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log, warnOnce: true })
    const sections = await uttyler.getSections({ termCode: '2268', subjectCode: 'COSC' })
    assert.ok(sections.length > 0, 'the warning must not swallow the results')
    const acks = log
      .filter((e) => e.method === 'POST')
      .map((e) => new URLSearchParams(e.body))
      .filter((p) => p.get('ICAction') === '#ICSave')
    assert.equal(acks.length, 1)
  })

  it('warms up a guest session for every request it makes', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getSections({ termCode: '2268', subjectCode: 'COSC' })
    const searchHits = log.filter((e) => e.url === TYLER_SEARCH)
    assert.ok(searchHits.length > 0)
    for (const hit of searchHits) {
      assert.ok(hit.cookie.includes('PS_TOKEN'), 'every class-search request needs the guest token')
    }
  })

  it('caches sections per term+subject', async () => {
    const log = []
    globalThis.fetch = tylerFetch({ log })
    await uttyler.getSections({ termCode: '2268', subjectCode: 'COSC' })
    const afterFirst = log.length
    await uttyler.getSections({ termCode: '2268', subjectCode: 'COSC' })
    assert.equal(log.length, afterFirst)
  })
})
