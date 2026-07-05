/**
 * Tests for brown-scraper.js (Brown — FOSE search + per-section details seats).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as brown from '../course-planner/brown-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const HOME_HTML = `<html><body>
  <select>
    <option value="202610">Fall 2026</option>
    <option value="202600">Summer 2026</option>
    <option value="999999">Any Term (2026-27)</option>
  </select>
  <select>
    <option value="CSCI">Computer Science</option>
    <option value="ECON">Economics</option>
  </select>
</body></html>`

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}
function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

describe('brown.getTerms', () => {
  it('parses 6-digit term options and skips "Any Term"', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await brown.getTerms(), [
      { code: '202610', label: 'Fall 2026' },
      { code: '202600', label: 'Summer 2026' },
    ])
  })

  it('throws when the edge returns an empty page', async () => {
    globalThis.fetch = async () => mockText('')
    await assert.rejects(() => brown.getTerms(), /empty page/)
  })
})

describe('brown.getSubjects', () => {
  it('parses subject options from the home page', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await brown.getSubjects(), [
      { code: 'CSCI', label: 'Computer Science' },
      { code: 'ECON', label: 'Economics' },
    ])
  })
})

describe('brown.getSections', () => {
  const SEARCH = {
    srcdb: '202610', count: 2,
    results: [
      {
        key: '1567', code: 'CSCI 0111', title: 'Computing Foundations', crn: '13666',
        no: 'S01', total: '7', stat: 'A', isCancelled: '', instr: 'M. Zizyte',
        meetingTimes: JSON.stringify([
          { meet_day: '0', start_time: '1000', end_time: '1050' },
          { meet_day: '2', start_time: '1000', end_time: '1050' },
        ]),
      },
      {
        key: '1600', code: 'CSCI 0200', title: 'Program Design', crn: '13700',
        no: 'S01', total: '0', stat: 'C', isCancelled: '', instr: 'Staff',
        meetingTimes: '[]',
      },
    ],
  }
  const DETAILS = {
    13666: { seats: '<strong>Maximum Enrollment:</strong> <span class="seats_max">50</span> / <strong>Seats Avail:</strong> <span class="seats_avail">43</span>' },
    13700: { seats: '' }, // no parseable seats -> keep nulls
  }

  function dispatch(url, opts) {
    if (String(url).includes('route=search')) return mockJson(SEARCH)
    if (String(url).includes('route=details')) {
      const body = JSON.parse(opts.body)
      const crn = body.key.replace('crn:', '')
      return mockJson(DETAILS[crn] || {})
    }
    return mockText(HOME_HTML)
  }

  it('maps search results and fills seats from route=details', async () => {
    globalThis.fetch = async (url, opts) => dispatch(url, opts)
    const sections = await brown.getSections({
      termCode: '202610', subjectCode: 'CSCI', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'brown')
    assert.equal(s0.courseNumber, '0111')
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.instructors, ['M. Zizyte'])
    // current from the search payload, max/available from details
    assert.deepEqual(s0.enrollment, { max: 50, current: 7, available: 43 })
    assert.equal(s0.meetings.length, 1)
    assert.deepEqual(s0.meetings[0].days, ['M', 'W'])
    assert.equal(s0.meetings[0].startTime, '10:00')
    // the details-walk helper field must not leak into the API payload
    assert.ok(!('_result' in s0))

    const s1 = sections[1]
    assert.equal(s1.status, 'closed')
    assert.deepEqual(s1.instructors, []) // Staff filtered
    assert.deepEqual(s1.enrollment, { max: null, current: 0, available: null })
  })
})
