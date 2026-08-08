/**
 * Tests for odu-scraper.js (Old Dominion University).
 *
 * ODU's public Course Search is a set of key-free PHP JSON services. These
 * tests stub fetch so they exercise the parse logic against representative
 * payloads captured from the live feed, not the live host.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as odu from '../course-planner/odu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function jsonRes(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => text, json: async () => JSON.parse(text) }
}

const TERMS = [
  { TERM_CODE: '202610', TERM_DESC: 'Fall 2026', TERM_DISP: 'Fall 2026 - Session 11' },
  { TERM_CODE: '202616', TERM_DESC: 'Fall 2026 First Eight Weeks', TERM_DISP: 'x' },
  { TERM_CODE: '202530', TERM_DESC: 'Summer 2026', TERM_DISP: 'x' },
]
const SUBJECTS = [
  { SUBJ_CODE: 'CS', SUBJ_DESC: 'Computer Science' },
  { SUBJ_CODE: 'ACCT', SUBJ_DESC: 'Accounting' },
]
const COURSES = [
  {
    TERM: '202610', TERM_DESC: 'Fall 2026', CRN: '10172', SUBJ_CODE: 'CS', CRSE_NUM: '390',
    TITLE: 'Introduction to Theoretical Computer Science', INSTRUCTOR: 'Ranjan, Desh',
    DELIVERY: 'In-Class Meetings', DAYS: 'MWF', TIMES: '03:00 PM - 03:50 PM',
    ENROLL: '37 of 45', ROOM_NUM: '2111', BUILDING_NAME: 'Monarch Hall',
  },
  {
    TERM: '202610', TERM_DESC: 'Fall 2026', CRN: '10161', SUBJ_CODE: 'CS', CRSE_NUM: '899',
    TITLE: 'Doctoral Dissertation', INSTRUCTOR: 'Wu, Jian',
    DELIVERY: 'Online Without Scheduled Meeting Times', DAYS: null, TIMES: ' - ',
    ENROLL: '4 of 5', ROOM_NUM: null, BUILDING_NAME: null,
  },
]

describe('odu getTerms', () => {
  it('maps TERM_CODE/TERM_DESC', async () => {
    globalThis.fetch = async () => jsonRes(TERMS)
    const terms = await odu.getTerms()
    assert.equal(terms.length, 3)
    assert.deepEqual(terms[0], { code: '202610', label: 'Fall 2026' })
  })
})

describe('odu getSubjects', () => {
  it('maps + sorts by code', async () => {
    globalThis.fetch = async () => jsonRes(SUBJECTS)
    const subs = await odu.getSubjects('202610')
    assert.equal(subs[0].code, 'ACCT')
    assert.equal(subs[1].code, 'CS')
    assert.equal(subs[1].label, 'Computer Science')
  })
})

describe('odu getSections', () => {
  it('parses a scheduled section with full enrollment + meeting', async () => {
    globalThis.fetch = async () => jsonRes(COURSES)
    const secs = await odu.getSections({ termCode: '202610', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science' })
    assert.equal(secs.length, 2)
    const s = secs[0]
    assert.equal(s.school, 'odu')
    assert.equal(s.crn, '10172')
    assert.equal(s.courseNumber, '390')
    assert.equal(s.sectionNumber, '') // ODU feed has no section number
    assert.equal(s.title, 'Introduction to Theoretical Computer Science')
    assert.deepEqual(s.instructors, ['Ranjan, Desh'])
    assert.equal(s.credits, null)
    assert.deepEqual(s.enrollment, { max: 45, current: 37, available: 8 })
    assert.equal(s.status, 'open')
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '15:00')
    assert.equal(s.meetings[0].endTime, '15:50')
    assert.equal(s.meetings[0].location, 'Monarch Hall 2111')
  })

  it('online/research rows carry seats but no meeting', async () => {
    globalThis.fetch = async () => jsonRes(COURSES)
    const secs = await odu.getSections({ termCode: '202610', subjectCode: 'CS' })
    const diss = secs.find((s) => s.crn === '10161')
    assert.deepEqual(diss.meetings, [])
    assert.deepEqual(diss.enrollment, { max: 5, current: 4, available: 1 })
    assert.equal(diss.status, 'open')
  })

  it('a full section reports closed', async () => {
    globalThis.fetch = async () => jsonRes([{ ...COURSES[0], ENROLL: '45 of 45' }])
    const [s] = await odu.getSections({ termCode: '202610', subjectCode: 'CS' })
    assert.deepEqual(s.enrollment, { max: 45, current: 45, available: 0 })
    assert.equal(s.status, 'closed')
  })

  it('unparseable enrollment -> nulls + unknown', async () => {
    globalThis.fetch = async () => jsonRes([{ ...COURSES[0], ENROLL: 'TBD' }])
    const [s] = await odu.getSections({ termCode: '202610', subjectCode: 'CS' })
    assert.deepEqual(s.enrollment, { max: null, current: null, available: null })
    assert.equal(s.status, 'unknown')
  })
})
