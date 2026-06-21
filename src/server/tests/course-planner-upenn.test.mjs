/**
 * Tests for upenn-scraper.js (UPenn — CourseLeaf CLSS "fose" JSON API).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as upenn from '../course-planner/upenn-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const HOME_HTML = `<html><body>
  <select name="srcdb">
    <option value="202530">Fall 2025</option>
    <option value="202510">Spring 2025</option>
    <option value="202530">Fall 2025</option>
  </select>
</body></html>`

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}
function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) }
}

describe('upenn.getTerms', () => {
  it('parses 6-digit term options from the landing page and dedupes', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await upenn.getTerms(), [
      { code: '202530', label: 'Fall 2025' },
      { code: '202510', label: 'Spring 2025' },
    ])
  })
})

describe('upenn.getSubjects', () => {
  it('derives a sorted, deduped subject list from a full-term search', async () => {
    const SEARCH = {
      srcdb: '202530',
      count: 3,
      results: [
        { code: 'CIS 1100' }, { code: 'CIS 1200' }, { code: 'ACCT 1010' },
      ],
    }
    globalThis.fetch = async () => mockJson(SEARCH)
    assert.deepEqual(await upenn.getSubjects('202530'), [
      { code: 'ACCT', label: 'ACCT' },
      { code: 'CIS', label: 'CIS' },
    ])
  })
})

describe('upenn.getSections', () => {
  const SEARCH = {
    srcdb: '202530', count: 3,
    results: [
      {
        code: 'CIS 1100', title: 'Introduction to Computer Programming',
        crn: '61673', no: '001', stat: 'A', isCancelled: '', instr: 'Massachi/Smith',
        meetingTimes: JSON.stringify([
          { meet_day: '0', start_time: '1200', end_time: '1259' },
          { meet_day: '2', start_time: '1200', end_time: '1259' },
          { meet_day: '4', start_time: '1200', end_time: '1259' },
        ]),
      },
      {
        code: 'CIS 1200', title: 'Programming Languages', crn: '61680', no: '001',
        stat: 'F', isCancelled: '', instr: 'Staff', meetingTimes: '[]',
      },
      {
        code: 'CIS 9999', title: 'Cancelled', crn: '99999', no: '001',
        stat: 'A', isCancelled: 'Y', instr: '', meetingTimes: '[]',
      },
    ],
  }

  it('normalizes results, groups same-time days, and maps status', async () => {
    globalThis.fetch = async () => mockJson(SEARCH)
    const sections = await upenn.getSections({
      termCode: '202530', subjectCode: 'CIS', termLabel: 'Fall 2025', subjectLabel: 'CIS',
    })
    assert.equal(sections.length, 3)

    const s = sections[0]
    assert.equal(s.school, 'upenn')
    assert.equal(s.crn, '61673')
    assert.equal(s.subjectCode, 'CIS')
    assert.equal(s.courseNumber, '1100')
    assert.equal(s.sectionNumber, '001')
    assert.equal(s.title, 'Introduction to Computer Programming')
    assert.equal(s.status, 'open') // stat A
    assert.deepEqual(s.instructors, ['Massachi', 'Smith'])
    assert.equal(s.credits, null)
    assert.deepEqual(s.enrollment, { max: null, current: null, available: null })
    // Three MWF occurrences at the same time collapse into one meeting.
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '12:00')
    assert.equal(s.meetings[0].endTime, '12:59')

    assert.equal(sections[1].status, 'closed') // stat F
    assert.deepEqual(sections[1].instructors, []) // "Staff" filtered
    assert.equal(sections[2].status, 'closed') // isCancelled wins over stat A
  })

  it('throws when fose returns a fatal error', async () => {
    globalThis.fetch = async () => mockJson({ fatal: 'Could not parse incoming payload as JSON' })
    await assert.rejects(
      () => upenn.getSections({ termCode: '202530', subjectCode: 'CIS' }),
      /rejected/i
    )
  })
})
