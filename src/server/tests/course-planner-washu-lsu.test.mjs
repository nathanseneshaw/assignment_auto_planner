/**
 * Tests for the two Workday-era HTML scrapers, washu-scraper.js and
 * lsu-scraper.js. Both parse a server-rendered page rather than an API, and both
 * had a field trap worth pinning:
 *
 *  - WashU groups SECTIONS inside a per-COURSE row, so one row can yield several
 *    sections and the course code has to be split off the shared heading.
 *  - LSU spells its meeting days out in full ("Monday Wednesday Friday"), which
 *    util.parseDays mis-reads (the "S" in WEDNESDAY becomes Saturday), and it
 *    numbers a lecture and its lab identically apart from the -LEC / -LAB
 *    suffix, so that suffix has to survive into sectionNumber.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as washu from '../course-planner/washu-scraper.js'
import * as lsu from '../course-planner/lsu-scraper.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

function html(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    headers: { get: () => null, forEach: () => {} },
  }
}

// ── WashU ─────────────────────────────────────────────────────────────────────

function washuBox(label, value) {
  return `<div class="scpi-class__data-box"><span class="scpi-class__label">${label}</span><div class="scpi-class__value">${value}</div></div>`
}

function washuSection({ section, instructor, days, time, seats }) {
  return `<div class="scpi-class__data" data-section-id="CSD-${section}">
    ${washuBox('Section', section)}
    ${washuBox('Term', '2026 Fall')}
    ${washuBox('Instructor', instructor)}
    ${washuBox('Delivery Mode', 'In-Person')}
    ${washuBox('Days', days)}
    ${washuBox('Time', time)}
    ${washuBox('Seats Taken', seats)}
  </div>`
}

const WASHU_RESULTS = `<html><body>
<select id="termselect"><option value="">Any</option><option value="2026 Fall">2026 Fall</option><option value="2026 Fall">2026 Fall</option><option value="2026 Medicine Year">2026 Medicine Year</option></select>
<select id="departmentselect"><option value="">Any</option><option value="Computer Science &amp; Engineering">Computer Science &amp; Engineering</option><option value="Economics">Economics</option></select>
<div class="scpi__classes--row" data-course-id="CRS_CSE_1">
  <div class="scpi-class__department">Computer Science &amp; Engineering</div>
  <div class="scpi-class__header">
    <div class="scpi-class__heading wide">Advanced Algorithms</div>
    <div class="scpi-class__heading middle">CSE 5401</div>
    <div class="scpi-class__heading narrow">3 Units</div>
  </div>
  ${washuSection({ section: '01', instructor: 'Baruah, Sanjoy Kumar', days: 'Tue Thu', time: '10:00 AM-11:20 AM', seats: '24/70' })}
  ${washuSection({ section: '02', instructor: 'Doe, Jane', days: '', time: '', seats: '70/70' })}
</div>
</body></html>`

describe('washu scraper', () => {
  it('reads terms from the landing page and de-duplicates the doubled options', async () => {
    globalThis.fetch = async () => html(WASHU_RESULTS)
    const terms = await washu.getTerms()
    assert.deepEqual(
      terms.map((t) => t.code),
      ['2026 Fall', '2026 Medicine Year']
    )
  })

  it('emits one section per data block inside a course row', async () => {
    globalThis.fetch = async () => html(WASHU_RESULTS)
    const sections = await washu.getSections({
      termCode: '2026 Fall',
      subjectCode: 'Computer Science & Engineering',
      termLabel: 'Fall 2026',
    })
    assert.equal(sections.length, 2)
    const [a, b] = sections

    // Course identity is split off the shared heading, not the department.
    assert.equal(a.subjectCode, 'CSE')
    assert.equal(a.courseNumber, '5401')
    assert.equal(a.title, 'Advanced Algorithms')
    assert.equal(a.credits, 3)
    assert.equal(a.sectionNumber, '01')
    assert.deepEqual(a.instructors, ['Baruah, Sanjoy Kumar'])

    // "Seats Taken" is taken/capacity, so current is the FIRST number.
    assert.deepEqual(a.enrollment, { max: 70, current: 24, available: 46 })
    assert.equal(a.status, 'open')
    assert.deepEqual(a.meetings, [
      { days: ['T', 'R'], startTime: '10:00', endTime: '11:20', location: '' },
    ])

    // A full section is closed, and an arranged one gets no meeting at all.
    assert.equal(b.status, 'closed')
    assert.deepEqual(b.meetings, [])
  })

  it('posts term and department and follows the pager until it stops advancing', async () => {
    const posts = []
    let page = 0
    globalThis.fetch = async (url, init) => {
      if (!init) return html(WASHU_RESULTS)
      posts.push(new URLSearchParams(init.body))
      page += 1
      // First page advertises page 2; second page advertises nothing.
      const pager = page === 1 ? '<input name="paged" value="2">' : ''
      return html(WASHU_RESULTS.replace('</body>', `${pager}</body>`))
    }
    const sections = await washu.getSections({
      termCode: '2026 Fall',
      subjectCode: 'Computer Science & Engineering',
    })
    assert.equal(posts.length, 2)
    assert.equal(posts[0].get('term'), '2026 Fall')
    assert.equal(posts[0].get('department'), 'Computer Science & Engineering')
    assert.equal(posts[1].get('paged'), '2')
    assert.equal(sections.length, 4) // two pages of the same two sections
  })
})

// ── LSU ───────────────────────────────────────────────────────────────────────

function lsuSection({ label, seats, enrolment, credits, meeting, location, instructor }) {
  return `<section aria-label="Section ${label}">
    <div class="d-flex"><span class="fw-bold">Section ${label}</span>
      <span class="badge">${seats}</span><span class="text-muted">Enrollment: ${enrolment}</span></div>
    <div class="row">
      <div class="col"><div class="mb-3"><span>Date: 08/24/2026 - 12/12/2026</span></div>
        <div class="mb-3"><span>Meeting Pattern:<br>${meeting}</span></div></div>
      <div class="col"><div class="mb-3"><span>${credits} Credit Hours</span></div>
        <div class="mb-3"><span>Format: Lecture</span></div></div>
      <div class="col"><div class="mb-3"><span>Location: ${location}</span></div></div>
      <div class="col"><div class="mb-3"><span>Instructor: ${instructor}</span></div></div>
    </div>
  </section>`
}

const LSU_PAGE = `<html><body>
<select id="department"><option value="">Any</option><option value="CSC">CSC</option><option value="ECON">ECON</option></select>
<select id="academicPeriod"><option value="">Any</option>
  <option value="LSUAM_FALL_2026">Fall Semester 2026 (08/24/2026-12/12/2026)</option>
  <option value="LSUAM_FALL_1_2026">First Fall 2026 (08/24/2026-10/12/2026)</option>
  <option value="LSUAM_ONLINE_FALL_2_2026">Online Second Fall 2026 (10/19/2026-12/07/2026)</option>
</select>
<div class="accordion-item">
  <h2 class="accordion-header"><span>CSC 1350 COMP SCI I-MJRS</span></h2>
  ${lsuSection({ label: '001-LEC', seats: '79 Seats Open', enrolment: '71/150', credits: '4', meeting: 'Monday Wednesday Friday 10:30 AM - 11:20 AM', location: '1200 Patrick F. Taylor Hall', instructor: 'William Evans Duncan' })}
  ${lsuSection({ label: '001-LAB', seats: '79 Seats Open', enrolment: '71/150', credits: '0', meeting: 'Thursday 4:30 PM - 7:20 PM', location: '', instructor: '' })}
</div>
<div class="accordion-item">
  <h2 class="accordion-header"><span>CSC 3999 IND UNDERGRAD RES</span></h2>
  ${lsuSection({ label: '002-IND', seats: '0 Seats Open', enrolment: '5/5', credits: '1 - 3', meeting: '', location: '', instructor: 'Jane Roe' })}
</div>
</body></html>`

describe('lsu scraper', () => {
  it('keeps only full semesters so half-terms cannot shadow them', async () => {
    globalThis.fetch = async () => html(LSU_PAGE)
    const terms = await lsu.getTerms()
    assert.deepEqual(
      terms.map((t) => t.code),
      ['LSUAM_FALL_2026']
    )
  })

  it('parses full day names without mis-reading WEDNESDAY as Saturday', async () => {
    globalThis.fetch = async () => html(LSU_PAGE)
    const sections = await lsu.getSections({
      termCode: 'LSUAM_FALL_2026',
      subjectCode: 'CSC',
      termLabel: 'Fall 2026',
    })
    const lec = sections.find((s) => s.sectionNumber === '001-LEC')
    assert.deepEqual(lec.meetings, [
      {
        days: ['M', 'W', 'F'],
        startTime: '10:30',
        endTime: '11:20',
        location: '1200 Patrick F. Taylor Hall',
      },
    ])
    assert.ok(!lec.meetings[0].days.includes('S'))
  })

  it('keeps the schedule-type suffix so a lecture and its lab stay distinct', async () => {
    globalThis.fetch = async () => html(LSU_PAGE)
    const sections = await lsu.getSections({ termCode: 'LSUAM_FALL_2026', subjectCode: 'CSC' })
    const numbers = sections.map((s) => s.sectionNumber)
    assert.deepEqual(numbers, ['001-LEC', '001-LAB', '002-IND'])
    assert.equal(new Set(sections.map((s) => s.crn)).size, 3)
  })

  it('reads enrolment, status and variable credit ranges', async () => {
    globalThis.fetch = async () => html(LSU_PAGE)
    const sections = await lsu.getSections({ termCode: 'LSUAM_FALL_2026', subjectCode: 'CSC' })
    const lec = sections[0]
    assert.deepEqual(lec.enrollment, { max: 150, current: 71, available: 79 })
    assert.equal(lec.status, 'open')
    assert.equal(lec.credits, 4)
    assert.equal(lec.subjectCode, 'CSC')
    assert.equal(lec.courseNumber, '1350')
    assert.equal(lec.title, 'COMP SCI I-MJRS')

    // "1 - 3 Credit Hours" keeps the low end; a full section reads closed.
    const ind = sections[2]
    assert.equal(ind.credits, 1)
    assert.equal(ind.status, 'closed')
    assert.deepEqual(ind.meetings, [])
  })
})
