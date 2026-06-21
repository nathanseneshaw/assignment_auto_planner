/**
 * Tests for columbia-scraper.js (Columbia — Directory of Classes static HTML).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as columbia from '../course-planner/columbia-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const SUBJECTS_HTML = `<html><body><table>
  <tr><td>Computer Science</td>
      <td><a href="../subj/COMS/_Fall2025.html">Fall2025</a>, <a href="../subj/COMS/_Spring2026.html">Spring2026</a></td></tr>
  <tr><td>Economics</td>
      <td><a href="../subj/ECON/_Fall2025.html">Fall2025</a></td></tr>
  <tr><td>Not Offered</td><td>&nbsp;</td></tr>
</table></body></html>`

const COMS_HTML = `<html><body><table class="course-listing">
  <tr><th colspan=2>Fall 2025 Computer Science W1004<br>INTRO-COMPUT SCI/PROG IN JAVA</th></tr>
  <tr><td><a href="../../subj/COMS/W1004-20253-001/">Section 001</a></td>
    <td><div class="course-details"><dl>
      <h1>INTRO-COMPUT SCI/PROG IN</h1>
      <dt>Call Number:</dt><dd>12794</dd>
      <dt>Points:</dt><dd>3</dd>
      <dt>Enrollment:</dt><dd>268 students (320 max) as of June 21, 2026</dd>
      <dt>Instructors:</dt><dd>Paul S Blaer and Jane Doe</dd>
    </dl></div></td></tr>
  <tr><th colspan=2>Fall 2025 Computer Science W3203<br>DISCRETE MATHEMATICS</th></tr>
  <tr><td><a href="../../subj/COMS/W3203-20253-001/">Section 001</a></td>
    <td><div class="course-details"><dl>
      <dt>Call Number:</dt><dd>11111</dd>
      <dt>Points:</dt><dd>3</dd>
      <dt>Enrollment:</dt><dd>120 students (120 max) as of June 21, 2026</dd>
      <dt>Instructor:</dt><dd>Staff</dd>
    </dl></div></td></tr>
</table></body></html>`

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}
function makeFetch(dispatch) {
  return async (url) => {
    const key = Object.keys(dispatch).find((k) => url.includes(k))
    return mockText(key ? dispatch[key] : '')
  }
}

describe('columbia.getTerms', () => {
  it('parses + chronologically sorts terms from subjects.html', async () => {
    globalThis.fetch = makeFetch({ '/sel/subjects.html': SUBJECTS_HTML })
    assert.deepEqual(await columbia.getTerms(), [
      { code: 'Fall2025', label: 'Fall 2025' },
      { code: 'Spring2026', label: 'Spring 2026' },
    ])
  })
})

describe('columbia.getSubjects', () => {
  it('returns subjects offered in a term, sorted by label, skipping no-term rows', async () => {
    globalThis.fetch = makeFetch({ '/sel/subjects.html': SUBJECTS_HTML })
    assert.deepEqual(await columbia.getSubjects('Fall2025'), [
      { code: 'COMS', label: 'Computer Science' },
      { code: 'ECON', label: 'Economics' },
    ])
    assert.deepEqual(await columbia.getSubjects('Spring2026'), [
      { code: 'COMS', label: 'Computer Science' },
    ])
  })
})

describe('columbia.getSections', () => {
  it('parses sections with enrollment counts, credits, instructors and status', async () => {
    globalThis.fetch = makeFetch({ '/subj/COMS/_Fall2025.html': COMS_HTML })
    const sections = await columbia.getSections({
      termCode: 'Fall2025', subjectCode: 'COMS', termLabel: 'Fall 2025', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s = sections[0]
    assert.equal(s.school, 'columbia')
    assert.equal(s.crn, '12794')
    assert.equal(s.courseNumber, 'W1004')
    assert.equal(s.sectionNumber, '001')
    assert.equal(s.title, 'INTRO-COMPUT SCI/PROG IN JAVA')
    assert.equal(s.credits, 3)
    assert.deepEqual(s.enrollment, { max: 320, current: 268, available: 52 })
    assert.equal(s.status, 'open')
    assert.deepEqual(s.instructors, ['Paul S Blaer', 'Jane Doe'])
    assert.deepEqual(s.meetings, []) // meeting times live in Vergil (login-gated)

    const full = sections[1]
    assert.equal(full.crn, '11111')
    assert.equal(full.courseNumber, 'W3203')
    assert.deepEqual(full.enrollment, { max: 120, current: 120, available: 0 })
    assert.equal(full.status, 'closed') // no seats available
    assert.deepEqual(full.instructors, []) // "Staff" filtered
  })

  it('throws on a non-200 subject page', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' })
    await assert.rejects(
      () => columbia.getSections({ termCode: 'Fall2025', subjectCode: 'COMS' }),
      /HTTP 404/
    )
  })
})
