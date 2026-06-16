/**
 * Tests for banner-classic.js factory (createBannerClassicScraper).
 * This factory powers UTSA, UTEP, St. Mary's, and Lamar via HTML scraping.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import { createBannerClassicScraper } from '../course-planner/banner-classic.js'

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

// HTML fixtures ────────────────────────────────────────────────────────────────

const TERMS_HTML = `
<html><body>
  <select name="p_term">
    <option value="">-- Select --</option>
    <option value="202510">Fall 2025</option>
    <option value="202520">Spring 2026</option>
    <option value="abc">Bad code (not 5-6 digits)</option>
  </select>
</body></html>
`

const SUBJECTS_HTML = `
<html><body>
  <select name="sel_subj">
    <option value="%">All</option>
    <option value="dummy">dummy</option>
    <option value="ACC">Accounting (ACC)</option>
    <option value="BIOL">Biology (BIOL)</option>
  </select>
</body></html>
`

// Minimal "Class Schedule Listing" HTML that parseListing can parse
function buildListingHTML(sections = []) {
  const rows = sections.map(({ title, crn, subj, num, sec, time, days, room, instructor, credits }) => `
    <table class="datadisplaytable">
      <tr><th class="ddtitle"><a>${title} - ${crn} - ${subj} ${num} - ${sec}</a></th></tr>
      <tr><td class="dddefault">
        ${credits !== undefined ? credits + ' Credits' : ''}
        <table class="datadisplaytable">
          <tr>
            <th class="ddheader">Type</th><th>Time</th><th>Days</th>
            <th>Where</th><th>Date</th><th>Sched</th><th>Instructors</th>
          </tr>
          <tr>
            <td class="dddefault">Lecture</td>
            <td class="dddefault">${time || 'TBA'}</td>
            <td class="dddefault">${days || ''}</td>
            <td class="dddefault">${room || 'TBA'}</td>
            <td class="dddefault">08/25 - 12/12</td>
            <td class="dddefault">A</td>
            <td class="dddefault">${instructor || 'Staff'}</td>
          </tr>
        </table>
      </td></tr>
    </table>
  `).join('')
  return `<html><body>${rows}</body></html>`
}

// ── Factory setup ─────────────────────────────────────────────────────────────

function makeScraper(id = 'test') {
  return createBannerClassicScraper({
    school: `classic-${id}`,
    base: `https://${id}.edu`,
    prefix: '/prod',
  })
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('banner-classic getTerms', () => {
  it('parses term codes from <select name="p_term">', async () => {
    const s = makeScraper('terms1')
    globalThis.fetch = async () => mockRes(TERMS_HTML)
    const terms = await s.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, '202510')
    assert.equal(terms[0].label, 'Fall 2025')
    assert.equal(terms[1].code, '202520')
  })

  it('filters out non-numeric term codes', async () => {
    const s = makeScraper('terms2')
    globalThis.fetch = async () => mockRes(TERMS_HTML)
    const terms = await s.getTerms()
    // "abc" should be excluded
    assert.ok(!terms.some((t) => t.code === 'abc'))
  })

  it('returns empty list when no valid option values', async () => {
    const s = makeScraper('terms3')
    globalThis.fetch = async () => mockRes('<html><body><select name="p_term"></select></body></html>')
    const terms = await s.getTerms()
    assert.deepEqual(terms, [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('banner-classic getSubjects', () => {
  it('parses subjects and strips "(CODE)" suffix from label', async () => {
    const s = makeScraper('subj1')
    globalThis.fetch = async (url) => {
      if (url.includes('bwckschd.p_disp_dyn_sched')) return mockRes(TERMS_HTML)
      if (url.includes('bwckgens.p_proc_term_date')) return mockRes(SUBJECTS_HTML)
      return mockRes('')
    }
    const subjects = await s.getSubjects('202510')
    assert.equal(subjects.length, 2)
    assert.equal(subjects[0].code, 'ACC')
    assert.equal(subjects[0].label, 'Accounting')
    assert.equal(subjects[1].code, 'BIOL')
    assert.equal(subjects[1].label, 'Biology')
  })

  it('excludes dummy and % options', async () => {
    const s = makeScraper('subj2')
    globalThis.fetch = async (url) => {
      if (url.includes('bwckschd')) return mockRes(TERMS_HTML)
      return mockRes(SUBJECTS_HTML)
    }
    const subjects = await s.getSubjects('202510')
    assert.ok(!subjects.some((s) => s.code === '%' || s.code === 'dummy'))
  })

  it('sorts subjects by code', async () => {
    const html = `<html><body><select name="sel_subj">
      <option value="ZOOL">Zoology</option>
      <option value="ACC">Accounting</option>
    </select></body></html>`
    const s = makeScraper('subj3')
    globalThis.fetch = async (url) => {
      if (url.includes('bwckschd')) return mockRes(TERMS_HTML)
      return mockRes(html)
    }
    const subjects = await s.getSubjects('202510')
    assert.equal(subjects[0].code, 'ACC')
    assert.equal(subjects[1].code, 'ZOOL')
  })
})

// ── getSections / parseListing ────────────────────────────────────────────────

describe('banner-classic getSections', () => {
  it('parses a section with meeting time', async () => {
    const html = buildListingHTML([{
      title: 'Intro to Accounting', crn: '13215', subj: 'ACC', num: '2013', sec: '002',
      time: '9:00 am - 9:50 am', days: 'MWF', room: 'BUS 201',
      instructor: 'Smith, John', credits: '3',
    }])
    const s = makeScraper('sec1')
    globalThis.fetch = async () => mockRes(html)
    const sections = await s.getSections({ termCode: '202510', subjectCode: 'ACC', termLabel: 'Fall 2025', subjectLabel: 'Accounting' })
    assert.equal(sections.length, 1)
    const sec = sections[0]
    assert.equal(sec.school, 'classic-sec1')
    assert.equal(sec.crn, '13215')
    assert.equal(sec.title, 'Intro to Accounting')
    assert.equal(sec.subjectCode, 'ACC')
    assert.equal(sec.courseNumber, '2013')
    assert.equal(sec.sectionNumber, '002')
    assert.equal(sec.credits, 3)
    assert.equal(sec.meetings.length, 1)
    assert.deepEqual(sec.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(sec.meetings[0].startTime, '09:00')
    assert.equal(sec.meetings[0].endTime, '09:50')
    assert.equal(sec.meetings[0].location, 'BUS 201')
  })

  it('omits TBA meetings', async () => {
    const html = buildListingHTML([{
      title: 'Online Course', crn: '99999', subj: 'CS', num: '1000', sec: '001',
      time: 'TBA', days: '', room: 'TBA', instructor: 'Staff', credits: '3',
    }])
    const s = makeScraper('sec2')
    globalThis.fetch = async () => mockRes(html)
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.equal(sec.meetings.length, 0)
  })

  it('returns empty for HTML with no ddtitle headers', async () => {
    const s = makeScraper('sec3')
    globalThis.fetch = async () => mockRes('<html><body><p>No results</p></body></html>')
    const sections = await s.getSections({ termCode: '202510', subjectCode: 'CS' })
    assert.deepEqual(sections, [])
  })

  it('enrollment is always null (Banner Classic hides it)', async () => {
    const html = buildListingHTML([{
      title: 'Math 101', crn: '11111', subj: 'MATH', num: '1000', sec: '001',
      time: '10:00 am - 10:50 am', days: 'TR', room: 'MATH 100', credits: '3',
    }])
    const s = makeScraper('sec4')
    globalThis.fetch = async () => mockRes(html)
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'MATH' })
    assert.equal(sec.enrollment.max, null)
    assert.equal(sec.enrollment.current, null)
    assert.equal(sec.enrollment.available, null)
    assert.equal(sec.status, 'unknown')
  })

  it('deduplicates instructor names across meeting rows', async () => {
    // Two meeting rows for the same section with the same instructor
    const html = `<html><body>
      <table class="datadisplaytable">
        <tr><th class="ddtitle"><a>Course - 55555 - PHYS 1000 - 001</a></th></tr>
        <tr><td class="dddefault">3 Credits
          <table class="datadisplaytable">
            <tr><th class="ddheader">T</th><th>Time</th><th>Days</th><th>Where</th><th>D</th><th>S</th><th>Instructors</th></tr>
            <tr>
              <td class="dddefault">Lec</td><td class="dddefault">9:00 am - 9:50 am</td>
              <td class="dddefault">MWF</td><td class="dddefault">PHYS 100</td>
              <td class="dddefault">-</td><td class="dddefault">A</td>
              <td class="dddefault">Dr. Einstein</td>
            </tr>
            <tr>
              <td class="dddefault">Lab</td><td class="dddefault">TBA</td>
              <td class="dddefault"></td><td class="dddefault">TBA</td>
              <td class="dddefault">-</td><td class="dddefault">A</td>
              <td class="dddefault">Dr. Einstein</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body></html>`
    const s = makeScraper('sec5')
    globalThis.fetch = async () => mockRes(html)
    const [sec] = await s.getSections({ termCode: '202510', subjectCode: 'PHYS' })
    // Instructor should appear only once even though two meeting rows have the same name
    assert.deepEqual(sec.instructors, ['Dr. Einstein'])
  })
})
