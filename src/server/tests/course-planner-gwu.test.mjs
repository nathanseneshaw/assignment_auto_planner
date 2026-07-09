/**
 * Tests for the GWU scraper (my.gwu.edu/mod/pws ColdFusion schedule).
 * Pins: term-id season decoding (labels are synthesized — the landing page
 * labels its term links by CAMPUS), subject link harvesting, section-row
 * parsing (days and times render in separate tags, joined with no space),
 * " AND "-joined multi-meeting cells, and pageNum pagination.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as gwu from '../course-planner/gwu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockText(body) {
  return { ok: true, status: 200, text: async () => body }
}

describe('gwu.getTerms', () => {
  it('decodes termIds into Season YYYY labels and keeps main campus only', async () => {
    globalThis.fetch = async () => mockText(`
      <a href="subjects.cfm?campId=1&termId=202603">Main Campus</a>
      <a href="subjects.cfm?campId=4&termId=202603">Mount Vernon</a>
      <a href="subjects.cfm?campId=1&termId=202602">Main Campus</a>
      <a href="subjects.cfm?campId=1&termId=202601">Main Campus</a>`)
    assert.deepEqual(await gwu.getTerms(), [
      { code: '202603', label: 'Fall 2026' },
      { code: '202602', label: 'Summer 2026' },
      { code: '202601', label: 'Spring 2026' },
    ])
  })
})

describe('gwu.getSubjects', () => {
  it('harvests courses.cfm links with their names', async () => {
    globalThis.fetch = async () => mockText(`
      <a HREF="courses.cfm?campId=1&termId=202603&subjId=CSCI">Computer Science</a>
      <a HREF="courses.cfm?campId=1&termId=202603&subjId=ACCY">Accountancy</a>`)
    assert.deepEqual(await gwu.getSubjects('202603'), [
      { code: 'ACCY', label: 'Accountancy' },
      { code: 'CSCI', label: 'Computer Science' },
    ])
  })
})

function row(status, crn, sec, extra = '') {
  return `<tr class="tableRow1Font coursetable alignCenter crseRow1">
    <td>${status}</td><td><a>${crn}</a></td><td>CSCI 1010</td><td>${sec}</td>
    <td>Computer Science Orientation</td><td>1.00</td><td>Taylor, J</td>
    <td>MPA B07${extra ? ' AND SEH 1400' : ''}</td>
    <td>F<br>10:40AM - 11:30AM${extra ? '<br>AND<br>W<br>03:45PM - 05:00PM' : ''}</td>
    <td>08/24/26 - 12/08/26</td><td>Find Books</td>
  </tr>`
}

describe('gwu.getSections', () => {
  it('parses rows (day/time on <br> lines), splits <br>AND<br> and " AND " joins, follows pageNum pages', async () => {
    const posts = []
    globalThis.fetch = async (url, opts = {}) => {
      if (opts.method === 'POST') {
        posts.push(opts.body)
        return mockText(`<table>${row('CLOSED', '54465', '34')}</table>`) // page 2, no Next
      }
      return mockText(`<table>${row('OPEN', '52950', '10', true)}</table>
        <a href="javascript:nextPage()">Next Page &gt;&gt;</a>`)
    }
    const sections = await gwu.getSections({
      termCode: '202603', subjectCode: 'CSCI', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)
    assert.deepEqual(posts, ['pageNum=2'])

    const s0 = sections[0]
    assert.equal(s0.crn, '52950')
    assert.equal(s0.status, 'open')
    assert.equal(s0.courseNumber, '1010')
    assert.equal(s0.credits, 1)
    assert.deepEqual(s0.instructors, ['Taylor, J'])
    assert.deepEqual(s0.enrollment, { max: null, current: null, available: null })
    assert.deepEqual(s0.meetings, [
      { days: ['F'], startTime: '10:40', endTime: '11:30', location: 'MPA B07' },
      { days: ['W'], startTime: '15:45', endTime: '17:00', location: 'SEH 1400' },
    ])
    assert.equal(sections[1].status, 'closed')
  })
})
