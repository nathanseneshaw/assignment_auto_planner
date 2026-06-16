/**
 * Tests for smu-scraper.js (SMU XLSX Quick Reference Schedule).
 * We test the term discovery (HTML scraping) and the normalize function
 * indirectly via getSections with a synthetic XLSX buffer.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as smu from '../course-planner/smu-scraper.js'
import * as XLSX from 'xlsx'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body, { binary = false } = {}) {
  const textBody = binary ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  const bufBody = binary ? body : Buffer.from(textBody)
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [] },
    text: async () => textBody,
    json: async () => JSON.parse(textBody),
    arrayBuffer: async () => bufBody.buffer.slice(bufBody.byteOffset, bufBody.byteOffset + bufBody.byteLength),
  }
}

// Build a synthetic SMU XLSX buffer with a header block above the real header
function buildXlsx(rows) {
  const data = [
    ['SMU Course Schedule'],      // title row (SMU always has these above the header)
    ['Exported on: 2026-01-01'],  // another non-data row
    // Actual header row that loadTerm searches for via "Class Nbr"
    ['Class Nbr', 'Subject', 'Catalog', 'Section', 'Descr', 'Credits', 'Pat', 'Mtg Start', 'Mtg End', 'School', 'Name'],
    ...rows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

function seasonPageHtml(xlsxUrl) {
  return `<html><body><a href="${xlsxUrl}">Schedule</a></body></html>`
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('smu.getTerms', () => {
  it('discovers terms from season pages containing a crslist XLSX href', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/fall')) return mockRes(seasonPageHtml('https://www.smu.edu/files/1267crslist_ug_gr.xlsx'))
      if (url.includes('/spring')) return mockRes(seasonPageHtml('https://www.smu.edu/files/1262crslist_ug_gr.xlsx'))
      if (url.includes('/summer')) return mockRes(seasonPageHtml('<no link>'))
      return mockRes('')
    }
    const terms = await smu.getTerms()
    // Fall 2026 (code 1267) and Spring 2026 (code 1262)
    assert.ok(terms.length >= 1)
    const fall = terms.find((t) => t.code === '1267')
    assert.ok(fall)
    assert.equal(fall.label, 'Fall 2026')
  })

  it('skips season pages with no matching XLSX href', async () => {
    globalThis.fetch = async () => mockRes('<html><body>No link here</body></html>')
    const terms = await smu.getTerms()
    assert.deepEqual(terms, [])
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('smu.getSections', () => {
  it('normalizes a row with a MWF meeting', async () => {
    const xlsxBuf = buildXlsx([
      ['10001', 'ACCT', '2301', '001', 'Principles of Accounting', '3', 'MWF', '9:00AM', '9:50AM', 'Cox School of Business', 'Smith, Dr.'],
    ])
    globalThis.fetch = async (url) => {
      if (url.includes('/fall')) return mockRes(seasonPageHtml('https://www.smu.edu/files/1267crslist_ug_gr.xlsx'))
      if (url.includes('/spring')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('/summer')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('1267crslist')) return mockRes(xlsxBuf, { binary: true })
      return mockRes('')
    }
    const sections = await smu.getSections({ termCode: '1267', subjectCode: 'ACCT' })
    assert.equal(sections.length, 1)
    const s = sections[0]
    assert.equal(s.school, 'smu')
    assert.equal(s.crn, '10001')
    assert.equal(s.subjectCode, 'ACCT')
    assert.equal(s.courseNumber, '2301')
    assert.equal(s.sectionNumber, '001')
    assert.equal(s.title, 'Principles of Accounting')
    assert.equal(s.credits, 3)
    assert.equal(s.status, 'unknown') // SMU never provides enrollment
    assert.equal(s.enrollment.max, null)
    assert.deepEqual(s.instructors, ['Smith, Dr.'])
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '09:00')
    assert.equal(s.meetings[0].endTime, '09:50')
  })

  it('filters sections by subjectCode case-insensitively', async () => {
    const xlsxBuf = buildXlsx([
      ['10001', 'ACCT', '2301', '001', 'Accounting', '3', 'MWF', '9:00AM', '9:50AM', '', ''],
      ['10002', 'BIOL', '1000', '001', 'Biology', '3', 'TR', '10:00AM', '11:15AM', '', ''],
    ])
    globalThis.fetch = async (url) => {
      if (url.includes('/fall')) return mockRes(seasonPageHtml('https://www.smu.edu/files/1267crslist_ug_gr.xlsx'))
      if (url.includes('/spring')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('/summer')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('1267crslist')) return mockRes(xlsxBuf, { binary: true })
      return mockRes('')
    }
    const sections = await smu.getSections({ termCode: '1267', subjectCode: 'BIOL' })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].crn, '10002')
  })

  it('omits meeting when days or times are absent (ARR/TBA rows)', async () => {
    const xlsxBuf = buildXlsx([
      ['10003', 'CSCI', '1000', '001', 'Online Course', '3', 'ARR', '', '', '', ''],
    ])
    globalThis.fetch = async (url) => {
      if (url.includes('/fall')) return mockRes(seasonPageHtml('https://www.smu.edu/files/1267crslist_ug_gr.xlsx'))
      if (url.includes('/spring')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('/summer')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('1267crslist')) return mockRes(xlsxBuf, { binary: true })
      return mockRes('')
    }
    const [s] = await smu.getSections({ termCode: '1267', subjectCode: 'CSCI' })
    assert.equal(s.meetings.length, 0)
  })

  it('throws for unknown term code', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/fall')) return mockRes(seasonPageHtml('https://www.smu.edu/files/1267crslist_ug_gr.xlsx'))
      if (url.includes('/spring')) return mockRes(seasonPageHtml('<no link>'))
      if (url.includes('/summer')) return mockRes(seasonPageHtml('<no link>'))
      return mockRes('')
    }
    await assert.rejects(
      () => smu.getSections({ termCode: '9999', subjectCode: 'ACCT' }),
      /Unknown SMU term/i
    )
  })
})
