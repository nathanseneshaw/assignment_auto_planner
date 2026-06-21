/**
 * Tests for mit-scraper.js (MIT — Hydrant latest.json catalog).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as mit from '../course-planner/mit-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockCatalog(catalog) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => catalog,
    text: async () => JSON.stringify(catalog),
  })
}

const CATALOG = {
  termInfo: { urlName: 'f26' },
  classes: {
    '6.1010': {
      number: '6.1010', course: '6', name: 'Fundamentals of Programming',
      inCharge: 'A. Bell, J. Smith', level: 'U',
      lectureUnits: 5, labUnits: 2, preparationUnits: 5, isVariableUnits: false,
      lectureRawSections: ['26-100/MWF/0/1-2.30'],
      recitationRawSections: ['34-301/T/0/10-11'],
      labRawSections: [], designRawSections: [],
    },
    '6.UAT': {
      number: '6.UAT', course: '6', name: 'Oral Communication',
      inCharge: 'Staff', isVariableUnits: true, lectureUnits: 0, labUnits: 0, preparationUnits: 0,
      lectureRawSections: ['TBA'], recitationRawSections: [], labRawSections: [], designRawSections: [],
    },
    '18.01': {
      number: '18.01', course: '18', name: 'Calculus I',
      inCharge: 'D. Jerison', lectureUnits: 5, labUnits: 0, preparationUnits: 7, isVariableUnits: false,
      lectureRawSections: ['54-100/MTWRF/1/7-9'], recitationRawSections: [], labRawSections: [], designRawSections: [],
    },
  },
}

describe('mit.getTerms', () => {
  it('parses the single Hydrant term from urlName', async () => {
    mockCatalog(CATALOG)
    assert.deepEqual(await mit.getTerms(), [{ code: 'f26', label: 'Fall 2026' }])
  })
})

describe('mit.getSubjects', () => {
  it('lists distinct department numbers with names, numerically sorted', async () => {
    mockCatalog(CATALOG)
    const subjects = await mit.getSubjects()
    assert.deepEqual(subjects, [
      { code: '6', label: 'Electrical Engineering and Computer Science' },
      { code: '18', label: 'Mathematics' },
    ])
  })
})

describe('mit.getSections', () => {
  it('maps a class, merges lecture+recitation meetings, decodes PM times', async () => {
    mockCatalog(CATALOG)
    const sections = await mit.getSections({ termCode: 'f26', subjectCode: '6' })
    const s = sections.find((x) => x.crn === '6.1010')
    assert.equal(s.school, 'mit')
    assert.equal(s.courseNumber, '1010') // dept "6." stripped; crn keeps full "6.1010"
    assert.equal(s.title, 'Fundamentals of Programming')
    assert.equal(s.credits, 12) // 5 + 2 + 5
    assert.deepEqual(s.instructors, ['A. Bell', 'J. Smith'])
    assert.equal(s.status, 'unknown')
    assert.deepEqual(s.enrollment, { max: null, current: null, available: null })
    assert.equal(s.meetings.length, 2)
    // "1-2.30" with no evening flag -> 1:00 PM to 2:30 PM
    const lec = s.meetings[0]
    assert.deepEqual(lec.days, ['M', 'W', 'F'])
    assert.equal(lec.startTime, '13:00')
    assert.equal(lec.endTime, '14:30')
    assert.equal(lec.location, '26-100')
    // recitation "10-11" -> 10:00 AM to 11:00 AM (8–12 o'clock stay morning)
    const rec = s.meetings[1]
    assert.deepEqual(rec.days, ['T'])
    assert.equal(rec.startTime, '10:00')
    assert.equal(rec.endTime, '11:00')
  })

  it('honors the evening flag (7-9 -> 19:00-21:00)', async () => {
    mockCatalog(CATALOG)
    const [s] = await mit.getSections({ termCode: 'f26', subjectCode: '18' })
    assert.deepEqual(s.meetings[0].days, ['M', 'T', 'W', 'R', 'F'])
    assert.equal(s.meetings[0].startTime, '19:00')
    assert.equal(s.meetings[0].endTime, '21:00')
  })

  it('reports variable-units classes as null credits and skips TBA meetings', async () => {
    mockCatalog(CATALOG)
    const sections = await mit.getSections({ termCode: 'f26', subjectCode: '6' })
    const uat = sections.find((x) => x.crn === '6.UAT')
    assert.equal(uat.credits, null)
    assert.deepEqual(uat.meetings, [])
    assert.deepEqual(uat.instructors, []) // "Staff" filtered out
  })
})
