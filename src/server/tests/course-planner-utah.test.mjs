/**
 * Tests for utah-scraper.js (University of Utah — static class-schedule pages).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as utah from '../course-planner/utah-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const pad = 'x'.repeat(2100) // fetchPage treats short bodies as stub pages

const INDEX_HTML = `<html><body>
  <a href="class_list.html?subject=CS">CS - Computer Science</a>
  <a href="class_list.html?subject=ECON">ECON - Economics</a>
  <a href="class_list.html?subject=CS">CS - Computer Science</a>
<!-- ${pad} --></body></html>`

const LIST_HTML = `<html><body>
<div class="class-info card" id="4033">
  <h3><a href="sections.html?subj=CS&catno=1400">CS 1400</a> - <span>001</span> <span>Intro Comp Programming</span></h3>
  <ul>
    <li>Class Number: <a id="4033"></a> <span>4033</span></li>
    <li>Component: <span>Lecture</span></li>
    <li data-units="U4_0"> Units: <span> 4.0</span></li>
    <li class="d-none" data-seats="true"> Seats Available: <span>34</span></li>
  </ul>
  <div class="card-footer">
    <table class="table time-table"><tbody><tr>
      <th scope="row"><span data-day="MoWe">MoWe</span>/<span data-time="A">03:00PM-04:20PM</span></th>
      <th scope="row" data-building-code="GC"><a href="http://map.utah.edu">GC 1900</a></th>
    </tr></tbody></table>
  </div>
</div>
<div class="class-info card" id="4034">
  <h3><a href="sections.html?subj=CS&catno=2420">CS 2420</a> - <span>002</span> <span>Intro Algorithms</span></h3>
  <ul>
    <li>Class Number: <span>4034</span></li>
    <li>Component: <span>Laboratory</span></li>
    <li> Units: <span> 4.0</span></li>
    <li class="d-none" data-seats="true"> Seats Available: <span>0</span></li>
  </ul>
</div>
<!-- ${pad} --></body></html>`

function dispatch(url) {
  const u = String(url)
  if (u.includes('class_list.html')) return { ok: true, status: 200, text: async () => LIST_HTML }
  if (u.includes('/index.html')) {
    // Only this year's Summer/Fall "exist" in the mock.
    const year = String(new Date().getFullYear()).slice(-2)
    const exists = u.includes(`/1${year}6/`) || u.includes(`/1${year}8/`)
    return exists
      ? { ok: true, status: 200, text: async () => INDEX_HTML }
      : { ok: false, status: 404, text: async () => 'not found' }
  }
  return { ok: false, status: 404, text: async () => 'not found' }
}

describe('utah.getTerms', () => {
  it('synthesizes strm candidates and keeps the ones whose index exists', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    const year = new Date().getFullYear()
    const yy = String(year).slice(-2)
    assert.deepEqual(await utah.getTerms(), [
      { code: `1${yy}6`, label: `Summer ${year}` },
      { code: `1${yy}8`, label: `Fall ${year}` },
    ])
  })
})

describe('utah.getSubjects', () => {
  it('parses and dedupes class_list links', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    const year = String(new Date().getFullYear()).slice(-2)
    assert.deepEqual(await utah.getSubjects(`1${year}8`), [
      { code: 'CS', label: 'Computer Science' },
      { code: 'ECON', label: 'Economics' },
    ])
  })
})

describe('utah.getSections', () => {
  it('parses cards with seats-available, meetings and open/closed', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    const sections = await utah.getSections({
      termCode: '1268', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'utah')
    assert.equal(s0.courseNumber, '1400')
    assert.equal(s0.sectionNumber, '001')
    assert.equal(s0.crn, '4033')
    assert.equal(s0.title, 'Intro Comp Programming')
    assert.equal(s0.credits, 4)
    assert.deepEqual(s0.enrollment, { max: null, current: null, available: 34 })
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.meetings, [
      { days: ['M', 'W'], startTime: '15:00', endTime: '16:20', location: 'GC 1900' },
    ])

    const s1 = sections[1]
    assert.equal(s1.crn, '4034')
    assert.equal(s1.status, 'closed') // 0 seats available
    assert.deepEqual(s1.meetings, [])
  })
})
