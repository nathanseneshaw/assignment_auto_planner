/**
 * Tests for tamucc-scraper.js (Texas A&M-Corpus Christi).
 *
 * A&M-Corpus Christi publishes one HTML table per subject from a small PHP app;
 * the interesting logic is the "Available / Capacity / WL" cell and the time
 * cell, where only the END time carries an am/pm suffix.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as tamucc from '../course-planner/tamucc-scraper.js'

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

const FORM_HTML = `<html><body>
  <form name="schedule" action="https://banner.tamucc.edu/schedule/BPROD.php" method="post">
    <select NAME="frmTerm">
      <option value="">Select a Term</option>
      <option value="202611">Fall 2 Online Mini-Term 2026</option>
      <option value="202610">Fall 1 Online Mini-Term 2026</option>
      <option value="202609">Fall Full Term 2026</option>
      <option value="202601">Spring Full Term 2026</option>
    </select>
    <select name='frmPrefix'>
      <option value=''>Select a Course Subject</option>
      <option value='SelectCourseSelected'>All Subjects</option>
      <option value='ACCT-Accounting'>ACCT-Accounting</option>
      <option value='BAIS-Business Analytics &amp; Info Sys'>BAIS-Business Analytics &amp; Info Sys</option>
    </select>
  </form>
</body></html>`

/** One results row; every column the real page prints, in order. */
function row({ crn = '80909', course = 'ACCT-2301.002', title = 'FINANCIAL ACCOUNTING', seats = '33 / 95 / 5', instructor = 'C.  Wertheim', time = 'TR 09:30-10:45AM', bldg = 'OCNR-115', hrs = '3' } = {}) {
  return `<tr bgcolor=#E6E6E6>
    <td>${crn}</td><td>${course}</td><td><a href="#">view</a></td><td>LEC</td>
    <td>${title}</td><td>notes</td><td>${seats}</td><td>08/24-12/10</td>
    <td>Face-to-Face</td><td><a href="#">${instructor}</a></td><td>${time}</td>
    <td>${bldg}</td><td>95</td><td>${hrs}</td><td></td><td></td><td><a href="#">View Books</a></td>
  </tr>`
}

function listing(rows) {
  return `<html><body><table>
    <tr bgcolor=#BDBDBD><th>Call Numb (CRN)</th><th>Course</th></tr>
    ${rows.join('')}
  </table></body></html>`
}

function serve(sectionsHtml) {
  globalThis.fetch = async (url, opts = {}) =>
    mockRes(opts.method === 'POST' ? sectionsHtml : FORM_HTML)
}

describe('tamucc getTerms', () => {
  it('keeps full terms and drops the online mini-terms that shadow them', async () => {
    serve(listing([]))
    const terms = await tamucc.getTerms()
    assert.deepEqual(
      terms.map((t) => t.code),
      ['202609', '202601']
    )
    assert.equal(terms[0].label, 'Fall Full Term 2026')
  })
})

describe('tamucc getSubjects', () => {
  it('splits the "CODE-Label" option value and drops the placeholders', async () => {
    serve(listing([]))
    const subjects = await tamucc.getSubjects('202609')
    assert.deepEqual(subjects, [
      { code: 'ACCT', label: 'Accounting' },
      { code: 'BAIS', label: 'Business Analytics & Info Sys' },
    ])
  })
})

describe('tamucc getSections', () => {
  it('parses CRN, course, seats, instructor and meeting time', async () => {
    serve(listing([row()]))
    const [sec] = await tamucc.getSections({
      termCode: '202609',
      subjectCode: 'ACCT',
      termLabel: 'Fall 2026',
      subjectLabel: 'Accounting',
    })
    assert.equal(sec.school, 'tamucc')
    assert.equal(sec.crn, '80909')
    assert.equal(sec.subjectCode, 'ACCT')
    assert.equal(sec.courseNumber, '2301')
    assert.equal(sec.sectionNumber, '002')
    assert.equal(sec.title, 'FINANCIAL ACCOUNTING')
    assert.equal(sec.credits, 3)
    // "33 / 95 / 5" is available / capacity / waitlist.
    assert.deepEqual(sec.enrollment, { max: 95, current: 62, available: 33 })
    assert.equal(sec.status, 'open')
    assert.deepEqual(sec.instructors, ['C. Wertheim'])
    assert.deepEqual(sec.meetings, [
      { days: ['T', 'R'], startTime: '09:30', endTime: '10:45', location: 'OCNR-115' },
    ])
  })

  it('reads the am/pm off the end time and keeps a noon-spanning class in the morning', async () => {
    serve(listing([row({ time: 'TR 11:00-12:15PM' }), row({ crn: '80910', time: 'MW 02:00-03:15PM' })]))
    const secs = await tamucc.getSections({ termCode: '202609', subjectCode: 'ACCT' })
    assert.equal(secs[0].meetings[0].startTime, '11:00')
    assert.equal(secs[0].meetings[0].endTime, '12:15')
    assert.equal(secs[1].meetings[0].startTime, '14:00')
    assert.equal(secs[1].meetings[0].endTime, '15:15')
  })

  it('treats an over-enrolled section as closed and keeps current above capacity', async () => {
    serve(listing([row({ seats: '-1 / 11 /' })]))
    const [sec] = await tamucc.getSections({ termCode: '202609', subjectCode: 'ACCT' })
    assert.deepEqual(sec.enrollment, { max: 11, current: 12, available: -1 })
    assert.equal(sec.status, 'closed')
  })

  it('ships an online section with no meetings rather than a broken one', async () => {
    serve(listing([row({ time: '', bldg: '' })]))
    const [sec] = await tamucc.getSections({ termCode: '202609', subjectCode: 'ACCT' })
    assert.deepEqual(sec.meetings, [])
  })

  it('ignores header and spacer rows', async () => {
    serve(listing([row(), '<tr bgcolor=#E6E6E6><td>x</td><td>y</td></tr>']))
    const secs = await tamucc.getSections({ termCode: '202609', subjectCode: 'ACCT' })
    assert.equal(secs.length, 1)
  })

  it('rejects a subject the schedule does not list', async () => {
    serve(listing([]))
    await assert.rejects(
      () => tamucc.getSections({ termCode: '202609', subjectCode: 'NOPE' }),
      /no subject/i
    )
  })
})
