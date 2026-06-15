/**
 * Tests for rice-scraper.js (Rice University — CSV enrollment + HTML schedule merge).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as rice from '../course-planner/rice-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [] },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Enrollment form HTML (Rice's !swkenrc.main page)
function enrollFormHtml({ asFid = 'token123', terms = [], subjects = [] } = {}) {
  const termOpts = terms.map(({ code, label }) => `<option value="${code}">${label}</option>`).join('')
  const subjOpts = subjects.map(({ code, label }) => `<option value="${code}">${label} (${code})</option>`).join('')
  return `<html><body>
    <input name="as_fid" value="${asFid}" />
    <select name="term">${termOpts}</select>
    <select name="subj">${subjOpts}</select>
  </body></html>`
}

// CSV enrollment data (what !swkenrc.main returns for a subject query)
function enrollmentCsv(rows) {
  const header = 'TERM,SUBJ,COURSE,SECTION,CRN,TITLE,CREDITS,DEPARTMENT,SECT MAX,SECT ENRL,TTL ENRL,TTL SEATS AVAIL,INSTRUCTOR NAME(S)'
  const lines = rows.map((r) => Object.values(r).map((v) => {
    const s = String(v)
    return s.includes(',') ? `"${s}"` : s
  }).join(','))
  return [header, ...lines].join('\n')
}

// HTML from the Rice schedule page (!SWKSCAT.cat)
function scheduleHtml(sections = []) {
  const rows = sections.map(({ crn, times = [] }) => {
    const divs = times.map((t) => `<div>${t}</div>`).join('')
    return `<tr><td class="cls-crn">${crn}</td><td class="cls-mtg"><div class="mtg-clas">${divs}</div></td></tr>`
  }).join('')
  return `<html><body><table><tbody>${rows}</tbody></table></body></html>`
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('rice.getTerms', () => {
  it('returns terms from the form', async () => {
    globalThis.fetch = async () => mockRes(enrollFormHtml({
      terms: [{ code: 'F24', label: 'Fall 2024' }, { code: 'S25', label: 'Spring 2025' }],
    }))
    const terms = await rice.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, 'F24')
    assert.equal(terms[0].label, 'Fall 2024')
  })

  it('returns empty list when form has no term options', async () => {
    globalThis.fetch = async () => mockRes(enrollFormHtml({ terms: [] }))
    assert.deepEqual(await rice.getTerms(), [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('rice.getSubjects', () => {
  it('strips "(CODE)" suffix from subject label', async () => {
    globalThis.fetch = async () => mockRes(enrollFormHtml({
      subjects: [
        { code: 'COMP', label: 'Computer Science' },
        { code: 'MATH', label: 'Mathematics' },
      ],
    }))
    const subjects = await rice.getSubjects()
    assert.equal(subjects.length, 2)
    assert.equal(subjects[0].code, 'COMP')
    assert.equal(subjects[0].label, 'Computer Science')
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('rice.getSections', () => {
  it('merges enrollment CSV with schedule HTML and returns unified shape', async () => {
    const csv = enrollmentCsv([{
      TERM: 'F24', SUBJ: 'COMP', COURSE: '182', SECTION: '1', CRN: '12345',
      TITLE: 'Intro to CS', CREDITS: '3', DEPARTMENT: 'Computer Science',
      'SECT MAX': '25', 'SECT ENRL': '20', 'TTL ENRL': '20',
      'TTL SEATS AVAIL': '5', 'INSTRUCTOR NAME(S)': 'Doris, Marcia',
    }])
    const sched = scheduleHtml([{ crn: '12345', times: ['1:00PM - 2:15PM TR'] }])

    let callIdx = 0
    globalThis.fetch = async (url) => {
      // First call: load the enrollment form
      if (url.includes('swkenrc.main') && !url.includes('?')) return mockRes(enrollFormHtml({ asFid: 'tok1' }))
      // CSV export
      if (url.includes('swkenrc.main')) return mockRes(csv)
      // Schedule HTML
      if (url.includes('SWKSCAT.cat')) return mockRes(sched)
      return mockRes('')
    }

    const sections = await rice.getSections({ termCode: 'F24', subjectCode: 'COMP', termLabel: 'Fall 2024', subjectLabel: 'CS' })
    assert.equal(sections.length, 1)
    const s = sections[0]
    assert.equal(s.school, 'rice')
    assert.equal(s.crn, '12345')
    assert.equal(s.title, 'Intro to CS')
    assert.equal(s.credits, 3)
    assert.equal(s.enrollment.max, 25)
    assert.equal(s.enrollment.current, 20)
    assert.equal(s.enrollment.available, 5)
    assert.equal(s.status, 'open')
    assert.deepEqual(s.instructors, ['Doris, Marcia'])
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['T', 'R'])
    assert.equal(s.meetings[0].startTime, '13:00')
    assert.equal(s.meetings[0].endTime, '14:15')
  })

  it('marks section as closed when TTL SEATS AVAIL is 0', async () => {
    const csv = enrollmentCsv([{
      TERM: 'F24', SUBJ: 'COMP', COURSE: '182', SECTION: '2', CRN: '99999',
      TITLE: 'Full Section', CREDITS: '3', DEPARTMENT: 'CS',
      'SECT MAX': '25', 'SECT ENRL': '25', 'TTL ENRL': '25',
      'TTL SEATS AVAIL': '0', 'INSTRUCTOR NAME(S)': '',
    }])
    globalThis.fetch = async (url) => {
      if (url.includes('SWKSCAT')) return mockRes(scheduleHtml([]))
      if (url.includes('swkenrc.main') && url.includes('?')) return mockRes(csv)
      return mockRes(enrollFormHtml({ asFid: 'tok2' }))
    }
    const [s] = await rice.getSections({ termCode: 'F24', subjectCode: 'COMP' })
    assert.equal(s.status, 'closed')
  })

  it('leaves meetings empty when CRN not in schedule HTML', async () => {
    const csv = enrollmentCsv([{
      TERM: 'F24', SUBJ: 'COMP', COURSE: '100', SECTION: '1', CRN: '11111',
      TITLE: 'Async', CREDITS: '3', DEPARTMENT: 'CS',
      'SECT MAX': '50', 'SECT ENRL': '10', 'TTL ENRL': '10',
      'TTL SEATS AVAIL': '40', 'INSTRUCTOR NAME(S)': '',
    }])
    globalThis.fetch = async (url) => {
      if (url.includes('SWKSCAT')) return mockRes(scheduleHtml([])) // no meetings
      if (url.includes('swkenrc.main') && url.includes('?')) return mockRes(csv)
      return mockRes(enrollFormHtml({ asFid: 'tok3' }))
    }
    const [s] = await rice.getSections({ termCode: 'F24', subjectCode: 'COMP' })
    assert.deepEqual(s.meetings, [])
  })

  it('handles "N/A" in enrollment fields as null', async () => {
    const csv = enrollmentCsv([{
      TERM: 'F24', SUBJ: 'COMP', COURSE: '200', SECTION: '1', CRN: '22222',
      TITLE: 'Perm Only', CREDITS: '3', DEPARTMENT: 'CS',
      'SECT MAX': 'N/A', 'SECT ENRL': 'N/A', 'TTL ENRL': 'N/A',
      'TTL SEATS AVAIL': 'N/A', 'INSTRUCTOR NAME(S)': '',
    }])
    globalThis.fetch = async (url) => {
      if (url.includes('SWKSCAT')) return mockRes(scheduleHtml([]))
      if (url.includes('swkenrc.main') && url.includes('?')) return mockRes(csv)
      return mockRes(enrollFormHtml({ asFid: 'tok4' }))
    }
    const [s] = await rice.getSections({ termCode: 'F24', subjectCode: 'COMP' })
    assert.equal(s.enrollment.max, null)
    assert.equal(s.status, 'unknown')
  })

  it('splits multiple instructors separated by semicolon', async () => {
    const csv = enrollmentCsv([{
      TERM: 'F24', SUBJ: 'COMP', COURSE: '300', SECTION: '1', CRN: '33333',
      TITLE: 'Co-taught', CREDITS: '3', DEPARTMENT: 'CS',
      'SECT MAX': '30', 'SECT ENRL': '10', 'TTL ENRL': '10',
      'TTL SEATS AVAIL': '20', 'INSTRUCTOR NAME(S)': 'Smith, A; Jones, B',
    }])
    globalThis.fetch = async (url) => {
      if (url.includes('SWKSCAT')) return mockRes(scheduleHtml([]))
      if (url.includes('swkenrc.main') && url.includes('?')) return mockRes(csv)
      return mockRes(enrollFormHtml({ asFid: 'tok5' }))
    }
    const [s] = await rice.getSections({ termCode: 'F24', subjectCode: 'COMP' })
    assert.deepEqual(s.instructors, ['Smith, A', 'Jones, B'])
  })
})
