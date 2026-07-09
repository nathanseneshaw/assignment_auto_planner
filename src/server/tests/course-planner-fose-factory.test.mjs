/**
 * Tests for fose.js (shared CourseLeaf FOSE factory) through its three
 * consumers: boulder (html seats), oregonstate (fields seats), wm (subject
 * label map from the prefixed attributes select).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as boulder from '../course-planner/boulder-scraper.js'
import * as oregonstate from '../course-planner/oregonstate-scraper.js'
import * as wm from '../course-planner/wm-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const HOME_HTML = `<html><body>
  <select id="crit-srcdb">
    <option value="2267">Fall 2026</option>
    <option value="2264">Summer 2026</option>
    <option value="9993">Summer &amp; Fall 2026</option>
    <option value="9990">Academic Year 2025-2026</option>
    <option value="999999">All Terms</option>
  </select>
  <select id="crit-subject">
    <option value="">Any Subject</option>
    <option value="CSCI">Computer Science (CSCI)</option>
    <option value="ECON">ECON</option>
  </select>
  <select id="crit-subject_attributes">
    <option value="">Subject Attributes</option>
    <option value="subject_attributes_ECON">Economics (ECON)</option>
  </select>
</body></html>`

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}
function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

describe('fose getTerms', () => {
  it('keeps plain Season YYYY terms and drops compound/aggregate entries', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await boulder.getTerms(), [
      { code: '2267', label: 'Fall 2026' },
      { code: '2264', label: 'Summer 2026' },
    ])
  })

  it('throws when the home page is empty', async () => {
    globalThis.fetch = async () => mockText('')
    await assert.rejects(() => boulder.getTerms(), /empty page/)
  })
})

describe('fose getSubjects', () => {
  it('reads #crit-subject and cleans "(CODE)" label suffixes', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await boulder.getSubjects(), [
      { code: 'CSCI', label: 'Computer Science' },
      { code: 'ECON', label: 'ECON' },
    ])
  })

  it('wm: enriches bare-code labels from the subject_attributes select', async () => {
    globalThis.fetch = async () => mockText(HOME_HTML)
    assert.deepEqual(await wm.getSubjects(), [
      { code: 'CSCI', label: 'Computer Science' },
      { code: 'ECON', label: 'Economics' },
    ])
  })
})

const SEARCH = {
  srcdb: '2267', count: 2,
  results: [
    {
      key: '3058', code: 'CSCI 1000', title: 'CS as a Field of Work', crn: '31433',
      no: '001', total: '1', stat: 'A', isCancelled: '', instr: 'A. Pisano',
      meetingTimes: JSON.stringify([
        { meet_day: '0', start_time: '1640', end_time: '1730' },
        { meet_day: '2', start_time: '1640', end_time: '1730' },
      ]),
    },
    {
      key: '3059', code: 'CSCI 2270', title: 'Data Structures', crn: '31500',
      no: '002', total: '1', stat: 'C', isCancelled: '', instr: 'Staff',
      meetingTimes: '[]',
    },
  ],
}

describe('fose getSections (html seats — boulder/wm)', () => {
  const DETAILS = {
    31433: { seats: '<strong>Maximum Enrollment</strong>: 140 / <strong>Seats Avail</strong>: 58' },
    31500: { seats: '' }, // no parseable seats -> keep nulls
  }

  function dispatch(url, opts) {
    if (String(url).includes('route=search')) return mockJson(SEARCH)
    if (String(url).includes('route=details')) {
      const crn = JSON.parse(opts.body).key.replace('crn:', '')
      return mockJson(DETAILS[crn] || {})
    }
    return mockText(HOME_HTML)
  }

  it('maps results, derives current = max - available, groups meeting days', async () => {
    globalThis.fetch = async (url, opts) => dispatch(url, opts)
    const sections = await boulder.getSections({
      termCode: '2267', subjectCode: 'CSCI', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'boulder')
    assert.equal(s0.courseNumber, '1000')
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.instructors, ['A. Pisano'])
    assert.deepEqual(s0.enrollment, { max: 140, current: 82, available: 58 })
    assert.deepEqual(s0.meetings, [
      { days: ['M', 'W'], startTime: '16:40', endTime: '17:30', location: '' },
    ])
    assert.ok(!('_result' in s0))

    const s1 = sections[1]
    assert.equal(s1.status, 'closed')
    assert.deepEqual(s1.instructors, []) // Staff filtered
    assert.deepEqual(s1.enrollment, { max: null, current: null, available: null })
  })
})

describe('fose getSections (field seats — oregonstate)', () => {
  it('reads max_enroll / enrollment / ssbsect_seats_avail from details', async () => {
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('route=search')) return mockJson(SEARCH)
      if (String(url).includes('route=details')) {
        const crn = JSON.parse(opts.body).key.replace('crn:', '')
        return mockJson(
          crn === '31433'
            ? { max_enroll: '80', enrollment: '58', ssbsect_seats_avail: '22' }
            : {}
        )
      }
      return mockText(HOME_HTML)
    }
    const sections = await oregonstate.getSections({
      termCode: '202701', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.deepEqual(sections[0].enrollment, { max: 80, current: 58, available: 22 })
    assert.deepEqual(sections[1].enrollment, { max: null, current: null, available: null })
  })
})
