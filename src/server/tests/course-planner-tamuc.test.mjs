/**
 * Tests for tamuc-scraper.js (East Texas A&M University).
 * TAMUC uses a public ASP.NET page with day-name tokens like "Mon, Thurs".
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as tamuc from '../course-planner/tamuc-scraper.js'

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

// ── HTML fixtures ─────────────────────────────────────────────────────────────

function termsHtml(terms = []) {
  const opts = terms.map(({ code, label }) => `<option value="${code}">${label}</option>`).join('')
  return `<html><body><select name="ctl00$ContentPlaceHolder1$ddlterm">${opts}</select></body></html>`
}

function subjectTreeHtml(deptCodes = ['CSCI']) {
  const links = deptCodes.map((c) => `<a href="?WO=M&Term=202510&Loc=MAIN&Dept=${c}">...</a>`).join('')
  return `<html><body>${links}</body></html>`
}

function subjectNavHtml(subjects = []) {
  const items = subjects.map(({ code, label }) =>
    `<span class="navSubj"><a class="nav" href="?Dept=${code}"><span>${label}</span></a></span>`
  ).join('')
  return `<html><body>${items}</body></html>`
}

function sectionsHtml(rows = []) {
  const courseRows = rows.map(({ subj, num, title, sec, crn, instructor, max, current, hours, meetingLine }) => `
    <tr class="StandardRowOdd">
      <td>${subj}</td><td>${num}</td><td>${title}</td>
    </tr>
    <tr class="StandardSubHeader">
      <td>${sec}</td><td>${crn}</td>
      <td>${instructor || 'Staff'}<div class="hours">${hours !== undefined ? 'Hours: ' + hours : ''}</div></td>
      <td>${max !== undefined ? max : 30}</td><td>${current !== undefined ? current : 20}</td>
    </tr>
    <tr>
      <td><span class="cInfoLinks">${meetingLine || ''}</span></td>
    </tr>
  `).join('')
  return `<html><body><div class="CourseTable"><table>${courseRows}</table></div></body></html>`
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('tamuc.getTerms', () => {
  it('parses term codes from ddlterm select', async () => {
    globalThis.fetch = async () => mockRes(termsHtml([
      { code: '202510', label: 'Fall 2025' },
      { code: '202520', label: 'Spring 2026' },
    ]))
    const terms = await tamuc.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, '202510')
    assert.equal(terms[0].label, 'Fall 2025')
  })

  it('returns empty list when no options', async () => {
    globalThis.fetch = async () => mockRes(termsHtml([]))
    assert.deepEqual(await tamuc.getTerms(), [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('tamuc.getSubjects', () => {
  it('picks the largest subject list from candidate dept pages', async () => {
    let call = 0
    globalThis.fetch = async (url) => {
      call++
      // First call: tree page with dept links
      if (call === 1) return mockRes(subjectTreeHtml(['CSCI', 'ENGL']))
      // Subsequent calls: dept-scoped pages with navSubj
      return mockRes(subjectNavHtml([
        { code: 'CSCI', label: 'Computer Science' },
        { code: 'ENGL', label: 'English' },
      ]))
    }
    const subjects = await tamuc.getSubjects('202510')
    assert.ok(subjects.length >= 1)
    assert.ok(subjects.every((s) => s.code && s.label))
  })

  it('returns empty when tree has no dept links', async () => {
    globalThis.fetch = async () => mockRes('<html><body>no links</body></html>')
    const subjects = await tamuc.getSubjects('202510')
    assert.deepEqual(subjects, [])
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('tamuc.getSections', () => {
  it('parses a section with Tue/Thurs meeting', async () => {
    const html = sectionsHtml([{
      subj: 'CSCI', num: '1100', title: 'Intro to Computing',
      sec: '01', crn: '10001', instructor: 'Dr. Brown', max: 30, current: 15, hours: 3,
      meetingLine: 'Tue, Thurs 9:30a-10:45a    Campus: Main    Building: JOUR    Room: 102',
    }])
    globalThis.fetch = async () => mockRes(html)
    const sections = await tamuc.getSections({ termCode: '202510', subjectCode: 'CSCI' })
    assert.equal(sections.length, 1)
    const s = sections[0]
    assert.equal(s.school, 'tamuc')
    assert.equal(s.crn, '10001')
    assert.equal(s.subjectCode, 'CSCI')
    assert.equal(s.courseNumber, '1100')
    assert.equal(s.title, 'Intro to Computing')
    assert.equal(s.credits, 3)
    assert.equal(s.enrollment.max, 30)
    assert.equal(s.enrollment.current, 15)
    assert.equal(s.enrollment.available, 15)
    assert.equal(s.status, 'open')
    assert.deepEqual(s.instructors, ['Dr. Brown'])
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['T', 'R'])
    assert.equal(s.meetings[0].startTime, '09:30')
    assert.equal(s.meetings[0].endTime, '10:45')
    assert.equal(s.meetings[0].location, 'JOUR 102')
  })

  it('marks section closed when current >= max', async () => {
    const html = sectionsHtml([{
      subj: 'CSCI', num: '1100', title: 'Full', sec: '02', crn: '10002',
      max: 20, current: 20, hours: 3,
      meetingLine: 'Mon 8:00a-9:00a',
    }])
    globalThis.fetch = async () => mockRes(html)
    const [s] = await tamuc.getSections({ termCode: '202510', subjectCode: 'CSCI' })
    assert.equal(s.status, 'closed')
  })

  it('skips Web Based meeting lines', async () => {
    const html = sectionsHtml([{
      subj: 'CSCI', num: '1100', title: 'Online', sec: '03', crn: '10003',
      max: 30, current: 5, hours: 3,
      meetingLine: 'Web Based',
    }])
    globalThis.fetch = async () => mockRes(html)
    const [s] = await tamuc.getSections({ termCode: '202510', subjectCode: 'CSCI' })
    assert.equal(s.meetings.length, 0)
  })

  it('parses Mon/Wed/Fri days correctly', async () => {
    const html = sectionsHtml([{
      subj: 'CSCI', num: '2000', title: 'DS', sec: '01', crn: '20001',
      max: 25, current: 10, hours: 3,
      meetingLine: 'Mon, Wed, Fri 1:00p-1:50p    Building: NURS    Room: 200',
    }])
    globalThis.fetch = async () => mockRes(html)
    const [s] = await tamuc.getSections({ termCode: '202510', subjectCode: 'CSCI' })
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '13:00')
    assert.equal(s.meetings[0].endTime, '13:50')
  })

  it('returns empty for page with no CourseTable rows', async () => {
    globalThis.fetch = async () => mockRes('<html><body><div class="CourseTable"><table></table></div></body></html>')
    assert.deepEqual(await tamuc.getSections({ termCode: '202510', subjectCode: 'CSCI' }), [])
  })
})
