/**
 * Tests for osu-scraper.js (Ohio State — content.osu.edu public JSON API).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as osu from '../course-planner/osu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

function courseWrapper({ subject = 'CSE', catalog = '1222', section = '0072', classNumber = '8816',
  status = 'Open', total = 12, title = 'Programming C++', maxUnits = 3 } = {}) {
  return {
    course: { subject, catalogNumber: catalog, title, maxUnits, minUnits: maxUnits },
    sections: [{
      classNumber, section, catalogNumber: catalog,
      enrollmentStatus: status, enrollmentTotal: total,
      subjectDesc: 'Computer Science & Engineering',
      meetings: [{
        monday: true, tuesday: false, wednesday: true, thursday: false,
        friday: false, saturday: false, sunday: false,
        startTime: '11:30 am', endTime: '12:25 pm',
        buildingDescription: 'Caldwell Lab 112',
        instructors: [{ displayName: 'Jane Doe' }, { displayName: null }],
      }],
    }],
  }
}

describe('osu.getTerms', () => {
  it('reads the term facet of an unfiltered search', async () => {
    globalThis.fetch = async () => mockJson({
      data: {
        filters: [{ slug: 'term', items: [
          { title: 'Autumn 2026', term: '1268' },
          { title: 'Summer 2026', term: '1264' },
        ] }],
      },
    })
    assert.deepEqual(await osu.getTerms(), [
      { code: '1268', label: 'Autumn 2026' },
      { code: '1264', label: 'Summer 2026' },
    ])
  })
})

describe('osu.getSubjects', () => {
  it('sweeps career-partitioned pages and dedupes lowercase subject codes', async () => {
    const swept = []
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (!u.includes('academic-career=')) {
        // term-scoped facet call
        return mockJson({
          data: {
            filters: [{ slug: 'academic-career', items: [
              { term: 'ugrd', count: 250 }, // 2 pages
              { term: 'law', count: 10 },   // 1 page
            ] }],
          },
        })
      }
      swept.push(u)
      const career = new URL(u).searchParams.get('academic-career')
      const page = new URL(u).searchParams.get('p')
      const courses =
        career === 'ugrd' && page === '1'
          ? [courseWrapper({ subject: 'CSE' }), courseWrapper({ subject: 'MATH' })]
          : career === 'ugrd'
            ? [courseWrapper({ subject: 'MATH' })] // duplicate across pages
            : [courseWrapper({ subject: 'LAW' })]
      return mockJson({ data: { courses } })
    }
    const subjects = await osu.getSubjects('1268')
    assert.equal(swept.length, 3) // ugrd p1+p2, law p1
    assert.deepEqual(
      subjects.map((s) => s.code).sort(),
      ['cse', 'law', 'math']
    )
    // label comes from the section's long subject description
    assert.ok(subjects.every((s) => s.label))
  })
})

describe('osu.getSections', () => {
  it('pages through results and normalizes sections', async () => {
    globalThis.fetch = async (url) => {
      const page = new URL(String(url)).searchParams.get('p')
      return mockJson({
        data: {
          totalPages: 2,
          courses: page === '1'
            ? [courseWrapper({ classNumber: '1001' })]
            : [courseWrapper({ classNumber: '1002', status: 'Closed' })],
        },
      })
    }
    const sections = await osu.getSections({
      termCode: '1268', subjectCode: 'cse', termLabel: 'Fall 2026', subjectLabel: 'Computer Science & Engineering',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'osu')
    assert.equal(s0.crn, '1001')
    assert.equal(s0.courseNumber, '1222')
    assert.equal(s0.credits, 3)
    assert.equal(s0.status, 'open')
    // no capacity anywhere in the OSU payload
    assert.deepEqual(s0.enrollment, { max: null, current: 12, available: null })
    assert.deepEqual(s0.instructors, ['Jane Doe']) // null displayName dropped
    assert.equal(s0.meetings.length, 1)
    assert.deepEqual(s0.meetings[0].days, ['M', 'W'])
    assert.equal(s0.meetings[0].startTime, '11:30')
    assert.equal(s0.meetings[0].endTime, '12:25')
    assert.equal(s0.meetings[0].location, 'Caldwell Lab 112')

    assert.equal(sections[1].status, 'closed')
  })
})
