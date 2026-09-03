/**
 * Wiring tests for the Banner-family schools that had no test of their own.
 *
 * Both engines (banner-ssb.js / banner-classic.js) are covered in depth by
 * their own suites, so this file does not re-test the parsers 24 times. What it
 * pins is the part that is per-school and therefore per-school breakable:
 *
 *   - which engine each school is wired to,
 *   - the exact host / mod_plsql prefix it talks to,
 *   - the scoping options for the multi-campus shared instances (SDBOR,
 *     University of Alaska, University of Hawaii),
 *   - the per-school term-noise filters (which must never trim the window),
 *   - the deliberately-disabled seat walk at Purdue,
 *
 * plus one representative end-to-end parse per engine. Every request is stubbed.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'

import * as ballstate from '../course-planner/ballstate-scraper.js'
import * as baylor from '../course-planner/baylor-scraper.js'
import * as cofc from '../course-planner/cofc-scraper.js'
import * as hawaii from '../course-planner/hawaii-scraper.js'
import * as msutexas from '../course-planner/msutexas-scraper.js'
import * as sdstate from '../course-planner/sdstate-scraper.js'
import * as txst from '../course-planner/txst-scraper.js'
import * as uaa from '../course-planner/uaa-scraper.js'
import * as uaf from '../course-planner/uaf-scraper.js'
import * as uidaho from '../course-planner/uidaho-scraper.js'
import * as umontana from '../course-planner/umontana-scraper.js'
import * as uncc from '../course-planner/uncc-scraper.js'
import * as unm from '../course-planner/unm-scraper.js'
import * as usd from '../course-planner/usd-scraper.js'
import * as utrgv from '../course-planner/utrgv-scraper.js'
import * as uwyo from '../course-planner/uwyo-scraper.js'
import * as wichita from '../course-planner/wichita-scraper.js'
import * as wmich from '../course-planner/wmich-scraper.js'

import * as gmu from '../course-planner/gmu-scraper.js'
import * as lamar from '../course-planner/lamar-scraper.js'
import * as purdue from '../course-planner/purdue-scraper.js'
import * as stmarys from '../course-planner/stmarys-scraper.js'
import * as utep from '../course-planner/utep-scraper.js'
import * as utsa from '../course-planner/utsa-scraper.js'

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

// ══ Banner 9 SSB ══════════════════════════════════════════════════════════════

const SSB_SCHOOLS = [
  { code: 'ballstate', mod: ballstate, base: 'https://banner.bsu.edu' },
  { code: 'baylor', mod: baylor, base: 'https://bearweb.baylor.edu' },
  { code: 'cofc', mod: cofc, base: 'https://ssb.cofc.edu', closeConnections: true },
  { code: 'hawaii', mod: hawaii, base: 'https://www.sis.hawaii.edu:9234', campus: 'MAN' },
  { code: 'msutexas', mod: msutexas, base: 'https://bannerxefe4.msutexas.edu:1808' },
  { code: 'sdstate', mod: sdstate, base: 'https://registration.sdbor.edu', mepCode: 'BOR', campus: 'S' },
  { code: 'txst', mod: txst, base: 'https://reg-prod.ec.txstate.edu' },
  { code: 'uaa', mod: uaa, base: 'https://reg-prod.ec.alaska.edu', mepCode: 'UAA' },
  { code: 'uaf', mod: uaf, base: 'https://reg-prod.ec.alaska.edu', mepCode: 'UAF' },
  { code: 'uidaho', mod: uidaho, base: 'https://banner.uidaho.edu' },
  { code: 'umontana', mod: umontana, base: 'https://reg-prod.ec.umt.edu' },
  { code: 'uncc', mod: uncc, base: 'https://selfservice.charlotte.edu' },
  { code: 'unm', mod: unm, base: 'https://lobowebapp.unm.edu' },
  { code: 'usd', mod: usd, base: 'https://registration.sdbor.edu', mepCode: 'BOR', campus: 'U' },
  { code: 'utrgv', mod: utrgv, base: 'https://assist.utrgv.edu' },
  { code: 'uwyo', mod: uwyo, base: 'https://wyossb.uwyo.edu' },
  { code: 'wichita', mod: wichita, base: 'https://ssbprod.wichita.edu' },
  { code: 'wmich', mod: wmich, base: 'https://bannerweb.wmich.edu' },
]

const SSB_TERMS = [
  { code: '202710', description: 'Fall 2026' },
  { code: '202620', description: 'Spring 2026' },
]

/** Records every SSB request and answers the JSON endpoints. */
function ssbFetch(log, { terms = SSB_TERMS, rows = null, totalCount } = {}) {
  return async (url, init = {}) => {
    const target = String(url)
    log.push({ url: target, headers: init.headers || {}, method: init.method || 'GET' })
    if (target.includes('classSearch/getTerms')) return mockRes(terms, target)
    if (target.includes('classSearch/get_subject')) {
      return mockRes([{ code: 'CS', description: 'Computer Science' }], target)
    }
    if (target.includes('searchResults/searchResults')) {
      const data = rows || []
      return mockRes({ success: true, totalCount: totalCount ?? data.length, data }, target)
    }
    return mockRes('', target)
  }
}

describe('Banner 9 SSB schools are wired to the right host', () => {
  for (const school of SSB_SCHOOLS) {
    it(`${school.code} -> ${school.base}`, async () => {
      const log = []
      globalThis.fetch = ssbFetch(log)
      const terms = await school.mod.getTerms()
      assert.ok(terms.length > 0, `${school.code}: no terms parsed`)
      assert.ok(log.length >= 2, `${school.code}: expected a registration warm-up + getTerms`)
      for (const entry of log) {
        assert.ok(entry.url.startsWith(school.base), `${school.code}: called ${entry.url}`)
        assert.ok(
          entry.url.includes('/StudentRegistrationSsb/ssb/'),
          `${school.code}: not the Banner 9 SSB engine (${entry.url})`
        )
      }
      const getTermsCall = log.find((e) => e.url.includes('classSearch/getTerms'))
      assert.ok(getTermsCall, `${school.code}: never called getTerms`)
      if (school.mepCode) {
        assert.ok(
          getTermsCall.url.includes(`mepCode=${school.mepCode}`),
          `${school.code}: missing mepCode=${school.mepCode}`
        )
      } else {
        assert.ok(!getTermsCall.url.includes('mepCode='), `${school.code}: unexpected mepCode`)
      }
      assert.equal(
        (getTermsCall.headers || {}).Connection,
        school.closeConnections ? 'close' : undefined,
        `${school.code}: wrong Connection handling`
      )
    })
  }

  it('covers every Banner SSB school that had no test of its own', () => {
    assert.equal(new Set(SSB_SCHOOLS.map((s) => s.code)).size, SSB_SCHOOLS.length)
    assert.equal(SSB_SCHOOLS.length, 18)
  })
})

// ── shared multi-campus instances ─────────────────────────────────────────────

function ssbRow(overrides = {}) {
  return {
    courseReferenceNumber: '10001',
    subject: 'CS',
    subjectDescription: 'Computer Science',
    courseNumber: '1301',
    sequenceNumber: '001',
    courseTitle: 'Intro to Programming',
    openSection: true,
    maximumEnrollment: 40,
    enrollment: 25,
    seatsAvailable: 15,
    creditHours: 3,
    faculty: [{ displayName: 'Ada Lovelace' }],
    campusDescription: 'Main',
    meetingsFaculty: [
      {
        meetingTime: {
          monday: true,
          tuesday: false,
          wednesday: true,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
          beginTime: '1400',
          endTime: '1515',
          buildingDescription: 'Engineering',
          room: '101',
        },
      },
    ],
    ...overrides,
  }
}

describe('shared Banner instances stay scoped to their campus', () => {
  it('SDBOR sends txt_campus=S for SDSU and txt_campus=U for USD', async () => {
    for (const [mod, campus] of [[sdstate, 'S'], [usd, 'U']]) {
      cacheFlush()
      const log = []
      globalThis.fetch = ssbFetch(log, { rows: [ssbRow()] })
      await mod.getSections({ termCode: '202710', subjectCode: 'CS' })
      const search = log.find((e) => e.url.includes('searchResults/searchResults'))
      assert.ok(search)
      assert.ok(search.url.includes(`txt_campus=${campus}`), search.url)
      assert.ok(search.url.includes('mepCode=BOR'), search.url)
    }
  })

  it('Hawaii sends txt_campus=MAN for Manoa', async () => {
    const log = []
    globalThis.fetch = ssbFetch(log, { rows: [ssbRow()] })
    await hawaii.getSections({ termCode: '202710', subjectCode: 'CS' })
    const search = log.find((e) => e.url.includes('searchResults/searchResults'))
    assert.ok(search.url.includes('txt_campus=MAN'), search.url)
  })

  it('Alaska splits UAF from UAA client-side on campusDescription', async () => {
    const rows = [
      ssbRow({ courseReferenceNumber: '1', campusDescription: 'UAF - Fairbanks Campus' }),
      ssbRow({ courseReferenceNumber: '2', campusDescription: 'UAF - eCampus' }),
      ssbRow({ courseReferenceNumber: '3', campusDescription: 'UAA - Anchorage Campus' }),
      ssbRow({ courseReferenceNumber: '4', campusDescription: 'UAS - Juneau Campus' }),
    ]
    cacheFlush()
    globalThis.fetch = ssbFetch([], { rows })
    const fairbanks = await uaf.getSections({ termCode: '202710', subjectCode: 'CS' })
    assert.deepEqual(fairbanks.map((s) => s.crn), ['1', '2'])

    cacheFlush()
    globalThis.fetch = ssbFetch([], { rows })
    const anchorage = await uaa.getSections({ termCode: '202710', subjectCode: 'CS' })
    assert.deepEqual(anchorage.map((s) => s.crn), ['3'])
  })

  it('derives a campus-scoped subject list from that campus own sections', async () => {
    const log = []
    globalThis.fetch = ssbFetch(log, {
      rows: [
        ssbRow({ subject: 'CS', subjectDescription: 'Computer Science' }),
        ssbRow({ subject: 'MATH', subjectDescription: 'Mathematics' }),
        ssbRow({ subject: 'CS', subjectDescription: 'Computer Science' }),
      ],
    })
    const subjects = await sdstate.getSubjects('202710')
    assert.deepEqual(subjects, [
      { code: 'CS', label: 'Computer Science' },
      { code: 'MATH', label: 'Mathematics' },
    ])
    assert.ok(
      !log.some((e) => e.url.includes('get_subject')),
      'the catalog-wide subject facet covers every SDBOR campus and must not be used'
    )
  })
})

// ── per-school term-noise filters ─────────────────────────────────────────────

describe('per-school term filters drop shadowing cohorts without trimming', () => {
  async function termsFrom(mod, descriptions) {
    cacheFlush()
    globalThis.fetch = ssbFetch([], {
      terms: descriptions.map((d, i) => ({ code: `2027${i}0`, description: d })),
    })
    return mod.getTerms()
  }

  it('baylor drops View Only / Trimester / MPAS / LAW variants', async () => {
    const terms = await termsFrom(baylor, [
      '2026 - Fall Trimester (View Only)',
      '2026 - Fall LAW',
      '2026 - Fall MPAS',
      '2026 - Fall',
      '2027 - Spring',
    ])
    assert.deepEqual(terms.map((t) => t.label), ['2026 - Fall', '2027 - Spring'])
  })

  it('baylor falls back to the raw list rather than returning nothing', async () => {
    const terms = await termsFrom(baylor, ['2026 - Fall Trimester', '2026 - Spring LAW'])
    assert.equal(terms.length, 2, 'an over-eager filter must never empty the dropdown')
  })

  it('utrgv drops SOM / SOPM / module / fall-spr cohort terms', async () => {
    const terms = await termsFrom(utrgv, [
      'Fall-Spr 2026-27 SOM Y4',
      'FALL 2026 MODULE 2',
      'FALL 2026 SOPM',
      'FALL 2026',
    ])
    assert.deepEqual(terms.map((t) => t.label), ['FALL 2026'])
  })

  it('umontana drops the School of Law term', async () => {
    const terms = await termsFrom(umontana, [
      'School of Law Autumn 2026',
      'Autumn Semester 2026',
      'Spring Semester 2027',
    ])
    assert.deepEqual(terms.map((t) => t.label), ['Autumn Semester 2026', 'Spring Semester 2027'])
  })

  it('unm drops the MD & PHARMD health-sciences cohort terms', async () => {
    const terms = await termsFrom(unm, ['MD &amp; PHARMD Fall 2026', 'Fall 2026', 'Spring 2027'])
    assert.deepEqual(terms.map((t) => t.label), ['Fall 2026', 'Spring 2027'])
  })

  it('hawaii drops Extension / Apprenticeship / End of Time rows', async () => {
    const terms = await termsFrom(hawaii, [
      'Fall 2026 Extension',
      'Fall 2026 Apprenticeship',
      'Fall 2026',
      'The End of Time',
      'Spring 2027',
    ])
    assert.deepEqual(terms.map((t) => t.label), ['Fall 2026', 'Spring 2027'])
  })

  it('none of the filters trims the list to a current+next window', async () => {
    // term-window.js owns that trim; a scraper doing it too would hide terms.
    const many = ['Fall 2024', 'Spring 2025', 'Fall 2025', 'Spring 2026', 'Fall 2026']
    for (const mod of [baylor, utrgv, umontana, unm, hawaii]) {
      const terms = await termsFrom(mod, many)
      assert.equal(terms.length, many.length, 'a scraper must hand over every clean term')
    }
  })
})

// ── one representative SSB parse ──────────────────────────────────────────────

describe('Banner SSB representative parse (txst)', () => {
  it('normalizes meetings, seats and status', async () => {
    globalThis.fetch = ssbFetch([], { rows: [ssbRow({ courseTitle: 'Intro &amp; Design' })] })
    const [sec] = await txst.getSections({
      termCode: '202710',
      subjectCode: 'CS',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    assert.equal(sec.school, 'txst')
    assert.equal(sec.crn, '10001')
    assert.equal(sec.title, 'Intro & Design')
    assert.equal(sec.status, 'open')
    assert.deepEqual(sec.enrollment, { max: 40, current: 25, available: 15 })
    assert.deepEqual(sec.instructors, ['Ada Lovelace'])
    assert.deepEqual(sec.meetings, [
      { days: ['M', 'W'], startTime: '14:00', endTime: '15:15', location: 'Engineering 101' },
    ])
  })

  it('reports a full section as closed', async () => {
    globalThis.fetch = ssbFetch([], {
      rows: [ssbRow({ openSection: false, enrollment: 40, seatsAvailable: 0 })],
    })
    const [sec] = await txst.getSections({ termCode: '202710', subjectCode: 'CS' })
    assert.equal(sec.status, 'closed')
    assert.equal(sec.enrollment.available, 0)
  })
})

// ══ Banner 8 classic ══════════════════════════════════════════════════════════

const CLASSIC_SCHOOLS = [
  { code: 'gmu', mod: gmu, root: 'https://patriotweb.gmu.edu/pls/prod', trailingSlash: true },
  { code: 'lamar', mod: lamar, root: 'https://ssbprod.lamar.edu/btdb' },
  { code: 'purdue', mod: purdue, root: 'https://selfservice.mypurdue.purdue.edu/prod', enrichSeats: false },
  { code: 'stmarys', mod: stmarys, root: 'https://appssbprd.stmarytx.edu/BPRD' },
  { code: 'utep', mod: utep, root: 'https://goldmine.utep.edu/prod' },
  { code: 'utsa', mod: utsa, root: 'https://asap.utsa.edu/pls/prod' },
]

const CLASSIC_TERM_FORM = `<html><body>
  <select name="p_term">
    <option value="dummy">None</option>
    <option value="202710">Fall 2026</option>
    <option value="202620">Spring 2026 (View only)</option>
  </select>
</body></html>`

const CLASSIC_SUBJECT_FORM = `<html><body>
  <select name="sel_subj">
    <option value="dummy">All</option>
    <option value="CS">Computer Science (CS)</option>
    <option value="MATH">Mathematics</option>
  </select>
</body></html>`

const CLASSIC_LISTING = `<html><body>
  <table class="datadisplaytable">
    <tr><th class="ddtitle"><a href="#">Programming I - 20001 - CS 1063 - 001</a></th></tr>
    <tr><td class="dddefault">
      3.000 Credits
      <table class="datadisplaytable">
        <tr><th class="ddheader">Type</th></tr>
        <tr>
          <td class="dddefault">Class</td>
          <td class="dddefault">10:00 am - 10:50 am</td>
          <td class="dddefault">MWF</td>
          <td class="dddefault">NPB 1.238</td>
          <td class="dddefault">Aug 26, 2026 - Dec 11, 2026</td>
          <td class="dddefault">Lecture</td>
          <td class="dddefault">Grace Hopper (<abbr title="Primary">P</abbr>)</td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`

const CLASSIC_DETAIL = `<html><body><table class="datadisplaytable">
  <tr><th class="ddlabel"><SPAN class="fieldlabeltext">Seats</SPAN></th>
    <td class="dddefault">50</td><td class="dddefault">42</td><td class="dddefault">8</td></tr>
</table></body></html>`

function classicFetch(log) {
  return async (url, init = {}) => {
    const target = String(url)
    log.push({ url: target, method: init.method || 'GET', body: String(init.body || '') })
    if (target.includes('bwckgens.p_proc_term_date')) return mockRes(CLASSIC_SUBJECT_FORM, target)
    if (target.includes('bwckschd.p_get_crse_unsec')) return mockRes(CLASSIC_LISTING, target)
    if (target.includes('bwckschd.p_disp_detail_sched')) return mockRes(CLASSIC_DETAIL, target)
    return mockRes(CLASSIC_TERM_FORM, target)
  }
}

describe('Banner 8 classic schools are wired to the right host + prefix', () => {
  for (const school of CLASSIC_SCHOOLS) {
    it(`${school.code} -> ${school.root}`, async () => {
      const log = []
      globalThis.fetch = classicFetch(log)
      const terms = await school.mod.getTerms()
      assert.deepEqual(terms, [{ code: '202710', label: 'Fall 2026' }, { code: '202620', label: 'Spring 2026 (View only)' }])
      const slash = school.trailingSlash ? '/' : ''
      assert.deepEqual(
        log.map((e) => e.url),
        [`${school.root}/bwckschd.p_disp_dyn_sched${slash}`],
        `${school.code}: wrong term-form URL`
      )
    })
  }

  it('covers every Banner classic school that had no test of its own', () => {
    assert.equal(new Set(CLASSIC_SCHOOLS.map((s) => s.code)).size, CLASSIC_SCHOOLS.length)
    assert.equal(CLASSIC_SCHOOLS.length, 6)
  })

  it('appends the trailing slash to every GMU mod_plsql procedure', async () => {
    const log = []
    globalThis.fetch = classicFetch(log)
    await gmu.getSubjects('202710')
    cacheFlush()
    globalThis.fetch = classicFetch(log)
    await gmu.getSections({ termCode: '202710', subjectCode: 'CS' })
    const procedures = log.filter((e) => e.url.includes('bwck'))
    assert.ok(procedures.length >= 4)
    for (const p of procedures) {
      const path = p.url.split('?')[0]
      assert.ok(path.endsWith('/'), `GMU 404s without the trailing slash: ${p.url}`)
      assert.ok(p.url.startsWith('https://patriotweb.gmu.edu/pls/prod/'), p.url)
    }
  })

  it('does not add a trailing slash for the other classic schools', async () => {
    const log = []
    globalThis.fetch = classicFetch(log)
    await utsa.getSubjects('202710')
    for (const entry of log) {
      assert.ok(!entry.url.split('?')[0].endsWith('/'), entry.url)
    }
  })
})

describe('Banner classic representative parse (utsa)', () => {
  it('parses the listing and fills seats from the per-CRN detail page', async () => {
    const log = []
    globalThis.fetch = classicFetch(log)
    const [sec] = await utsa.getSections({
      termCode: '202710',
      subjectCode: 'CS',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    assert.equal(sec.school, 'utsa')
    assert.equal(sec.crn, '20001')
    assert.equal(sec.subjectCode, 'CS')
    assert.equal(sec.courseNumber, '1063')
    assert.equal(sec.sectionNumber, '001')
    assert.equal(sec.title, 'Programming I')
    assert.equal(sec.credits, 3)
    assert.deepEqual(sec.instructors, ['Grace Hopper'])
    assert.deepEqual(sec.meetings, [
      { days: ['M', 'W', 'F'], startTime: '10:00', endTime: '10:50', location: 'NPB 1.238' },
    ])
    assert.deepEqual(sec.enrollment, { max: 50, current: 42, available: 8 })
    assert.equal(sec.status, 'open')
    assert.ok(log.some((e) => e.url.includes('bwckschd.p_disp_detail_sched?term_in=202710&crn_in=20001')))
  })

  it('posts the subject with Banner dummy placeholders', async () => {
    const log = []
    globalThis.fetch = classicFetch(log)
    await utsa.getSections({ termCode: '202710', subjectCode: 'CS' })
    const search = log.find((e) => e.url.includes('bwckschd.p_get_crse_unsec'))
    const body = new URLSearchParams(search.body)
    assert.equal(body.get('term_in'), '202710')
    assert.deepEqual(body.getAll('sel_subj'), ['dummy', 'CS'])
  })
})

describe('purdue seat walk stays disabled', () => {
  it('never requests a per-CRN detail page (its host rate-bans the caller)', async () => {
    const log = []
    globalThis.fetch = classicFetch(log)
    const [sec] = await purdue.getSections({ termCode: '202710', subjectCode: 'CS' })
    assert.ok(sec, 'purdue should still parse the listing')
    assert.deepEqual(sec.enrollment, { max: null, current: null, available: null })
    assert.equal(sec.status, 'unknown')
    assert.deepEqual(
      log.filter((e) => e.url.includes('bwckschd.p_disp_detail_sched')),
      [],
      'enrichSeats:false must suppress every detail-page hit'
    )
  })
})
