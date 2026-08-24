/**
 * Tests for austincc-scraper.js (Austin Community College).
 *
 * ACC's public schedule is a GET-driven PHP app: a sidebar of term links, a
 * per-term list of discipline links, and one page of section rows per
 * discipline grouped under <h4> course headers.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as acc from '../course-planner/austincc-scraper.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

function mockRes(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

const LANDING_HTML = `<html><body>
  <div class="menu">
    <h2>Credit Terms</h2>
    <a href=/schedule/index.php?op=browse&opclass=ViewSched&term=226F000&ct=CC&snid=31060>Fall 2026</a>
    <a href=/schedule/index.php?op=browse&opclass=ViewSched&term=227S000&ct=CC&snid=31165>Spring 2027</a>
  </div>
  <div class="menu">
    <h2>Future Credit Terms</h2>
    <a href="/schedule/index.php?op=browse&opclass=ViewSched&term=227U000&ct=CC">Discipline</a>
    <a href="/schedule/index.php?op=browse&opclass=ViewSched_location&term=227U000&ct=CC">Location</a>
  </div>
  <div class="menu">
    <h2>Continuing Education</h2>
    <a href="http://continue.austincc.edu/schedule/">CE Course Schedule</a>
  </div>
</body></html>`

const DISCIPLINES_HTML = `<html><body>
  <a href="/schedule/index.php?op=browse&opclass=ViewSched&term=226F000&disciplineid=PCACC&ct=CC">Accounting</a>
  <a href="/schedule/index.php?op=browse&opclass=ViewSched_ADS&term=226F000&disciplineid=TFIND&ct=CC">African &amp; African Diaspora Studies</a>
  <a href="/schedule/index.php?op=browse&opclass=ViewSched_AMS&term=226F000&disciplineid=TFIND&ct=CC">American Studies</a>
  <a href="/schedule/index.php?op=browse&opclass=ViewSched_location&term=226F000&locationid=CYP&ct=CC">Cypress Creek Campus</a>
</body></html>`

/** One section row, in the column order the live page prints. */
function row({ seats = '[24/24/0]', crn = '36713', type = 'Lec', section = '029', campus = 'CYP', bldg = 'CYP5', room = '2222', days = 'TTh', time = ' 10:30am- 11:45am' } = {}) {
  return `<table class='section_line_odd'><tr class="section_full">
    <td width='2%'>C</td><td width='2%'> R</td><td width='2%'> </td>
    <td width='7%'> ${seats} </td><td width='6%'> ${crn} </td><td width='4%'>${type}</td>
    <td width='4%'> ${section} </td><td width='4%'><a href="#">${campus}</a></td>
    <td width='5%'>${bldg}</td><td width='7%'> ${room}</td>
    <td width='5%'> ${days} </td><td width='13%'>${time}</td>
    <td width='8%'>Aug 24</td><td width='8%'>Dec 13</td>
    <td width='7%'><a href="#">Syllabus</a></td><td width='6%'><a href="#">Textbooks</a></td>
    <td width='7%'><a href="#">Register</a></td>
  </tr></table>`
}

function sectionsPage(rows, header = 'ACCT 2301 Principles of Accounting I - Financial') {
  return `<html><body>
    <p class='teach_term'>16 Week Session: August 24 - December 13</p>
    <h4><a href="#">${header}</a></h4>
    ${rows.join('')}
  </body></html>`
}

function serve(sections) {
  globalThis.fetch = async (url) => {
    if (url.includes('disciplineid=')) return mockRes(sections)
    if (url.includes('term=')) return mockRes(DISCIPLINES_HTML)
    return mockRes(LANDING_HTML)
  }
}

describe('austincc getTerms', () => {
  it('reads only the "Credit Terms" block, not the Future/Past browse menus', async () => {
    serve(sectionsPage([]))
    const terms = await acc.getTerms()
    assert.deepEqual(terms, [
      { code: '226F000', label: 'Fall 2026' },
      { code: '227S000', label: 'Spring 2027' },
    ])
  })

  it('throws rather than returning an empty dropdown', async () => {
    globalThis.fetch = async () => mockRes('<html><body><p>down for maintenance</p></body></html>')
    await assert.rejects(() => acc.getTerms(), /no credit terms/i)
  })
})

describe('austincc getSubjects', () => {
  it('keys plain disciplines by id and TFIND programs by their opclass', async () => {
    serve(sectionsPage([]))
    const subjects = await acc.getSubjects('226F000')
    // Sorted by the name a student would look for, not by ACC's internal id.
    assert.deepEqual(subjects, [
      { code: 'PCACC', label: 'Accounting' },
      { code: 'ADS', label: 'African & African Diaspora Studies' },
      { code: 'AMS', label: 'American Studies' },
    ])
  })
})

describe('austincc getSections', () => {
  it('takes subject, course and title from the <h4> above the rows', async () => {
    serve(sectionsPage([row()]))
    const [sec] = await acc.getSections({
      termCode: '226F000',
      subjectCode: 'PCACC',
      termLabel: 'Fall 2026',
      subjectLabel: 'Accounting',
    })
    assert.equal(sec.school, 'austincc')
    assert.equal(sec.subjectCode, 'ACCT')
    assert.equal(sec.courseNumber, '2301')
    assert.equal(sec.title, 'Principles of Accounting I - Financial')
    assert.equal(sec.sectionNumber, '029')
    assert.equal(sec.crn, '36713')
    // [enrolled/capacity/waitlisted]
    assert.deepEqual(sec.enrollment, { max: 24, current: 24, available: 0 })
    assert.equal(sec.status, 'closed')
    assert.deepEqual(sec.meetings, [
      { days: ['T', 'R'], startTime: '10:30', endTime: '11:45', location: 'CYP5 2222' },
    ])
    // The public listing has neither column.
    assert.deepEqual(sec.instructors, [])
    assert.equal(sec.credits, null)
  })

  it('ships online rows with no meetings and marks open seats open', async () => {
    serve(sectionsPage([row({ seats: '[17/23/0]', type: 'DIL', campus: 'ONL', bldg: 'DIL', room: '', days: '', time: '' })]))
    const [sec] = await acc.getSections({ termCode: '226F000', subjectCode: 'PCACC' })
    assert.deepEqual(sec.meetings, [])
    assert.deepEqual(sec.enrollment, { max: 23, current: 17, available: 6 })
    assert.equal(sec.status, 'open')
  })

  it('skips the lab continuation row that carries no CRN', async () => {
    const continuation = `<table><tr class="section_full">
      <td width='2%'></td><td width='2%'></td><td width='2%'></td><td width='7%'></td>
      <td width='6%'></td><td width='4%'>Lab</td><td width='4%'></td><td width='4%'>ONL</td>
      <td width='5%'>DIL</td><td width='7%'></td><td width='5%'></td><td width='13%'></td>
      <td width='8%'>Aug 24</td><td width='8%'>Dec 13</td>
    </tr></table>`
    serve(sectionsPage([row(), continuation]))
    const secs = await acc.getSections({ termCode: '226F000', subjectCode: 'PCACC' })
    assert.equal(secs.length, 1)
  })

  it('rejects a discipline the term does not list', async () => {
    serve(sectionsPage([]))
    await assert.rejects(
      () => acc.getSections({ termCode: '226F000', subjectCode: 'NOPE' }),
      /no discipline/i
    )
  })
})
