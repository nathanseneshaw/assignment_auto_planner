/**
 * Tests for uark-scraper.js (University of Arkansas / Workday, JSON API).
 *
 * The traps this pins down, all found live:
 *  - The per-day columns Mon..Sun exist on every row and are ALWAYS null; the
 *    real day data is the "Meeting_Days" string, spelled out and slash-joined.
 *  - That string must not go through util.parseDays (WEDNESDAY -> Saturday).
 *  - Times arrive as "11:50:00", which normalizeTime alone rejects.
 *  - There is no credits field anywhere on the feed.
 *  - There is no subject filter in the API, so subjects and sections both read
 *    one cached term-wide fetch rather than issuing a request per subject.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as uark from '../course-planner/uark-scraper.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

const TERM = 'UAF Fall 2026 (08/17/2026-12/11/2026)'

const ROWS = [
  {
    Course_Name: 'ADV DATA STRUCTURES',
    Course_Number: '42603',
    Course_Subject: 'CSCE',
    Course_Section: '001',
    Workday_ID: 'WD-1',
    Meeting_Days: 'Tuesday/Thursday',
    Start_Time: '08:00:00',
    End_Time: '09:15:00',
    Mon: null,
    Tue: null,
    Wed: null,
    Thu: null,
    Fri: null,
    Sat: null,
    Sun: null,
    Location: 'JBHT 239',
    Delivery_Mode: 'In-Person',
    Primary_Instructor: 'Khoa Luu',
    Instructors: '',
    Department_Name: 'Computer Science and Computer Engineering',
    Standard_Academic_Period: TERM,
    Enrollment_Count: 12,
    Section_Capacity: 30,
    Section_Status: 'Open',
  },
  {
    Course_Name: 'ABSTRACT LINEAR ALGEBRA',
    Course_Number: '30903',
    Course_Subject: 'MATH',
    Course_Section: '001',
    Workday_ID: 'WD-2',
    Meeting_Days: 'Monday/Wednesday/Friday',
    Start_Time: '11:50:00',
    End_Time: '12:40:00',
    Location: 'PEAH 205',
    Primary_Instructor: 'A Smith',
    Instructors: 'A Smith; B Jones',
    Department_Name: 'Mathematical Sciences',
    Standard_Academic_Period: TERM,
    Enrollment_Count: 30,
    Section_Capacity: 30,
    Section_Status: 'Closed',
  },
  {
    Course_Name: '21ST CENTURY MUSIC INDUSTRY',
    Course_Number: '32103',
    Course_Subject: 'MUIN',
    Course_Section: '901',
    Workday_ID: 'WD-3',
    Meeting_Days: null,
    Start_Time: null,
    End_Time: null,
    Location: 'UAF | No Classroom Required',
    Primary_Instructor: 'Dr. Jake Hertzog',
    Instructors: '',
    Department_Name: 'Department of Music',
    Standard_Academic_Period: TERM,
    Enrollment_Count: 27,
    Section_Capacity: 27,
    Section_Status: 'Closed',
  },
]

function mockApi({ onSearch } = {}) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(url)
    if (url.includes('/api/Fabric/Metadata')) {
      return {
        ok: true,
        json: async () => ({ StandardAcademicPeriods: [TERM, 'UAF Spring 2026 (01/12/2026-05/08/2026)'] }),
      }
    }
    onSearch?.(new URLSearchParams(init.body))
    return {
      ok: true,
      json: async () => ({ draw: 1, recordsTotal: 99, recordsFiltered: ROWS.length, data: ROWS }),
    }
  }
  return calls
}

describe('uark scraper', () => {
  it('uses the verbose academic period as both code and label', async () => {
    mockApi()
    const terms = await uark.getTerms()
    assert.equal(terms[0].code, TERM)
    assert.equal(terms[0].label, TERM)
  })

  it('derives subjects from the term rows, labelled by department', async () => {
    mockApi()
    const subjects = await uark.getSubjects(TERM)
    assert.deepEqual(
      subjects.map((s) => s.code),
      ['CSCE', 'MATH', 'MUIN']
    )
    assert.equal(subjects[0].label, 'Computer Science and Computer Engineering')
  })

  it('parses spelled-out meeting days and HH:MM:SS times', async () => {
    mockApi()
    const sections = await uark.getSections({ termCode: TERM, subjectCode: 'MATH' })
    assert.equal(sections.length, 1)
    assert.deepEqual(sections[0].meetings, [
      { days: ['M', 'W', 'F'], startTime: '11:50', endTime: '12:40', location: 'PEAH 205' },
    ])
    // The "S" in WEDNESDAY must not become Saturday.
    assert.ok(!sections[0].meetings[0].days.includes('S'))
  })

  it('reads seats and status, and reports credits as unavailable', async () => {
    mockApi()
    const [cs] = await uark.getSections({ termCode: TERM, subjectCode: 'CSCE' })
    assert.deepEqual(cs.enrollment, { max: 30, current: 12, available: 18 })
    assert.equal(cs.status, 'open')
    assert.equal(cs.credits, null)
    assert.equal(cs.crn, 'WD-1')
    assert.deepEqual(cs.instructors, ['Khoa Luu'])
  })

  it('de-duplicates the primary instructor out of the instructor list', async () => {
    mockApi()
    const [math] = await uark.getSections({ termCode: TERM, subjectCode: 'MATH' })
    assert.deepEqual(math.instructors, ['A Smith', 'B Jones'])
  })

  it('drops the campus prefix from an online row and emits no meeting', async () => {
    mockApi()
    const [muin] = await uark.getSections({ termCode: TERM, subjectCode: 'MUIN' })
    assert.deepEqual(muin.meetings, [])
    assert.equal(muin.status, 'closed')
  })

  it('fetches the term once and reuses it across subjects', async () => {
    const calls = mockApi()
    await uark.getSubjects(TERM)
    await uark.getSections({ termCode: TERM, subjectCode: 'CSCE' })
    await uark.getSections({ termCode: TERM, subjectCode: 'MATH' })
    const searches = calls.filter((u) => u.includes('ClassSchedule'))
    assert.equal(searches.length, 1)
  })

  it('walks the pager until every filtered row is collected', async () => {
    let call = 0
    globalThis.fetch = async (url) => {
      if (url.includes('Metadata')) {
        return { ok: true, json: async () => ({ StandardAcademicPeriods: [TERM] }) }
      }
      call += 1
      return {
        ok: true,
        json: async () => ({
          recordsFiltered: 6,
          data: call === 1 ? ROWS : ROWS.map((r, i) => ({ ...r, Workday_ID: `p2-${i}` })),
        }),
      }
    }
    const sections = await uark.getSections({ termCode: TERM, subjectCode: 'CSCE' })
    assert.equal(call, 2)
    assert.equal(sections.length, 2)
  })
})
