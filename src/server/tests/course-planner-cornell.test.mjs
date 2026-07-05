/**
 * Tests for cornell-scraper.js (Cornell — Class Roster JSON API).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as cornell from '../course-planner/cornell-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockJson(obj) {
  return { ok: true, status: 200, json: async () => obj }
}

describe('cornell.getTerms', () => {
  it('maps rosters to term codes/labels', async () => {
    globalThis.fetch = async () => mockJson({
      status: 'success',
      data: { rosters: [
        { slug: 'FA26', descr: 'Fall 2026' },
        { slug: 'SU26', descr: 'Summer 2026' },
      ] },
    })
    assert.deepEqual(await cornell.getTerms(), [
      { code: 'FA26', label: 'Fall 2026' },
      { code: 'SU26', label: 'Summer 2026' },
    ])
  })

  it('throws on an API error status', async () => {
    globalThis.fetch = async () => mockJson({ status: 'error', message: 'bad roster' })
    await assert.rejects(() => cornell.getTerms(), /bad roster/)
  })
})

describe('cornell.getSubjects', () => {
  it('prefers descrformal for the label', async () => {
    globalThis.fetch = async () => mockJson({
      status: 'success',
      data: { subjects: [
        { value: 'CS', descr: 'Computer Sci', descrformal: 'Computer Science' },
        { value: 'ECON', descr: 'Economics' },
      ] },
    })
    assert.deepEqual(await cornell.getSubjects('FA26'), [
      { code: 'CS', label: 'Computer Science' },
      { code: 'ECON', label: 'Economics' },
    ])
  })
})

describe('cornell.getSections', () => {
  const CLASSES = {
    status: 'success',
    data: { classes: [{
      catalogNbr: '1110',
      titleLong: 'Introduction to Computing',
      titleShort: 'Intro Computing',
      enrollGroups: [{
        unitsMinimum: 4,
        unitsMaximum: 4,
        classSections: [
          {
            ssrComponent: 'LEC', section: '001', classNbr: 17236, openStatus: 'O',
            meetings: [{
              pattern: 'TR', timeStart: '09:05AM', timeEnd: '09:55AM',
              bldgDescr: 'Uris Hall', facilityDescr: 'G01',
              instructors: [{ firstName: 'Walker', lastName: 'White' }],
            }],
          },
          {
            ssrComponent: 'DIS', section: '201', classNbr: 17301, openStatus: 'C',
            meetings: [{ pattern: '', timeStart: '', timeEnd: '', instructors: [] }],
          },
        ],
      }],
    }] },
  }

  it('flattens classes -> enrollGroups -> classSections', async () => {
    globalThis.fetch = async () => mockJson(CLASSES)
    const sections = await cornell.getSections({
      termCode: 'FA26', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const lec = sections[0]
    assert.equal(lec.school, 'cornell')
    assert.equal(lec.crn, '17236')
    assert.equal(lec.courseNumber, '1110')
    assert.equal(lec.sectionNumber, 'LEC 001')
    assert.equal(lec.title, 'Introduction to Computing')
    assert.equal(lec.credits, 4)
    assert.equal(lec.status, 'open')
    assert.deepEqual(lec.instructors, ['Walker White'])
    assert.deepEqual(lec.enrollment, { max: null, current: null, available: null })
    assert.equal(lec.meetings.length, 1)
    assert.deepEqual(lec.meetings[0].days, ['T', 'R'])
    assert.equal(lec.meetings[0].startTime, '09:05')
    assert.equal(lec.meetings[0].endTime, '09:55')
    assert.equal(lec.meetings[0].location, 'Uris Hall G01')
  })

  it('maps openStatus C to closed and drops timeless meetings', async () => {
    globalThis.fetch = async () => mockJson(CLASSES)
    const sections = await cornell.getSections({ termCode: 'FA26', subjectCode: 'CS' })
    const dis = sections[1]
    assert.equal(dis.status, 'closed')
    assert.equal(dis.sectionNumber, 'DIS 201')
    assert.deepEqual(dis.meetings, [])
  })
})
