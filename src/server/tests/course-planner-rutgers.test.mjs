/**
 * Tests for rutgers-scraper.js (Rutgers-New Brunswick — SOC JSON blob).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as rutgers from '../course-planner/rutgers-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

const COURSES = [
  {
    subject: '198', subjectDescription: 'Computer Science', courseNumber: '111',
    title: 'INTRO COMPUTER SCI', expandedTitle: '  INTRODUCTION TO COMPUTER SCIENCE ',
    credits: 4,
    sections: [
      {
        number: '01', index: '10901', openStatus: true,
        instructors: [{ name: 'CHEN, LILY' }],
        meetingTimes: [
          {
            meetingDay: 'M', startTimeMilitary: '1035', endTimeMilitary: '1130',
            campusAbbrev: 'BUS', buildingCode: 'HLL', roomNumber: '114',
          },
          {
            meetingDay: 'H', startTimeMilitary: '1035', endTimeMilitary: '1130',
            campusAbbrev: 'BUS', buildingCode: 'HLL', roomNumber: '114',
          },
          { meetingDay: '', startTimeMilitary: '', endTimeMilitary: '' }, // async row
        ],
      },
      { number: '02', index: '10902', openStatus: false, instructors: [], meetingTimes: [] },
    ],
  },
  { subject: '640', subjectDescription: 'Mathematics', courseNumber: '151', title: 'CALC I', credits: 4, sections: [] },
]

describe('rutgers.getTerms', () => {
  it('synthesizes plausible Season YYYY terms with digit codes', async () => {
    const terms = await rutgers.getTerms()
    assert.equal(terms.length, 5)
    for (const t of terms) {
      assert.match(t.code, /^\d{4}:[0179]$/)
      assert.match(t.label, /^(Winter|Spring|Summer|Fall) \d{4}$/)
    }
    // codes and labels agree on the year
    for (const t of terms) {
      assert.ok(t.label.endsWith(t.code.split(':')[0]))
    }
  })
})

describe('rutgers.getSubjects', () => {
  it('derives the sorted subject list from the term blob', async () => {
    globalThis.fetch = async () => mockJson(COURSES)
    assert.deepEqual(await rutgers.getSubjects('2026:9'), [
      { code: '198', label: 'Computer Science' },
      { code: '640', label: 'Mathematics' },
    ])
  })

  it('rejects malformed term codes without fetching', async () => {
    globalThis.fetch = async () => { throw new Error('should not fetch') }
    await assert.rejects(() => rutgers.getSubjects('banana'), /Bad Rutgers term code/)
  })
})

describe('rutgers.getSections', () => {
  it('filters by subject and normalizes sections', async () => {
    globalThis.fetch = async () => mockJson(COURSES)
    const sections = await rutgers.getSections({
      termCode: '2026:9', subjectCode: '198', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'rutgers')
    assert.equal(s0.crn, '10901') // Rutgers registration index
    assert.equal(s0.courseNumber, '111')
    assert.equal(s0.title, 'INTRODUCTION TO COMPUTER SCIENCE') // expandedTitle trimmed
    assert.equal(s0.credits, 4)
    assert.equal(s0.status, 'open')
    assert.deepEqual(s0.instructors, ['CHEN, LILY'])
    assert.deepEqual(s0.enrollment, { max: null, current: null, available: null })
    // Monday + Thursday (H) rows at the same time merge into one meeting
    assert.equal(s0.meetings.length, 1)
    assert.deepEqual(s0.meetings[0].days, ['M', 'R'])
    assert.equal(s0.meetings[0].startTime, '10:35')
    assert.equal(s0.meetings[0].endTime, '11:30')
    assert.equal(s0.meetings[0].location, 'BUS HLL 114')

    assert.equal(sections[1].status, 'closed')
  })
})
