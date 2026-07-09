/**
 * Tests for uci-scraper.js (UC Irvine — WebSoc XML).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as uci from '../course-planner/uci-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const FORM_HTML = `<html><body>
<select id="YearTerm" name="YearTerm">
  <option value="2026-92">2026  Fall Quarter</option>
  <option value="2026-14">2026  Spring Quarter</option>
</select>
<select name="Dept">
  <option value="ALL">Include All Departments</option>
  <option value="COMPSCI">COMPSCI &nbsp;&nbsp;.&nbsp;&nbsp;Computer Science</option>
  <option value="I&C SCI">I&amp;C SCI &nbsp;&nbsp;.&nbsp;&nbsp;Information and Computer Science</option>
</select>
</body></html>`

const XML = `<?xml version="1.0"?>
<websoc_results>
<course_list><school school_name="Donald Bren School of Information and Computer Sciences">
<department dept_case="COMPSCI" dept_name="Computer Science">
<course course_number="116" course_title="COMPUTATIONAL PHOTO/VISION">
  <section>
    <course_code>34020</course_code>
    <sec_type>Lec</sec_type>
    <sec_num>A</sec_num>
    <sec_units>4</sec_units>
    <sec_instructors><instructor>BERG, A.</instructor><instructor>STAFF</instructor></sec_instructors>
    <sec_meetings><sec_meet>
      <sec_days>TuTh</sec_days>
      <sec_time> 3:30- 4:50p</sec_time>
      <sec_bldg>ELH</sec_bldg>
      <sec_room>100</sec_room>
    </sec_meet></sec_meetings>
    <sec_enrollment>
      <sec_max_enroll>246</sec_max_enroll>
      <sec_enrolled>178</sec_enrolled>
    </sec_enrollment>
    <sec_status>OPEN</sec_status>
  </section>
  <section>
    <course_code>34021</course_code>
    <sec_type>Dis</sec_type>
    <sec_num>1</sec_num>
    <sec_units>0</sec_units>
    <sec_instructors><instructor>STAFF</instructor></sec_instructors>
    <sec_meetings><sec_meet><sec_days>TBA</sec_days><sec_time>TBA</sec_time></sec_meet></sec_meetings>
    <sec_enrollment>
      <sec_max_enroll>50</sec_max_enroll>
      <sec_enrolled>50</sec_enrolled>
    </sec_enrollment>
    <sec_status>FULL</sec_status>
  </section>
</course>
</department></school></course_list>
</websoc_results>`

function dispatch(url) {
  const u = String(url)
  if (u.includes('Submit=')) return { ok: true, status: 200, text: async () => XML }
  return { ok: true, status: 200, text: async () => FORM_HTML }
}

describe('uci.parseWebSocTime', () => {
  it('handles PM suffix, noon boundaries and bare AM ranges', () => {
    assert.deepEqual(uci.parseWebSocTime(' 3:30- 4:50p'), { startTime: '15:30', endTime: '16:50' })
    assert.deepEqual(uci.parseWebSocTime('11:00-12:50p'), { startTime: '11:00', endTime: '12:50' })
    assert.deepEqual(uci.parseWebSocTime('12:00- 1:20p'), { startTime: '12:00', endTime: '13:20' })
    assert.deepEqual(uci.parseWebSocTime(' 8:00- 9:50'), { startTime: '08:00', endTime: '09:50' })
    assert.equal(uci.parseWebSocTime('TBA'), null)
  })
})

describe('uci.getTerms', () => {
  it('parses YearTerm options', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    assert.deepEqual(await uci.getTerms(), [
      { code: '2026-92', label: '2026 Fall Quarter' },
      { code: '2026-14', label: '2026 Spring Quarter' },
    ])
  })
})

describe('uci.getSubjects', () => {
  it('parses Dept options and strips the dot leader', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    assert.deepEqual(await uci.getSubjects(), [
      { code: 'COMPSCI', label: 'Computer Science' },
      { code: 'I&C SCI', label: 'Information and Computer Science' },
    ])
  })
})

describe('uci.getSections', () => {
  it('maps sections with full enrollment, meetings and status', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    const sections = await uci.getSections({
      termCode: '2026-92', subjectCode: 'COMPSCI', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'uci')
    assert.equal(s0.courseNumber, '116')
    assert.equal(s0.sectionNumber, 'A')
    assert.equal(s0.crn, '34020')
    assert.equal(s0.title, 'COMPUTATIONAL PHOTO/VISION')
    assert.equal(s0.credits, 4)
    assert.deepEqual(s0.instructors, ['BERG, A.']) // STAFF filtered
    assert.deepEqual(s0.enrollment, { max: 246, current: 178, available: 68 })
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.meetings, [
      { days: ['T', 'R'], startTime: '15:30', endTime: '16:50', location: 'ELH 100' },
    ])

    const s1 = sections[1]
    assert.equal(s1.status, 'closed') // FULL
    assert.deepEqual(s1.meetings, []) // TBA
    assert.deepEqual(s1.enrollment, { max: 50, current: 50, available: 0 })
  })
})
