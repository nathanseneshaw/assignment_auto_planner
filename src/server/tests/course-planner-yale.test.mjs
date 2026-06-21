/**
 * Tests for yale-scraper.js (Yale — FOSE Course Search JSON API).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as yale from '../course-planner/yale-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const HOME_HTML = `<html><body>
  <select name="srcdb">
    <option value="202503">Fall 2025</option>
    <option value="202501">Spring 2025</option>
    <option value="999999">Past Terms</option>
  </select>
  <select name="subject">
    <option value="CPSC">Computer Science (CPSC)</option>
    <option value="ECON">Economics (ECON)</option>
  </select>
</body></html>`

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}
function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) }
}

describe('yale.getTerms', () => {
  it('parses 6-digit term options and skips "Past Terms"', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await yale.getTerms(), [
      { code: '202503', label: 'Fall 2025' },
      { code: '202501', label: 'Spring 2025' },
    ])
  })
})

describe('yale.getSubjects', () => {
  it('parses subject options and strips the "(CODE)" suffix', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await yale.getSubjects(), [
      { code: 'CPSC', label: 'Computer Science' },
      { code: 'ECON', label: 'Economics' },
    ])
  })
})

describe('yale.getSections', () => {
  const SEARCH = {
    srcdb: '202503', count: 3,
    results: [
      {
        code: 'CPSC 2010', title: 'Data Structures', crn: '10146', no: '01',
        total: '42', stat: 'A', isCancelled: '', instr: 'Barron/Erat',
        meetingTimes: JSON.stringify([
          { meet_day: '1', start_time: '1135', end_time: '1250' },
          { meet_day: '3', start_time: '1135', end_time: '1250' },
        ]),
      },
      {
        code: 'CPSC 3650', title: 'Algorithms', crn: '10200', no: '01',
        total: '0', stat: 'C', isCancelled: '', instr: 'Staff',
        meetingTimes: '[]',
      },
      {
        code: 'CPSC 4999', title: 'Cancelled Seminar', crn: '10300', no: '01',
        total: '0', stat: 'A', isCancelled: 'Y', instr: '',
        meetingTimes: '[]',
      },
    ],
  }

  it('maps results, groups same-time days, derives status', async () => {
    globalThis.fetch = async () => mockJson(SEARCH)
    const sections = await yale.getSections({ termCode: '202503', subjectCode: 'CPSC', subjectLabel: 'Computer Science' })
    assert.equal(sections.length, 3)

    const ds = sections[0]
    assert.equal(ds.school, 'yale')
    assert.equal(ds.crn, '10146')
    assert.equal(ds.courseNumber, '2010')
    assert.equal(ds.title, 'Data Structures')
    assert.equal(ds.status, 'open') // stat A
    assert.deepEqual(ds.instructors, ['Barron', 'Erat'])
    assert.deepEqual(ds.enrollment, { max: null, current: 42, available: null })
    // Two occurrences at the same time collapse into one Tue/Thu meeting.
    assert.equal(ds.meetings.length, 1)
    assert.deepEqual(ds.meetings[0].days, ['T', 'R'])
    assert.equal(ds.meetings[0].startTime, '11:35')
    assert.equal(ds.meetings[0].endTime, '12:50')

    assert.equal(sections[1].status, 'closed') // stat C
    assert.deepEqual(sections[1].instructors, []) // "Staff" filtered
    assert.equal(sections[2].status, 'closed') // isCancelled wins over stat A
  })
})
