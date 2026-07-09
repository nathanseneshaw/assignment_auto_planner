/**
 * Tests for iowa-scraper.js (University of Iowa — public MAUI JSON API).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as iowa from '../course-planner/iowa-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const SESSIONS = [
  { id: 1134, shortDescription: 'Fall 2026' },
  { id: 1147, shortDescription: 'Summer 2026' },
]

const SECTIONS = {
  error: false,
  payload: [
    {
      subjectCourse: 'CS:1020',
      sectionNumber: '0AAA',
      sectionId: 1067614,
      courseTitle: 'Principles of Computing',
      subTitle: null,
      status: 'Open',
      hours: 3,
      maxEnroll: '60',
      currentEnroll: 20,
      unlimitedEnroll: false,
      instructors: [{ name: 'Tasfia Mashiat' }, { name: 'STAFF' }],
      timeAndLocations: [
        {
          startTime: '1:30P', endTime: '2:20P',
          sun: false, mon: true, tue: false, wed: true, thu: false, fri: false, sat: false,
          room: '218', building: 'MLH', arrangedTime: false,
        },
        { startTime: null, endTime: null, arrangedTime: true },
      ],
    },
    {
      subjectCourse: 'CS:5990',
      sectionNumber: '0001',
      sectionId: 1067700,
      courseTitle: 'Individual Study',
      status: 'Closed',
      hours: null,
      maxEnroll: '5',
      currentEnroll: 5,
      unlimitedEnroll: true, // unlimited -> max null
      instructors: [],
      timeAndLocations: [],
    },
  ],
}

function dispatch(url) {
  const u = String(url)
  if (u.includes('/sessions/current')) {
    return { ok: true, status: 200, json: async () => ({ id: 1147 }) }
  }
  if (u.includes('/sessions/bounded')) {
    return { ok: true, status: 200, json: async () => SESSIONS }
  }
  if (u.includes('/lookups/registrar/coursesubjects')) {
    return {
      ok: true, status: 200,
      json: async () => [
        { naturalKey: 'CS', description: 'Computer Science' },
        { naturalKey: 'ACCT', description: 'Accounting' },
      ],
    }
  }
  if (u.includes('/registrar/sections?json=')) {
    return { ok: true, status: 200, json: async () => SECTIONS }
  }
  return { ok: false, status: 404, json: async () => ({}) }
}

describe('iowa.getTerms', () => {
  it('maps bounded sessions to term codes (session ids)', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    assert.deepEqual(await iowa.getTerms(), [
      { code: '1134', label: 'Fall 2026' },
      { code: '1147', label: 'Summer 2026' },
    ])
  })
})

describe('iowa.getSubjects', () => {
  it('maps + sorts subject lookups', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    assert.deepEqual(await iowa.getSubjects(), [
      { code: 'ACCT', label: 'Accounting' },
      { code: 'CS', label: 'Computer Science' },
    ])
  })
})

describe('iowa.getSections', () => {
  it('maps payload rows with seats, meetings and status', async () => {
    globalThis.fetch = async (url) => dispatch(url)
    const sections = await iowa.getSections({
      termCode: '1134', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'iowa')
    assert.equal(s0.courseNumber, '1020')
    assert.equal(s0.sectionNumber, '0AAA')
    assert.equal(s0.crn, '1067614')
    assert.equal(s0.credits, 3)
    assert.deepEqual(s0.instructors, ['Tasfia Mashiat']) // STAFF filtered
    assert.deepEqual(s0.enrollment, { max: 60, current: 20, available: 40 })
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.meetings, [
      { days: ['M', 'W'], startTime: '13:30', endTime: '14:20', location: 'MLH 218' },
    ])

    const s1 = sections[1]
    assert.equal(s1.status, 'closed')
    assert.deepEqual(s1.enrollment, { max: null, current: 5, available: null }) // unlimitedEnroll
    assert.deepEqual(s1.meetings, [])
  })

  it('returns [] when MAUI 404s an unpublished term', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/registrar/sections?json=')) {
        return { ok: false, status: 404, json: async () => ({}) }
      }
      return dispatch(url)
    }
    const sections = await iowa.getSections({
      termCode: '1135', subjectCode: 'CS', termLabel: 'Fall 2027', subjectLabel: 'CS',
    })
    assert.deepEqual(sections, [])
  })
})
