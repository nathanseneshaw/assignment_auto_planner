/**
 * Tests for udel-scraper.js (University of Delaware).
 *
 * UD's Course Search is a server-rendered form + results table. These tests
 * stub fetch with representative markup captured from the live app so they
 * exercise the parse logic (term/subject <select>s and the results table),
 * not the live host.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as udel from '../course-planner/udel-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function htmlRes(body) {
  return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => body, json: async () => JSON.parse(body) }
}

const LANDING = `<html><body>
  <select id='term' name='term'>
    <option value='2265'>2026 Summer (2265)</option>
    <option value='2268' selected='selected'>2026 Fall (2268)</option>
  </select>
  <select name="subj_area_code" id="subj_area_code">
    <option value=""></option>
    <option value="CISC">Computer & Information Sciences (CISC)</option>
    <option value="ACCT">Accounting (ACCT)</option>
  </select>
</body></html>`

// Results table: one lecture, one multi-meeting section, one async section.
const RESULTS = `<html><body>
<table><tbody>
  <tr>
    <td class="course"><a href="courseInfo?&courseid=006602&offernum=1&term=2268&session=1&section=010" class="coursenum">CISC101010</a><span class="coursetype">LEC</span><br><span class="label label-info">WL </span></td>
    <td>Principles of Computing</td>
    <td class="campus">NEWRK</td>
    <td class="openseats">21 OF 60</td>
    <td>3 Hrs</td>
    <td class="day">TR <br/></td>
    <td class="time">9:35AM - 10:55AM <br/></td>
    <td class="mtgdate">Aug 25 - Dec 8</td>
    <td class="session">Regular</td>
    <td class="instruction-mode">Face to Face</td>
  </tr>
  <tr>
    <td class="course"><a href="courseInfo?&courseid=007000&offernum=1&term=2268&session=1&section=012" class="coursenum">CISC220012</a><span class="coursetype">LEC</span></td>
    <td>Data Structures</td>
    <td class="campus">NEWRK</td>
    <td class="openseats">0 OF 40</td>
    <td>3 Hrs</td>
    <td class="day">MW <br/>F <br/></td>
    <td class="time">10:00AM - 10:50AM <br/>1:25PM - 2:15PM <br/></td>
    <td class="mtgdate">Aug 25 - Dec 8</td>
    <td class="session">Regular</td>
    <td class="instruction-mode">Hybrid</td>
  </tr>
  <tr>
    <td class="course"><a href="courseInfo?&courseid=007100&offernum=1&term=2268&session=1&section=070" class="coursenum">CISC106070L</a><span class="coursetype">LAB</span></td>
    <td>General Computer Science</td>
    <td class="campus">NEWRK</td>
    <td class="openseats">5 OF 25</td>
    <td>3 Hrs</td>
    <td class="day">ASYN <br/></td>
    <td class="time"> <br/></td>
    <td class="mtgdate">Aug 25 - Dec 8</td>
    <td class="session">Regular</td>
    <td class="instruction-mode">Online</td>
  </tr>
</tbody></table>
</body></html>`

function routed(url) {
  if (url.includes('search-results')) return htmlRes(RESULTS)
  return htmlRes(LANDING)
}

describe('udel getTerms', () => {
  it('parses term codes and strips the "(code)" suffix', async () => {
    globalThis.fetch = async (url) => routed(url)
    const terms = await udel.getTerms()
    assert.deepEqual(terms, [
      { code: '2265', label: '2026 Summer' },
      { code: '2268', label: '2026 Fall' },
    ])
  })
})

describe('udel getSubjects', () => {
  it('parses subjects, strips the "(CODE)" suffix, sorts by code', async () => {
    globalThis.fetch = async (url) => routed(url)
    const subs = await udel.getSubjects('2268')
    assert.equal(subs[0].code, 'ACCT')
    assert.equal(subs[1].code, 'CISC')
    assert.equal(subs[1].label, 'Computer & Information Sciences')
  })
})

describe('udel getSections', () => {
  it('parses a lecture: course token, seats "N OF M", meeting, id', async () => {
    globalThis.fetch = async (url) => routed(url)
    const secs = await udel.getSections({ termCode: '2268', subjectCode: 'CISC', termLabel: 'Fall 2026', subjectLabel: 'CISC' })
    const s = secs[0]
    assert.equal(s.school, 'udel')
    assert.equal(s.subjectCode, 'CISC')
    assert.equal(s.courseNumber, '101')
    assert.equal(s.sectionNumber, '010')
    assert.equal(s.crn, '006602-010')
    assert.equal(s.title, 'Principles of Computing')
    assert.equal(s.credits, 3)
    assert.deepEqual(s.instructors, []) // no instructor column on the public page
    // "21 OF 60" = 21 available of 60 capacity -> current 39.
    assert.deepEqual(s.enrollment, { max: 60, current: 39, available: 21 })
    assert.equal(s.status, 'open')
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['T', 'R'])
    assert.equal(s.meetings[0].startTime, '09:35')
    assert.equal(s.meetings[0].endTime, '10:55')
    assert.equal(s.meetings[0].location, '') // no room on the public page
  })

  it('parses a multi-meeting section from <br>-separated day/time lines', async () => {
    globalThis.fetch = async (url) => routed(url)
    const secs = await udel.getSections({ termCode: '2268', subjectCode: 'CISC' })
    const s = secs[1]
    assert.equal(s.courseNumber, '220')
    assert.equal(s.sectionNumber, '012')
    assert.equal(s.status, 'closed') // 0 available
    assert.equal(s.meetings.length, 2)
    assert.deepEqual(s.meetings[0].days, ['M', 'W'])
    assert.equal(s.meetings[0].startTime, '10:00')
    assert.deepEqual(s.meetings[1].days, ['F'])
    assert.equal(s.meetings[1].startTime, '13:25')
    assert.equal(s.meetings[1].endTime, '14:15')
  })

  it('async section keeps seats but has no meeting', async () => {
    globalThis.fetch = async (url) => routed(url)
    const secs = await udel.getSections({ termCode: '2268', subjectCode: 'CISC' })
    const s = secs[2]
    assert.deepEqual(s.meetings, [])
    assert.deepEqual(s.enrollment, { max: 25, current: 20, available: 5 })
  })
})
