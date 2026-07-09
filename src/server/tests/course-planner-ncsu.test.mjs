/**
 * Tests for ncsu-scraper.js (NC State — coursecat PHP app).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as ncsu from '../course-planner/ncsu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const FORM_HTML = `<form>
  <select name="term" class="form-control" id="strm">
    <option value="2268" selected>2026 Fall Term</option>
    <option value="2267">2026 Summer Term 2</option>
  </select>
</form>`

const SUBJECTS_JSON = {
  subj_html:
    '<li><a data-value="CSC - Computer Science" href="#">CSC - Computer Science</a></li>' +
    '<li><a data-value="EC - Economics" href="#">EC - Economics</a></li>',
}

// One course block with one open section (1 of 60 seats left, MW meeting) and
// one waitlisted section with a TBA meeting.
const SEARCH_HTML = `
<section class="course" id="CSC-110">
  <h1>CSC 110 <small>Computer Science Principles</small> <span class="units pull-right">Units: 3</span></h1>
  <table class="table section-table">
    <thead><tr><th>Sec</th><th>Comp</th><th>Class #</th><th>Avail.</th><th>Day/Time</th><th>Loc</th><th>Instructor</th><th>Dates</th><th>Topic</th><th>Notes</th></tr></thead>
    <tr>
      <td>001</td><td>Lec</td><td class="class-num">9471</td>
      <td><span class="text-success">Open</span><br />1/60</td>
      <td><ul class="weekdisplay">
        <li class="meet"><abbr title="Monday - meet">M</abbr></li>
        <li class="open"><abbr title="Tuesday">T</abbr></li>
        <li class="meet"><abbr title="Wednesday - meet">W</abbr></li>
      </ul> 1:30 PM - 2:45 PM </td>
      <td>341 111 Lampe Drive</td>
      <td><a href="#" class="instructor-link">Price,Thomas William</a></td>
      <td>08/17/26 - 12/01/26</td><td></td><td></td>
    </tr>
    <tr>
      <td>002</td><td>Lec</td><td class="class-num">9472</td>
      <td><span class="text-danger">Waitlist</span><br />0/60</td>
      <td>TBA</td>
      <td>TBA</td>
      <td>Staff</td>
      <td>08/17/26 - 12/01/26</td><td></td><td></td>
    </tr>
  </table>
</section>`

function dispatch(url) {
  const u = String(url)
  if (u.endsWith('/subjects.php')) {
    return { ok: true, status: 200, json: async () => SUBJECTS_JSON }
  }
  if (u.endsWith('/search.php')) {
    return { ok: true, status: 200, json: async () => ({ html: SEARCH_HTML }) }
  }
  return { ok: true, status: 200, text: async () => FORM_HTML }
}

describe('ncsu.getTerms', () => {
  it('parses the term select', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    assert.deepEqual(await ncsu.getTerms(), [
      { code: '2268', label: '2026 Fall Term' },
      { code: '2267', label: '2026 Summer Term 2' },
    ])
  })
})

describe('ncsu.getSubjects', () => {
  it('parses subjects.php data-values into code + label', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    assert.deepEqual(await ncsu.getSubjects('2268'), [
      { code: 'CSC', label: 'Computer Science' },
      { code: 'EC', label: 'Economics' },
    ])
  })
})

describe('ncsu.getSections', () => {
  it('parses sections with open/total seats, meetings and instructors', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    const sections = await ncsu.getSections({
      termCode: '2268', subjectCode: 'CSC', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'ncsu')
    assert.equal(s0.courseNumber, '110')
    assert.equal(s0.sectionNumber, '001')
    assert.equal(s0.crn, '9471')
    assert.equal(s0.title, 'Computer Science Principles')
    assert.equal(s0.credits, 3)
    // "1/60" = 1 open seat of 60 total
    assert.deepEqual(s0.enrollment, { max: 60, available: 1, current: 59 })
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.instructors, ['Price,Thomas William'])
    assert.deepEqual(s0.meetings, [
      { days: ['M', 'W'], startTime: '13:30', endTime: '14:45', location: '341 111 Lampe Drive' },
    ])

    const s1 = sections[1]
    assert.equal(s1.status, 'closed') // Waitlist
    assert.deepEqual(s1.enrollment, { max: 60, available: 0, current: 60 })
    assert.deepEqual(s1.instructors, []) // Staff filtered
    assert.deepEqual(s1.meetings, []) // TBA
  })
})
