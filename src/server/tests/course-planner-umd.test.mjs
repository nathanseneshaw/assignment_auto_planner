/**
 * Tests for umd-scraper.js (Maryland — Testudo Schedule of Classes HTML).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as umd from '../course-planner/umd-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockHtml(body) {
  return { ok: true, status: 200, text: async () => body }
}

const HOME_HTML = `<html><body>
  <select name="termId">
    <option value="202601">Spring 2026</option>
    <option value="202608" selected="selected">Fall 2026</option>
    <option value="bad">Bad</option>
  </select>
</body></html>`

const TERM_HTML = `<html><body>
  <div class="course-prefix row">
    <span class="prefix-abbrev push_one two columns">CMSC</span>
    <span class="prefix-name nine columns">Computer Science</span>
  </div>
  <div class="course-prefix row">
    <span class="prefix-abbrev push_one two columns">MATH</span>
    <span class="prefix-name nine columns">Mathematics</span>
  </div>
</body></html>`

const DEPT_HTML = `<html><body><div class="courses-container">
  <div id="CMSC131" class="course">
    <div class="course-id">CMSC131</div>
    <span class="course-title">Object-Oriented Programming I</span>
    <span class="course-min-credits">4</span>
  </div>
</div></body></html>`

const SECTIONS_HTML = `<div><div id="CMSC131" class="course-sections">
  <div class="section delivery-f2f">
    <span class="section-id"> 0101 </span>
    <span class="section-instructors"><span class="section-instructor">Elias Gonzalez</span></span>
    <span class="total-seats-count">32</span>
    <span class="open-seats-count">5</span>
    <span class="waitlist-count">0</span>
    <div class="class-days-container">
      <div class="row">
        <div class="section-day-time-group">
          <span class="section-days">MWF</span>
          <span class="class-start-time">10:00am</span> - <span class="class-end-time">10:50am</span>
        </div>
        <span class="class-building"><span class="building-code">IRB</span><span class="class-room">0324</span></span>
      </div>
    </div>
  </div>
  <div class="section delivery-f2f">
    <span class="section-id"> 0102 </span>
    <span class="section-instructors"><span class="section-instructor">Instructor: TBA</span></span>
    <span class="total-seats-count">32</span>
    <span class="open-seats-count">0</span>
    <span class="waitlist-count">3</span>
    <div class="class-days-container"><div class="row">
      <span class="section-days">TBA</span>
    </div></div>
  </div>
</div></div>`

describe('umd.getTerms', () => {
  it('parses 6-digit termId options', async () => {
    globalThis.fetch = async () => mockHtml(HOME_HTML)
    assert.deepEqual(await umd.getTerms(), [
      { code: '202601', label: 'Spring 2026' },
      { code: '202608', label: 'Fall 2026' },
    ])
  })
})

describe('umd.getSubjects', () => {
  it('parses course prefixes with names', async () => {
    globalThis.fetch = async () => mockHtml(TERM_HTML)
    assert.deepEqual(await umd.getSubjects('202608'), [
      { code: 'CMSC', label: 'Computer Science' },
      { code: 'MATH', label: 'Mathematics' },
    ])
  })
})

describe('umd.getSections', () => {
  it('joins course info with the sections fragment, seats and status included', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('sections?courseIds=')) return mockHtml(SECTIONS_HTML)
      return mockHtml(DEPT_HTML)
    }
    const sections = await umd.getSections({
      termCode: '202608', subjectCode: 'CMSC', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'umd')
    assert.equal(s0.crn, 'CMSC131-0101')
    assert.equal(s0.courseNumber, '131')
    assert.equal(s0.sectionNumber, '0101')
    assert.equal(s0.title, 'Object-Oriented Programming I')
    assert.equal(s0.credits, 4)
    assert.deepEqual(s0.instructors, ['Elias Gonzalez'])
    // current = total - open
    assert.deepEqual(s0.enrollment, { max: 32, current: 27, available: 5 })
    assert.equal(s0.status, 'open')
    assert.equal(s0.meetings.length, 1)
    assert.deepEqual(s0.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s0.meetings[0].startTime, '10:00')
    assert.equal(s0.meetings[0].endTime, '10:50')
    assert.equal(s0.meetings[0].location, 'IRB 0324')

    const s1 = sections[1]
    assert.deepEqual(s1.instructors, []) // "Instructor: TBA" dropped
    assert.equal(s1.status, 'closed') // 0 open seats
    assert.deepEqual(s1.meetings, []) // TBA days dropped
  })
})
