/**
 * Tests for tamu-scraper.js (Texas A&M Howdy portal JSON API).
 * TAMU fetches one large JSON payload per term; subjects and sections are
 * derived by filtering that cached payload.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as tamu from '../course-planner/tamu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [] },
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

function makeRow(overrides = {}) {
  return {
    SWV_CLASS_SEARCH_SUBJECT: 'ACCT',
    SWV_CLASS_SEARCH_SUBJECT_DESC: 'ACCT - Accounting',
    SWV_CLASS_SEARCH_COURSE: '201',
    SWV_CLASS_SEARCH_SECTION: '500',
    SWV_CLASS_SEARCH_CRN: '10001',
    SWV_CLASS_SEARCH_TITLE: 'Principles of Accounting',
    SWV_CLASS_SEARCH_SSBSECT_HOURS: '3',
    STUSEAT_OPEN: 'Y',
    SWV_CLASS_SEARCH_JSON_CLOB: JSON.stringify([
      { SSRMEET_MON_DAY: true, SSRMEET_WED_DAY: true, SSRMEET_FRI_DAY: true,
        SSRMEET_TUE_DAY: false, SSRMEET_THU_DAY: false, SSRMEET_SAT_DAY: false, SSRMEET_SUN_DAY: false,
        SSRMEET_BEGIN_TIME: '0930', SSRMEET_END_TIME: '1020',
        SSRMEET_BLDG_CODE: 'ACAD', SSRMEET_ROOM_CODE: '401' },
    ]),
    SWV_CLASS_SEARCH_INSTRCTR_JSON: JSON.stringify([
      { NAME: 'Smith, Jane (P)' },
    ]),
    ...overrides,
  }
}

// ── getTerms ──────────────────────────────────────────────────────────────────

describe('tamu.getTerms', () => {
  it('returns terms sorted newest-first', async () => {
    globalThis.fetch = async () => mockRes([
      { STVTERM_CODE: '202410', STVTERM_DESC: 'Fall 2024' },
      { STVTERM_CODE: '202510', STVTERM_DESC: 'Fall 2025' },
    ])
    const terms = await tamu.getTerms()
    assert.equal(terms.length, 2)
    assert.equal(terms[0].code, '202510')
    assert.equal(terms[0].label, 'Fall 2025')
    assert.equal(terms[1].code, '202410')
  })

  it('falls back to code when STVTERM_DESC is absent', async () => {
    globalThis.fetch = async () => mockRes([{ STVTERM_CODE: '202510' }])
    const [t] = await tamu.getTerms()
    assert.equal(t.label, '202510')
  })

  it('handles empty array', async () => {
    globalThis.fetch = async () => mockRes([])
    assert.deepEqual(await tamu.getTerms(), [])
  })
})

// ── getSubjects ───────────────────────────────────────────────────────────────

describe('tamu.getSubjects', () => {
  it('derives unique subjects from section data', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('all-terms')) return mockRes([{ STVTERM_CODE: '202510', STVTERM_DESC: 'Fall 2025' }])
      return mockRes([
        makeRow({ SWV_CLASS_SEARCH_SUBJECT: 'ACCT', SWV_CLASS_SEARCH_SUBJECT_DESC: 'ACCT - Accounting' }),
        makeRow({ SWV_CLASS_SEARCH_SUBJECT: 'BIOL', SWV_CLASS_SEARCH_SUBJECT_DESC: 'BIOL - Biology' }),
        makeRow({ SWV_CLASS_SEARCH_SUBJECT: 'ACCT', SWV_CLASS_SEARCH_SUBJECT_DESC: 'ACCT - Accounting' }),
      ])
    }
    const subjects = await tamu.getSubjects('202510')
    assert.equal(subjects.length, 2)
    // Should be sorted by code
    assert.equal(subjects[0].code, 'ACCT')
    assert.equal(subjects[0].label, 'Accounting')
    assert.equal(subjects[1].code, 'BIOL')
  })

  it('strips the "CODE - " prefix from subject description', async () => {
    globalThis.fetch = async () => mockRes([
      makeRow({ SWV_CLASS_SEARCH_SUBJECT: 'CS', SWV_CLASS_SEARCH_SUBJECT_DESC: 'CS - Computer Science' }),
    ])
    const [sub] = await tamu.getSubjects('202510')
    assert.equal(sub.label, 'Computer Science')
  })
})

// ── getSections ───────────────────────────────────────────────────────────────

describe('tamu.getSections', () => {
  it('returns sections filtered by subjectCode', async () => {
    globalThis.fetch = async () => mockRes([
      makeRow({ SWV_CLASS_SEARCH_SUBJECT: 'ACCT', SWV_CLASS_SEARCH_CRN: '10001' }),
      makeRow({ SWV_CLASS_SEARCH_SUBJECT: 'BIOL', SWV_CLASS_SEARCH_CRN: '20001' }),
    ])
    const sections = await tamu.getSections({ termCode: '202510', subjectCode: 'BIOL' })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].crn, '20001')
  })

  it('normalizes section shape correctly', async () => {
    globalThis.fetch = async () => mockRes([makeRow()])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.equal(sec.school, 'tamu')
    assert.equal(sec.crn, '10001')
    assert.equal(sec.subjectCode, 'ACCT')
    assert.equal(sec.courseNumber, '201')
    assert.equal(sec.sectionNumber, '500')
    assert.equal(sec.title, 'Principles of Accounting')
    assert.equal(sec.credits, 3)
    assert.equal(sec.status, 'open')
    // enrollment is always null for TAMU public search
    assert.equal(sec.enrollment.max, null)
    assert.equal(sec.enrollment.current, null)
    assert.equal(sec.enrollment.available, null)
  })

  it('maps STUSEAT_OPEN "N" to closed', async () => {
    globalThis.fetch = async () => mockRes([makeRow({ STUSEAT_OPEN: 'N' })])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.equal(sec.status, 'closed')
  })

  it('maps unknown STUSEAT_OPEN to "unknown"', async () => {
    globalThis.fetch = async () => mockRes([makeRow({ STUSEAT_OPEN: null })])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.equal(sec.status, 'unknown')
  })

  it('parses meeting days from CLOB', async () => {
    globalThis.fetch = async () => mockRes([makeRow()])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.equal(sec.meetings.length, 1)
    assert.deepEqual(sec.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(sec.meetings[0].startTime, '09:30')
    assert.equal(sec.meetings[0].endTime, '10:20')
    assert.equal(sec.meetings[0].location, 'ACAD 401')
  })

  it('handles invalid CLOB JSON gracefully (returns empty meetings)', async () => {
    globalThis.fetch = async () => mockRes([makeRow({ SWV_CLASS_SEARCH_JSON_CLOB: 'not-json' })])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.deepEqual(sec.meetings, [])
  })

  it('strips role suffix from instructor names', async () => {
    globalThis.fetch = async () => mockRes([makeRow()])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.deepEqual(sec.instructors, ['Smith, Jane'])
  })

  it('handles invalid instructor JSON gracefully (returns empty array)', async () => {
    globalThis.fetch = async () => mockRes([makeRow({ SWV_CLASS_SEARCH_INSTRCTR_JSON: '{invalid' })])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.deepEqual(sec.instructors, [])
  })

  it('uses SWV_CLASS_SEARCH_HOURS_LOW as fallback for credits', async () => {
    globalThis.fetch = async () => mockRes([makeRow({ SWV_CLASS_SEARCH_SSBSECT_HOURS: null, SWV_CLASS_SEARCH_HOURS_LOW: '4' })])
    const [sec] = await tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' })
    assert.equal(sec.credits, 4)
  })

  it('throws when API returns non-OK status', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, headers: { get: () => null, getSetCookie: () => [] }, json: async () => { throw new Error('503') } })
    await assert.rejects(() => tamu.getSections({ termCode: '202510', subjectCode: 'ACCT' }))
  })
})
