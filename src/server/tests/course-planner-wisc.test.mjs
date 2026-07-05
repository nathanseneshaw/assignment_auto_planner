/**
 * Tests for wisc-scraper.js (UW-Madison — public.enroll search + enrollmentPackages).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as wisc from '../course-planner/wisc-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

describe('wisc.getTerms', () => {
  it('maps the terms endpoint', async () => {
    globalThis.fetch = async () => mockJson([
      { termCode: '1272', longDescription: 'Fall 2026' },
      { termCode: '1266', longDescription: 'Summer 2026' },
    ])
    assert.deepEqual(await wisc.getTerms(), [
      { code: '1272', label: 'Fall 2026' },
      { code: '1266', label: 'Summer 2026' },
    ])
  })
})

describe('wisc.getSubjects', () => {
  it('maps subjectsMap entries sorted by label', async () => {
    globalThis.fetch = async () => mockJson({ 266: 'COMP SCI', 600: 'MATH', 132: 'AGRONOMY' })
    assert.deepEqual(await wisc.getSubjects('1272'), [
      { code: '132', label: 'AGRONOMY' },
      { code: '266', label: 'COMP SCI' },
      { code: '600', label: 'MATH' },
    ])
  })
})

describe('wisc.getSections', () => {
  const HIT = {
    courseId: '026013', catalogNumber: '300', title: 'Programming II',
    creditRange: '3', subject: { subjectCode: '266', shortDescription: 'COMP SCI' },
  }
  // 9:30-10:45 as milliseconds from midnight
  const PKG = {
    enrollmentClassNumber: 22280,
    published: true,
    packageEnrollmentStatus: { availableSeats: 12, status: 'OPEN' },
    enrollmentStatus: {
      capacity: 0, currentlyEnrolled: 0, openSeats: 0,
      aggregateCapacity: 40, aggregateCurrentlyEnrolled: 28,
    },
    sections: [{
      type: 'LEC', sectionNumber: '001',
      instructor: { name: { first: 'Ada', last: 'Lovelace' } },
      classMeetings: [
        {
          meetingType: 'CLASS',
          meetingTimeStart: 34200000, meetingTimeEnd: 38700000,
          meetingDaysList: ['TUESDAY', 'THURSDAY'],
          building: { buildingName: 'DeLuca Biochemistry' }, room: '1125',
        },
        { meetingType: 'EXAM', meetingTimeStart: 0, meetingTimeEnd: 0, meetingDaysList: [] },
      ],
    }],
  }

  it('joins search hits with enrollment packages, aggregates and ms times', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url)
      if (u.includes('/enrollmentPackages/')) return mockJson([PKG, { ...PKG, published: false }])
      // the search POST
      assert.equal(opts.method, 'POST')
      const body = JSON.parse(opts.body)
      assert.equal(body.filters[0].term['subject.subjectCode'], '266')
      return mockJson({ found: 1, hits: [HIT] })
    }
    const sections = await wisc.getSections({
      termCode: '1272', subjectCode: '266', termLabel: 'Fall 2026', subjectLabel: 'COMP SCI',
    })
    assert.equal(sections.length, 1) // unpublished package dropped

    const s = sections[0]
    assert.equal(s.school, 'wisc')
    assert.equal(s.crn, '22280')
    assert.equal(s.courseNumber, '300')
    assert.equal(s.sectionNumber, 'LEC 001')
    assert.equal(s.credits, 3)
    assert.equal(s.status, 'open')
    assert.deepEqual(s.instructors, ['Ada Lovelace'])
    // plain capacity is 0 -> aggregate* fields kick in; available from packageEnrollmentStatus
    assert.deepEqual(s.enrollment, { max: 40, current: 28, available: 12 })
    assert.equal(s.meetings.length, 1) // EXAM row dropped
    assert.deepEqual(s.meetings[0].days, ['T', 'R'])
    assert.equal(s.meetings[0].startTime, '09:30')
    assert.equal(s.meetings[0].endTime, '10:45')
    assert.equal(s.meetings[0].location, 'DeLuca Biochemistry 1125')
  })

  it('maps WAITLISTED packages to closed', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/enrollmentPackages/')) {
        return mockJson([{ ...PKG, packageEnrollmentStatus: { availableSeats: 0, status: 'WAITLISTED' } }])
      }
      return mockJson({ found: 1, hits: [HIT] })
    }
    const [s] = await wisc.getSections({ termCode: '1272', subjectCode: '266' })
    assert.equal(s.status, 'closed')
  })
})
