/**
 * Tests for tcu-scraper.js (Texas Christian University ASP.NET WebForms scraper).
 * Covers: getTerms HTML parsing, niceTermLabel formatting, parseSections table
 * parsing, parseMeeting day/time extraction, mapStatus, and the retry loop.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as tcu from '../course-planner/tcu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Base form with viewstate fields and a term dropdown
function formHtml(terms = [], viewstate = 'VS1') {
  const opts = terms.map(({ code, label }) => `<option value="${code}">${label}</option>`).join('')
  return `<html><body>
    <form>
      <input id="__VIEWSTATE" value="${viewstate}" />
      <input id="__VIEWSTATEGENERATOR" value="GEN1" />
      <input id="__EVENTVALIDATION" value="EV1" />
      <select id="ddlTerm">${opts}</select>
      <select id="ddlSubject"></select>
    </form>
  </body></html>`
}

// Term-bound form with subjects
function termBoundHtml(subjects = []) {
  const opts = subjects.map(({ code, label }) => `<option value="${code}">${label}</option>`).join('')
  return `<html><title>Term Bound</title><body>
    <form>
      <input id="__VIEWSTATE" value="VS2" />
      <input id="__VIEWSTATEGENERATOR" value="GEN2" />
      <input id="__EVENTVALIDATION" value="EV2" />
      <select id="ddlTerm"><option value="20251">26 Fall</option></select>
      <select id="ddlSubject">
        <option value="ANY">Any</option>
        ${opts}
      </select>
    </form>
  </body></html>`
}

// "Term Search Results" HTML — the grid with sections
function resultsHtml(rows = []) {
  const trs = rows.map(({ crn, course, secSession, title, daysTime, status, enrMax }) => `
    <tr>
      <td>${crn}</td>
      <td>${course}</td>
      <td>Note</td>
      <td>${secSession || '001<br/>REG'}</td>
      <td>LEC</td>
      <td></td>
      <td>${title}</td>
      <td>08/25</td>
      <td>F2F</td>
      <td>${daysTime}</td>
      <td>${status || 'Open'}</td>
      <td>${enrMax || '30<br/>30'}</td>
      <td>0</td>
      <td>0</td>
      <td></td>
    </tr>
  `).join('')
  return `<html><title>Fall 2026 Term Search Results</title><body>
    <table class="results">
      <tr><th>ClassNbr</th><th>Course</th><th>Note</th><th>Sec</th><th>Type</th>
          <th>Core</th><th>Title</th><th>Start</th><th>Mode</th><th>DaysTime</th>
          <th>Status</th><th>Enr/Max</th><th>RsvMax</th><th>WaitMax</th><th>Matls</th></tr>
      ${trs}
    </table>
  </body></html>`
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('tcu.getTerms', () => {
  it('parses term options and applies niceTermLabel formatting', async () => {
    globalThis.fetch = async () => mockRes(formHtml([
      { code: '20251', label: '26 Fall' },
      { code: '20252', label: '26 Spring' },
      { code: '20253', label: '26 Summer' },
    ]))
    const terms = await tcu.getTerms()
    assert.equal(terms.length, 3)
    assert.equal(terms[0].code, '20251')
    assert.equal(terms[0].label, 'Fall 2026')
    assert.equal(terms[1].label, 'Spring 2026')
    assert.equal(terms[2].label, 'Summer 2026')
  })

  it('excludes option with value "ANY"', async () => {
    globalThis.fetch = async () => mockRes(formHtml([
      { code: 'ANY', label: 'Any Term' },
      { code: '20251', label: '26 Fall' },
    ]))
    const terms = await tcu.getTerms()
    assert.equal(terms.length, 1)
    assert.equal(terms[0].code, '20251')
  })

  it('preserves unrecognized term labels unchanged', async () => {
    globalThis.fetch = async () => mockRes(formHtml([{ code: '99', label: 'Maymester 2026' }]))
    const [t] = await tcu.getTerms()
    assert.equal(t.label, 'Maymester 2026')
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('tcu.getSubjects', () => {
  it('parses subjects from the term-bound form', async () => {
    const form = formHtml([{ code: '20251', label: '26 Fall' }])
    const bound = termBoundHtml([
      { code: 'ACCT', label: 'ACCT - Accounting' },
      { code: 'BIOL', label: 'BIOL - Biology' },
    ])
    let call = 0
    globalThis.fetch = async () => mockRes(call++ === 0 ? form : bound)
    const subjects = await tcu.getSubjects('20251')
    assert.equal(subjects.length, 2)
    assert.equal(subjects[0].code, 'ACCT')
    // "ACCT - Accounting" → label should be "Accounting"
    assert.equal(subjects[0].label, 'Accounting')
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('tcu.getSections', () => {
  it('parses a section with MWF meeting time', async () => {
    const form = formHtml([{ code: '20251', label: '26 Fall' }])
    const bound = termBoundHtml([{ code: 'ACCT', label: 'ACCT - Accounting' }])
    const results = resultsHtml([{
      crn: '30001', course: 'ACCT 20103',
      title: 'Principles of Accounting',
      daysTime: 'MWF<br/>09:00-10:15',
      status: 'Open', enrMax: '25<br/>30',
    }])
    let stage = 0
    globalThis.fetch = async () => mockRes([form, bound, results][Math.min(stage++, 2)])
    const sections = await tcu.getSections({ termCode: '20251', subjectCode: 'ACCT', termLabel: 'Fall 2026', subjectLabel: 'Accounting' })
    assert.equal(sections.length, 1)
    const s = sections[0]
    assert.equal(s.school, 'tcu')
    assert.equal(s.crn, '30001')
    assert.equal(s.title, 'Principles of Accounting')
    assert.equal(s.status, 'open')
    assert.equal(s.enrollment.current, 25)
    assert.equal(s.enrollment.max, 30)
    assert.equal(s.enrollment.available, 5)
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '09:00')
    assert.equal(s.meetings[0].endTime, '10:15')
  })

  it('returns empty meetings for TBA/ARR rows', async () => {
    const form = formHtml([{ code: '20251', label: '26 Fall' }])
    const bound = termBoundHtml([{ code: 'CS', label: 'CS' }])
    const results = resultsHtml([{
      crn: '99999', course: 'CS 10000',
      title: 'Online Course',
      daysTime: 'ARR<br/>',
      status: 'Open', enrMax: '50<br/>60',
    }])
    let stage = 0
    globalThis.fetch = async () => mockRes([form, bound, results][Math.min(stage++, 2)])
    const [s] = await tcu.getSections({ termCode: '20251', subjectCode: 'CS' })
    assert.equal(s.meetings.length, 0)
  })

  it('throws after MAX_TRIES if err.aspx is always returned', async () => {
    const form = formHtml([{ code: '20251', label: '26 Fall' }])
    globalThis.fetch = async (url, opts) => {
      if (!opts || opts.method !== 'POST') return mockRes(form)
      // Simulate the bound-term postback returning the form (no subjects populated)
      if (!opts.body?.includes('btnSearch')) return mockRes(form)
      return mockRes('<html><title>err</title><body>temporarily down</body></html>')
    }
    await assert.rejects(
      () => tcu.getSections({ termCode: '20251', subjectCode: 'ACCT' }),
      /transient/i
    )
  }, { timeout: 15000 })
})
