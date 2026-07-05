/**
 * Tests for uiuc-scraper.js (UIUC — CIS explorer XML API, cascade mode).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as uiuc from '../course-planner/uiuc-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockXml(body) {
  return { ok: true, status: 200, text: async () => body }
}

describe('uiuc.getTerms', () => {
  it('collects terms from the current and next calendar year', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes(`${new Date().getFullYear() + 1}.xml`)) {
        return { ok: false, status: 404, text: async () => 'not found' }
      }
      return mockXml(`<?xml version="1.0"?><schedule>
        <terms>
          <term id="120268">Fall 2026</term>
          <term id="120265">Summer 2026</term>
        </terms>
      </schedule>`)
    }
    const terms = await uiuc.getTerms()
    assert.deepEqual(terms, [
      { code: '2026/fall', label: 'Fall 2026' },
      { code: '2026/summer', label: 'Summer 2026' },
    ])
  })
})

describe('uiuc.getSubjects', () => {
  it('parses subject ids and labels', async () => {
    globalThis.fetch = async () => mockXml(`<?xml version="1.0"?><term>
      <subjects>
        <subject id="CS">Computer Science</subject>
        <subject id="ECE">Electrical and Computer Engineering</subject>
      </subjects>
    </term>`)
    assert.deepEqual(await uiuc.getSubjects('2026/fall'), [
      { code: 'CS', label: 'Computer Science' },
      { code: 'ECE', label: 'Electrical and Computer Engineering' },
    ])
  })
})

describe('uiuc.getSections', () => {
  const CASCADE = `<?xml version="1.0"?><subject>
    <cascadingCourses>
      <cascadingCourse id="CS 100">
        <label>Computer Science Orientation</label>
        <creditHours>1 hours.</creditHours>
        <detailedSections>
          <detailedSection id="30094">
            <sectionNumber>AL1</sectionNumber>
            <enrollmentStatus>Open (Restricted)</enrollmentStatus>
            <meetings>
              <meeting id="0">
                <start>03:30PM</start><end>04:45PM</end>
                <daysOfTheWeek> R </daysOfTheWeek>
                <roomNumber>3039</roomNumber>
                <buildingName>Campus Instructional Facility</buildingName>
                <instructors>
                  <instructor lastName="Cunningham" firstName="R">Cunningham, R</instructor>
                </instructors>
              </meeting>
            </meetings>
          </detailedSection>
          <detailedSection id="30095">
            <sectionNumber>ONL</sectionNumber>
            <creditHours>2 hours.</creditHours>
            <enrollmentStatus>Closed</enrollmentStatus>
            <meetings>
              <meeting id="0">
                <start>ARRANGED</start>
                <daysOfTheWeek></daysOfTheWeek>
              </meeting>
            </meetings>
          </detailedSection>
        </detailedSections>
      </cascadingCourse>
    </cascadingCourses>
  </subject>`

  it('parses cascade sections with status text, credits fallback and meetings', async () => {
    globalThis.fetch = async () => mockXml(CASCADE)
    const sections = await uiuc.getSections({
      termCode: '2026/fall', subjectCode: 'CS', termLabel: 'Fall 2026', subjectLabel: 'Computer Science',
    })
    assert.equal(sections.length, 2)

    const s0 = sections[0]
    assert.equal(s0.school, 'uiuc')
    assert.equal(s0.crn, '30094')
    assert.equal(s0.courseNumber, '100')
    assert.equal(s0.title, 'Computer Science Orientation')
    assert.equal(s0.sectionNumber, 'AL1')
    assert.equal(s0.credits, 1) // course-level creditHours
    assert.equal(s0.status, 'open') // "Open (Restricted)"
    assert.deepEqual(s0.instructors, ['Cunningham, R'])
    assert.deepEqual(s0.enrollment, { max: null, current: null, available: null })
    assert.equal(s0.meetings.length, 1)
    assert.deepEqual(s0.meetings[0].days, ['R'])
    assert.equal(s0.meetings[0].startTime, '15:30')
    assert.equal(s0.meetings[0].endTime, '16:45')
    assert.equal(s0.meetings[0].location, 'Campus Instructional Facility 3039')

    const s1 = sections[1]
    assert.equal(s1.status, 'closed')
    assert.equal(s1.credits, 2) // section-level creditHours wins
    assert.deepEqual(s1.meetings, []) // ARRANGED dropped
  })
})
