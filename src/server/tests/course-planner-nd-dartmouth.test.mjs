/**
 * Smoke tests for the nd + dartmouth FOSE-factory wrappers. The factory is
 * covered by course-planner-fose-factory.test.mjs; these pin the host wiring
 * and the two school-specific switches: ND's wordier term labels ("Fall
 * Semester 2026" must survive its custom termRe) and Dartmouth's abbreviated
 * details-seats snippet ("Max Enrollment ... Seats Available").
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as nd from '../course-planner/nd-scraper.js'
import * as dartmouth from '../course-planner/dartmouth-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}
function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

const ND_HOME = `<html><body>
  <select id="crit-srcdb">
    <option value="202610">Fall Semester 2026</option>
    <option value="202600">Summer Session 2026</option>
    <option value="202520">Spring Semester 2026</option>
    <option value="999999">All Terms</option>
  </select>
  <select id="crit-subject">
    <option value="">Any Subject</option>
    <option value="CSE">CSE - Computer Science and Engineering</option>
  </select>
</body></html>`

const DART_HOME = `<html><body>
  <select id="crit-srcdb">
    <option value="202609">Fall 2026</option>
    <option value="202606">Summer 2026</option>
  </select>
  <select id="crit-subject">
    <option value="COSC">COSC - Computer Science</option>
  </select>
</body></html>`

describe('nd.getTerms', () => {
  it('hits classsearch.nd.edu and keeps Semester/Session labels', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => { seenUrls.push(String(url)); return mockText(ND_HOME) }
    const terms = await nd.getTerms()
    assert.deepEqual(terms, [
      { code: '202610', label: 'Fall Semester 2026' },
      { code: '202600', label: 'Summer Session 2026' },
      { code: '202520', label: 'Spring Semester 2026' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://classsearch.nd.edu/')))
  })
})

describe('dartmouth sections', () => {
  const SEARCH = {
    srcdb: '202609', count: 1,
    results: [{
      key: '312', code: 'COSC 001', title: 'Introduction to Programming', crn: '91925',
      no: '01', total: '2', stat: 'A', isCancelled: '', instr: 'A. Campbell',
      meetingTimes: JSON.stringify([
        { meet_day: '0', start_time: '1250', end_time: '1355' },
        { meet_day: '2', start_time: '1250', end_time: '1355' },
      ]),
    }],
  }
  const DETAILS = {
    seats: '<b>Seats: </b>Max Enrollment: 50 / Seats Available: 8\n<br><b>Waitlist:</b>(waitlist currently unavailable)',
  }

  it('parses the abbreviated Max Enrollment / Seats Available snippet', async () => {
    const seenUrls = []
    globalThis.fetch = async (url, opts) => {
      seenUrls.push(String(url))
      if (String(url).includes('route=search')) return mockJson(SEARCH)
      if (String(url).includes('route=details')) return mockJson(DETAILS)
      return mockText(DART_HOME)
    }
    const sections = await dartmouth.getSections({
      termCode: '202609', subjectCode: 'COSC', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 1)
    const s = sections[0]
    assert.equal(s.school, 'dartmouth')
    assert.equal(s.courseNumber, '001')
    assert.deepEqual(s.enrollment, { max: 50, available: 8, current: 42 })
    assert.equal(s.status, 'open')
    assert.deepEqual(s.meetings, [
      { days: ['M', 'W'], startTime: '12:50', endTime: '13:55', location: '' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://courses.dartmouth.edu/')))
  })
})
