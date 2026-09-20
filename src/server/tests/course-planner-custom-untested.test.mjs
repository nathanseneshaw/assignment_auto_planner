/**
 * Tests for the remaining untested course-planner scrapers.
 *
 *  - iastate  self-contained Workday-backed JSON API (three endpoints, one
 *             very picky search POST).
 *  - ku       self-contained Struts HTML scrape whose seat counts live in a
 *             popover title attribute.
 *  - msstate  self-contained Banner Extensibility "virtual domain" JSON whose
 *             rows are positional arrays, one per section-MEETING.
 *  - uvm / louisville / unr  thin wrappers over the FOSE and PeopleSoft
 *             factories (both engines have their own suites), so only the
 *             host + engine wiring is pinned here.
 *
 * Every request is stubbed; nothing here touches a university.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as iastate from '../course-planner/iastate-scraper.js'
import * as ku from '../course-planner/ku-scraper.js'
import * as msstate from '../course-planner/msstate-scraper.js'
import * as uvm from '../course-planner/uvm-scraper.js'
import * as louisville from '../course-planner/louisville-scraper.js'
import * as unr from '../course-planner/unr-scraper.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
  cacheFlush()
})

function mockRes(body, url, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    url,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

// ══ Iowa State ════════════════════════════════════════════════════════════════

const ISU_API = 'https://api.classes.iastate.edu/api'

const ISU_COURSES = [
  {
    number: 'COM S 2270',
    title: 'Object-oriented Programming',
    sections: [
      {
        id: 'COURSE_SECTION-3-1346107',
        number: '1',
        openSeats: 12,
        credits: '3',
        instructors: 'Ada Lovelace; TBA',
        locations: 'Hoover Hall 2055\nOnline',
        meetingPatterns: 'MWF | 8:50 AM - 9:40 AM\nT | 2:10 PM - 4:00 PM\nTBA',
      },
      {
        id: 'COURSE_SECTION-3-1346108',
        number: '2',
        openSeats: 0,
        credits: '3',
        instructors: 'Staff',
        locations: '',
        meetingPatterns: 'TBA',
      },
    ],
  },
]

function isuFetch(log, { periods, subjects, courses = ISU_COURSES } = {}) {
  return async (url, init = {}) => {
    const target = String(url)
    log.push({ url: target, method: init.method || 'GET', body: String(init.body || '') })
    if (target.includes('/academic-periods')) {
      return mockRes(
        { data: periods || [{ id: 'ACADEMIC_PERIOD-2026Fall', name: '2026 Fall Semester (08/24/2026-12/18/2026)' }] },
        target
      )
    }
    if (target.includes('/course-subjects')) {
      return mockRes({ data: subjects || ['COM S - Computer Science', 'MATH - Mathematics'] }, target)
    }
    if (target.includes('/courses/search')) return mockRes({ data: courses }, target)
    return mockRes({ data: [] }, target)
  }
}

describe('iastate', () => {
  it('strips the parenthesised date range from term labels', async () => {
    const log = []
    globalThis.fetch = isuFetch(log)
    assert.deepEqual(await iastate.getTerms(), [
      { code: 'ACADEMIC_PERIOD-2026Fall', label: '2026 Fall Semester' },
    ])
    assert.ok(log.every((e) => e.url.startsWith(ISU_API)), 'wrong host')
  })

  it('splits single-token "CODE - Name" subject strings', async () => {
    globalThis.fetch = isuFetch([], { subjects: ['ACCT - Accounting', 'MATH - Mathematics'] })
    assert.deepEqual(await iastate.getSubjects('ACADEMIC_PERIOD-2026Fall'), [
      { code: 'ACCT', label: 'Accounting' },
      { code: 'MATH', label: 'Mathematics' },
    ])
  })

  it('KNOWN LIMITATION: subject codes containing a space are not split', async () => {
    // getSubjects splits on /^(\S+)\s+-\s+(.*)$/, so Iowa State's spaced
    // abbreviations ("COM S", "CPR E", "MAT E", "AER E", "S E") fall through to
    // the whole "CODE - Name" string as BOTH code and label. This is pinned,
    // not endorsed: see the note in the summary. Fixing it is a production
    // change, so the current behaviour is what is asserted here.
    globalThis.fetch = isuFetch([])
    assert.deepEqual(await iastate.getSubjects('ACADEMIC_PERIOD-2026Fall'), [
      { code: 'COM S - Computer Science', label: 'COM S - Computer Science' },
      { code: 'MATH', label: 'Mathematics' },
    ])
  })

  it('the unsplit subject code still selects the right catalog on search', async () => {
    // The search fallback (`strings.find(...) || subjectCode`) means the raw
    // "COM S - Computer Science" string is posted verbatim, which is exactly
    // what the Workday endpoint wants — so the search itself does not break.
    const log = []
    globalThis.fetch = isuFetch(log)
    const out = await iastate.getSections({
      termCode: 'ACADEMIC_PERIOD-2026Fall',
      subjectCode: 'COM S - Computer Science',
    })
    const search = log.find((e) => e.url.includes('/courses/search'))
    assert.equal(JSON.parse(search.body).courseSubject, 'COM S - Computer Science')
    // ...but the course number keeps its prefix, because the strip regex is
    // built from the (unsplit) subject code.
    assert.equal(out[0].courseNumber, 'COM S 2270')
  })

  it('sends the verbatim subject string and the full SPA search payload', async () => {
    const log = []
    globalThis.fetch = isuFetch(log)
    await iastate.getSections({ termCode: 'ACADEMIC_PERIOD-2026Fall', subjectCode: 'COM S' })
    const search = log.find((e) => e.url.includes('/courses/search'))
    assert.equal(search.method, 'POST')
    const payload = JSON.parse(search.body)
    assert.equal(payload.courseSubject, 'COM S - Computer Science')
    assert.equal(payload.academicPeriodId, 'ACADEMIC_PERIOD-2026Fall')
    assert.equal(payload.courseNumber, '', 'the SPA sends "" not null')
    assert.equal(payload.openSeats, false, 'closed sections must stay in the results')
    assert.deepEqual(payload.daysOfTheWeek, [])
  })

  it('normalizes sections, meetings and the open-seats-only enrollment', async () => {
    globalThis.fetch = isuFetch([])
    const out = await iastate.getSections({
      termCode: 'ACADEMIC_PERIOD-2026Fall',
      subjectCode: 'COM S',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    assert.equal(out.length, 2)
    const [a, b] = out
    assert.equal(a.school, 'iastate')
    assert.equal(a.courseNumber, '2270', 'the subject prefix is stripped from course.number')
    assert.equal(a.crn, '3-1346107', 'the Workday prefix is stripped')
    assert.equal(a.sectionNumber, '1')
    assert.deepEqual(a.instructors, ['Ada Lovelace'], 'TBA is dropped')
    assert.equal(a.credits, 3)
    assert.deepEqual(a.enrollment, { max: null, current: null, available: 12 })
    assert.equal(a.status, 'open')
    assert.deepEqual(a.meetings, [
      { days: ['M', 'W', 'F'], startTime: '08:50', endTime: '09:40', location: 'Hoover Hall 2055' },
      { days: ['T'], startTime: '14:10', endTime: '16:00', location: 'Hoover Hall 2055' },
    ])
    assert.equal(b.status, 'closed')
    assert.deepEqual(b.instructors, [])
    assert.deepEqual(b.meetings, [], 'a TBA-only pattern yields no schedulable meeting')
  })

  it('throws on an API failure rather than reporting an empty catalog', async () => {
    globalThis.fetch = async (url) => mockRes({}, String(url), { ok: false, status: 503 })
    await assert.rejects(() => iastate.getTerms(), /HTTP 503/)
  })
})

// ══ Kansas ════════════════════════════════════════════════════════════════════

const KU_BASE = 'https://classes.ku.edu'

const KU_HOME = `<html><body>
  <select id="classesSearchTerm">
    <option value="">Select</option>
    <option value="4269">Fall 2026</option>
    <option value="4262">Spring 2026</option>
    <option value="all">All</option>
  </select>
  <select id="classesSearchSubject">
    <option value="">Select</option>
    <option value="EECS">EECS Elect Engr &amp; Computer Science</option>
    <option value="MATH">MATH Mathematics</option>
  </select>
</body></html>`

const KU_RESULTS = `<html><body>
  <table>
    <tr><td>
      <h3>EECS 101</h3> Introduction to Computing ( 3 ) Fall 2026
      <table class="class_list">
        <tr data-section="55001">
          <td>LEC</td>
          <td><strong title="Section number: 30000">30000</strong></td>
          <td><span class="avail_open" title="113 students enrolled out of 420 maximum.">Open</span></td>
        </tr>
        <tr data-section="55001">
          <td colspan="4">MoWeFr 09:00 AM - 09:50 AM - LAWRENCE<br />Tu 02:00 PM - 02:50 PM - LAWRENCE</td>
        </tr>
        <tr data-section="55001" style="display:none"><td colspan="4">notes</td></tr>
        <tr data-section="55002">
          <td>LAB</td>
          <td><strong title="Section number: 30001">30001</strong></td>
          <td><span class="avail_closed" title="40 students enrolled out of 40 maximum.">Closed</span></td>
        </tr>
        <tr data-section="55002"><td colspan="4">Th 01:00 PM - 02:50 PM - LAWRENCE</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

function kuFetch(log, { home = KU_HOME, results = KU_RESULTS } = {}) {
  return async (url, init = {}) => {
    const target = String(url)
    log.push({ url: target, method: init.method || 'GET', body: String(init.body || '') })
    if (target.includes('/Classes/CourseSearch.action')) return mockRes(results, target)
    return mockRes(home, target)
  }
}

describe('ku', () => {
  it('reads the server-rendered term dropdown, skipping non-numeric codes', async () => {
    const log = []
    globalThis.fetch = kuFetch(log)
    assert.deepEqual(await ku.getTerms(), [
      { code: '4269', label: 'Fall 2026' },
      { code: '4262', label: 'Spring 2026' },
    ])
    assert.ok(log.every((e) => e.url.startsWith(KU_BASE)), 'wrong host')
  })

  it('drops the repeated code from subject labels', async () => {
    globalThis.fetch = kuFetch([])
    assert.deepEqual(await ku.getSubjects('4269'), [
      { code: 'EECS', label: 'Elect Engr & Computer Science' },
      { code: 'MATH', label: 'Mathematics' },
    ])
  })

  it('throws when the search page does not render the form', async () => {
    globalThis.fetch = kuFetch([], { home: '<html><body>maintenance</body></html>' })
    await assert.rejects(() => ku.getTerms(), /did not render the search form/i)
  })

  it('searches the whole catalog including closed sections', async () => {
    const log = []
    globalThis.fetch = kuFetch(log)
    await ku.getSections({ termCode: '4269', subjectCode: 'EECS' })
    const search = log.find((e) => e.url.includes('CourseSearch.action'))
    const body = new URLSearchParams(search.body)
    assert.equal(body.get('searchTerm'), '4269')
    assert.equal(body.get('searchSubject'), 'EECS')
    assert.equal(body.get('searchCareer'), 'UndergraduateGraduate')
    assert.equal(body.get('searchClosed'), 'true')
  })

  it('parses the seats popover into full enrollment counts', async () => {
    globalThis.fetch = kuFetch([])
    const out = await ku.getSections({
      termCode: '4269',
      subjectCode: 'EECS',
      termLabel: 'Fall 2026',
      subjectLabel: 'Elect Engr & Computer Science',
    })
    assert.equal(out.length, 2)
    const [lec, lab] = out
    assert.equal(lec.school, 'ku')
    assert.equal(lec.crn, '55001')
    assert.equal(lec.courseNumber, '101')
    assert.equal(lec.title, 'Introduction to Computing')
    assert.equal(lec.credits, 3)
    assert.equal(lec.sectionNumber, 'LEC 30000')
    assert.deepEqual(lec.enrollment, { max: 420, current: 113, available: 307 })
    assert.equal(lec.status, 'open')
    assert.deepEqual(lec.instructors, [], 'instructor names are login-gated at KU')
    assert.deepEqual(lec.meetings, [
      { days: ['M', 'W', 'F'], startTime: '09:00', endTime: '09:50', location: 'LAWRENCE' },
      { days: ['T'], startTime: '14:00', endTime: '14:50', location: 'LAWRENCE' },
    ])
    assert.equal(lab.status, 'closed')
    assert.deepEqual(lab.enrollment, { max: 40, current: 40, available: 0 })
  })

  it('ignores the hidden notes row', async () => {
    globalThis.fetch = kuFetch([])
    const [lec] = await ku.getSections({ termCode: '4269', subjectCode: 'EECS' })
    assert.equal(lec.meetings.length, 2, 'the display:none notes row must not add a meeting')
  })
})

// ══ Mississippi State ═════════════════════════════════════════════════════════

const MSU_BASE = 'https://mybanner.msstate.edu/BannerExtensibility/internalPb'

/** One positional master-schedule row (schema pinned from MSU's own DataTable). */
function msuRow({ crn, section = '01', number = '1213', title = 'Intro to Computer Science', total = '40', avail = '5', days = '<b>MWF</b>', time = '09:00AM - 09:50AM', where = 'Butler Hall 101' }) {
  const row = new Array(21).fill('')
  row[0] = 'CSE'
  row[1] = number
  row[2] = section
  row[3] = crn
  row[6] = title
  row[12] = total
  row[13] = avail
  row[18] = days
  row[19] = time
  row[20] = where
  return row
}

function msuFetch(log, { rows = [msuRow({ crn: '12345' })], terms, subjects } = {}) {
  return async (url, init = {}) => {
    const target = String(url)
    log.push({ url: target, method: init.method || 'GET' })
    if (target.includes('msuStudentSZUWCNT')) {
      return mockRes(terms || [{ value_code: '202630', value_desc: 'Fall Semester 2026' }], target)
    }
    if (target.includes('msuStudentSTVSUBJ')) {
      return mockRes(
        subjects || [
          { subj_code: 'CSE', subj_desc: 'CSE - Computer Science &amp; Engineering' },
          { subj_code: 'MA', subj_desc: 'Mathematics' },
        ],
        target
      )
    }
    if (target.includes('msuStudentMasterScheduleJSON')) {
      return mockRes([{ json_data: JSON.stringify({ data: rows }) }], target)
    }
    return mockRes([], target)
  }
}

describe('msstate', () => {
  it('maps the STVTERM virtual domain to terms', async () => {
    const log = []
    globalThis.fetch = msuFetch(log)
    assert.deepEqual(await msstate.getTerms(), [{ code: '202630', label: 'Fall Semester 2026' }])
    assert.ok(log.every((e) => e.url.startsWith(MSU_BASE)), 'wrong host')
  })

  it('strips the repeated code from subject descriptions', async () => {
    globalThis.fetch = msuFetch([])
    assert.deepEqual(await msstate.getSubjects('202630'), [
      { code: 'CSE', label: 'Computer Science &amp; Engineering' },
      { code: 'MA', label: 'Mathematics' },
    ])
  })

  it('merges the per-meeting rows that share a CRN', async () => {
    globalThis.fetch = msuFetch([], {
      rows: [
        msuRow({ crn: '12345' }),
        msuRow({ crn: '12345', days: '<b>T</b>', time: '02:00PM - 03:50PM', where: 'Butler Hall 205' }),
        msuRow({ crn: '99999', section: '02', total: '30', avail: '0', days: 'TBA', time: 'TBA', where: 'TBA' }),
      ],
    })
    const out = await msstate.getSections({
      termCode: '202630',
      subjectCode: 'CSE',
      termLabel: 'Fall 2026',
      subjectLabel: 'Computer Science',
    })
    assert.equal(out.length, 2)
    const [a, b] = out
    assert.equal(a.school, 'msstate')
    assert.equal(a.crn, '12345')
    assert.equal(a.courseNumber, '1213')
    assert.equal(a.sectionNumber, '01')
    assert.equal(a.title, 'Intro to Computer Science')
    assert.deepEqual(a.enrollment, { max: 40, current: 35, available: 5 })
    assert.equal(a.status, 'open')
    assert.deepEqual(a.meetings, [
      { days: ['M', 'W', 'F'], startTime: '09:00', endTime: '09:50', location: 'Butler Hall 101' },
      { days: ['T'], startTime: '14:00', endTime: '15:50', location: 'Butler Hall 205' },
    ])
    assert.equal(b.status, 'closed')
    assert.deepEqual(b.meetings, [], 'a TBA row is not schedulable')
  })

  it('scopes the master-schedule call to the term + subject', async () => {
    const log = []
    globalThis.fetch = msuFetch(log)
    await msstate.getSections({ termCode: '202630', subjectCode: 'CSE' })
    const call = log.find((e) => e.url.includes('msuStudentMasterScheduleJSON'))
    assert.ok(call.url.includes('term=202630'), call.url)
    assert.ok(call.url.includes('subject=CSE'), call.url)
    assert.ok(call.url.includes('type=PUBLIC'), call.url)
  })

  it('retries once when the flaky host drops the connection', async () => {
    let attempts = 0
    globalThis.fetch = async (url) => {
      attempts += 1
      if (attempts === 1) throw new Error('socket hang up')
      return mockRes([{ value_code: '202630', value_desc: 'Fall Semester 2026' }], String(url))
    }
    assert.deepEqual(await msstate.getTerms(), [{ code: '202630', label: 'Fall Semester 2026' }])
    assert.equal(attempts, 2)
  })

  it('gives up after the second failure rather than looping', async () => {
    let attempts = 0
    globalThis.fetch = async () => {
      attempts += 1
      throw new Error('socket hang up')
    }
    await assert.rejects(() => msstate.getTerms(), /socket hang up/)
    assert.equal(attempts, 2)
  })

  it('throws a clear error when json_data is unparseable', async () => {
    globalThis.fetch = async (url) => {
      const target = String(url)
      if (target.includes('MasterScheduleJSON')) return mockRes([{ json_data: 'not json' }], target)
      return mockRes([], target)
    }
    await assert.rejects(
      () => msstate.getSections({ termCode: '202630', subjectCode: 'CSE' }),
      /unparseable json_data/
    )
  })
})

// ══ engine-backed leftovers: host wiring only ═════════════════════════════════

describe('remaining engine-backed schools reach the right host', () => {
  it('uvm drives the FOSE engine at soc.uvm.edu', async () => {
    const log = []
    globalThis.fetch = async (url) => {
      log.push(String(url))
      return mockRes(
        `<html><body><select id="crit-srcdb">
           <option value="202609">Fall 2026</option>
           <option value="202601">Academic Year 2026-2027</option>
         </select></body></html>`,
        String(url)
      )
    }
    assert.deepEqual(await uvm.getTerms(), [{ code: '202609', label: 'Fall 2026' }])
    assert.deepEqual(log, ['https://soc.uvm.edu/'])
  })

  const PS_FORM = `<html><body><form id="win0" name="win0">
    <input name="ICSID" value="ps-sid" />
    <select name="CLASS_SRCH_WRK2_INSTITUTION$31$"><option value="X" selected>X</option></select>
    <select name="CLASS_SRCH_WRK2_STRM$35$">
      <option value="">select</option>
      <option value="4268">4268: Fall 2026</option>
    </select>
  </form></body></html>`

  const PS_SCHOOLS = [
    [
      'louisville',
      louisville,
      'https://csprd.louisville.edu/psc/ps_class/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
    ],
    [
      'unr',
      unr,
      'https://cs.nevada.unr.edu/psc/unrcsprd/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
    ],
  ]

  for (const [name, mod, url] of PS_SCHOOLS) {
    it(`${name} drives the PeopleSoft engine at ${new URL(url).host}`, async () => {
      cacheFlush()
      const log = []
      globalThis.fetch = async (target) => {
        log.push(String(target))
        return mockRes(PS_FORM, String(target))
      }
      assert.deepEqual(await mod.getTerms(), [{ code: '4268', label: '4268: Fall 2026' }])
      assert.deepEqual(log, [url])
    })
  }
})
