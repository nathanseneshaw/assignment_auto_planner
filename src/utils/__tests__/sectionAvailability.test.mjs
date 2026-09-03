import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sectionUnavailable,
  isSectionAvailable,
  groupSectionsByCourse,
} from '../sectionAvailability.js'

function sec(over = {}) {
  return {
    school: 'rice',
    termCode: '202610',
    crn: '1',
    subjectCode: 'COMP',
    courseNumber: '140',
    sectionNumber: '001',
    title: 'Intro',
    status: 'open',
    instructors: [],
    enrollment: { max: 30, current: 10, available: 20 },
    meetings: [],
    ...over,
  }
}

// ── sectionUnavailable ────────────────────────────────────────────────────────

test('sectionUnavailable reads status first, then seat counts', () => {
  assert.equal(sectionUnavailable(sec()), null)
  assert.equal(sectionUnavailable(sec({ status: 'closed' })), 'closed')
  assert.equal(sectionUnavailable(sec({ enrollment: { max: 30, current: 30, available: 0 } })), 'full')
  assert.equal(sectionUnavailable(sec({ enrollment: { max: 25, current: 25, available: null } })), 'full')
})

test('sectionUnavailable treats missing data as available', () => {
  // Schools that publish no enrollment data at all (MIT, UTD, Cornell) must not
  // have their whole catalogue filtered away.
  assert.equal(sectionUnavailable(sec({ status: 'unknown', enrollment: { max: null, current: null, available: null } })), null)
  assert.equal(sectionUnavailable(sec({ enrollment: undefined })), null)
  assert.equal(sectionUnavailable(undefined), null)
  assert.equal(isSectionAvailable(sec({ status: 'unknown' })), true)
})

// ── groupSectionsByCourse ─────────────────────────────────────────────────────

test('groupSectionsByCourse keeps first-seen order and counts takeable sections', () => {
  const groups = groupSectionsByCourse([
    sec({ crn: '1', courseNumber: '140', sectionNumber: '001' }),
    sec({ crn: '2', courseNumber: '182', sectionNumber: '001', status: 'closed' }),
    sec({ crn: '3', courseNumber: '140', sectionNumber: '002', enrollment: { max: 10, current: 10, available: 0 } }),
  ])
  assert.deepEqual(groups.map((g) => g.courseNumber), ['140', '182'])
  assert.equal(groups[0].sections.length, 2)
  assert.equal(groups[0].available, 1)
  assert.equal(groups[0].first.crn, '1')
  // A course whose every section is closed: available === 0 marks it dead.
  assert.equal(groups[1].available, 0)
})

test('groupSectionsByCourse handles an empty or missing list', () => {
  assert.deepEqual(groupSectionsByCourse([]), [])
  assert.deepEqual(groupSectionsByCourse(undefined), [])
})
