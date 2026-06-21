/**
 * Tests for stanford-scraper.js (Stanford — ExploreCourses XML).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as stanford from '../course-planner/stanford-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body) {
  return { ok: true, status: 200, text: async () => body }
}

const DEPARTMENTS_XML = `<?xml version="1.0"?><schools>
  <school name="School of Engineering">
    <department longname="Computer Science" name="CS" />
    <department longname="Electrical Engineering" name="EE" />
  </school>
</schools>`

// A search response with one CS course (two sections in different terms) plus a
// cross-listed AA course whose <subject> is AA (must be filtered out of CS).
const SEARCH_XML = `<?xml version="1.0"?><xml><courses>
  <course>
    <year>2025-2026</year><subject>CS</subject><code>106A</code>
    <title>Programming Methodology</title><unitsMin>3</unitsMin><unitsMax>5</unitsMax>
    <sections>
      <section>
        <classId>3001</classId><term>2025-2026 Autumn</term><termId>1262</termId>
        <sectionNumber>01</sectionNumber><numEnrolled>180</numEnrolled><maxEnrolled>200</maxEnrolled>
        <enrollStatus>Open</enrollStatus>
        <schedules><schedule>
          <startTime>11:30:00 AM</startTime><endTime>12:20:00 PM</endTime><location>NVIDIA Aud</location>
          <days> Monday Wednesday Friday </days>
          <instructors><instructor><name>Sahami, M.</name></instructor></instructors>
        </schedule></schedules>
      </section>
      <section>
        <classId>3002</classId><term>2025-2026 Winter</term><termId>1264</termId>
        <sectionNumber>01</sectionNumber><numEnrolled>50</numEnrolled><maxEnrolled>50</maxEnrolled>
        <enrollStatus>Closed</enrollStatus>
        <schedules><schedule>
          <startTime>01:30:00 PM</startTime><endTime>02:50:00 PM</endTime><location>Gates B01</location>
          <days> Tuesday Thursday </days>
          <instructors><instructor><name>Doe, J.</name></instructor></instructors>
        </schedule></schedules>
      </section>
    </sections>
  </course>
  <course>
    <year>2025-2026</year><subject>AA</subject><code>174A</code>
    <title>Robot Autonomy (CS 137A)</title><unitsMin>3</unitsMin><unitsMax>4</unitsMax>
    <sections>
      <section>
        <classId>9999</classId><term>2025-2026 Autumn</term><termId>1262</termId>
        <sectionNumber>01</sectionNumber><numEnrolled>10</numEnrolled><maxEnrolled>80</maxEnrolled>
        <enrollStatus>Open</enrollStatus><schedules></schedules>
      </section>
    </sections>
  </course>
</courses></xml>`

describe('stanford.getTerms', () => {
  it('builds compound academicYear:termId codes ordered by quarter', async () => {
    globalThis.fetch = async () => mockRes(SEARCH_XML)
    const terms = await stanford.getTerms()
    assert.deepEqual(terms, [
      { code: '20252026:1262', label: '2025-2026 Autumn' },
      { code: '20252026:1264', label: '2025-2026 Winter' },
    ])
  })
})

describe('stanford.getSubjects', () => {
  it('parses department index into {code,label}', async () => {
    globalThis.fetch = async () => mockRes(DEPARTMENTS_XML)
    const subjects = await stanford.getSubjects()
    assert.deepEqual(subjects, [
      { code: 'CS', label: 'Computer Science' },
      { code: 'EE', label: 'Electrical Engineering' },
    ])
  })
})

describe('stanford.getSections', () => {
  it('keeps only sections matching the termId, drops cross-listed non-CS courses', async () => {
    globalThis.fetch = async () => mockRes(SEARCH_XML)
    const sections = await stanford.getSections({ termCode: '20252026:1262', subjectCode: 'CS' })
    assert.equal(sections.length, 1) // Winter section + AA course excluded
    const s = sections[0]
    assert.equal(s.school, 'stanford')
    assert.equal(s.crn, '3001')
    assert.equal(s.courseNumber, '106A')
    assert.equal(s.credits, 3)
    assert.deepEqual(s.enrollment, { max: 200, current: 180, available: 20 })
    assert.equal(s.status, 'open')
    assert.deepEqual(s.instructors, ['Sahami, M.'])
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W', 'F'])
    assert.equal(s.meetings[0].startTime, '11:30') // seconds stripped from "11:30:00 AM"
    assert.equal(s.meetings[0].endTime, '12:20')
    assert.equal(s.meetings[0].location, 'NVIDIA Aud')
  })

  it('maps PM times and Closed status for the Winter section', async () => {
    globalThis.fetch = async () => mockRes(SEARCH_XML)
    const [s] = await stanford.getSections({ termCode: '20252026:1264', subjectCode: 'CS' })
    assert.equal(s.crn, '3002')
    assert.equal(s.status, 'closed')
    assert.deepEqual(s.enrollment, { max: 50, current: 50, available: 0 })
    assert.equal(s.meetings[0].startTime, '13:30')
    assert.equal(s.meetings[0].endTime, '14:50')
    assert.deepEqual(s.meetings[0].days, ['T', 'R'])
  })
})
