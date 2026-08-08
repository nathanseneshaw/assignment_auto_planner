import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DAYS,
  toMinutes,
  formatClock,
  formatHour,
  dayLong,
  meetingSummary,
  overlaps,
} from '../scheduleTime.js'

test('DAYS runs Mon-Sun with the canonical single-letter codes', () => {
  assert.deepEqual(DAYS.map((d) => d.code), ['M', 'T', 'W', 'R', 'F', 'S', 'U'])
  assert.equal(DAYS[3].label, 'Thu') // R = Thursday
  assert.equal(DAYS[6].label, 'Sun') // U = Sunday
})

test('toMinutes converts HH:MM to minutes since midnight', () => {
  assert.equal(toMinutes('00:00'), 0)
  assert.equal(toMinutes('09:05'), 545)
  assert.equal(toMinutes('23:59'), 1439)
})

test('toMinutes yields NaN for empty/unparseable input', () => {
  assert.ok(Number.isNaN(toMinutes('')))
  assert.ok(Number.isNaN(toMinutes('TBA')))
})

test('formatClock renders 12-hour time with am/pm', () => {
  assert.equal(formatClock('14:30'), '2:30pm')
  assert.equal(formatClock('00:05'), '12:05am')
  assert.equal(formatClock('12:00'), '12:00pm')
  assert.equal(formatClock('09:00'), '9:00am')
})

test('formatHour renders a bare hour', () => {
  assert.equal(formatHour(0), '12am')
  assert.equal(formatHour(7), '7am')
  assert.equal(formatHour(12), '12pm')
  assert.equal(formatHour(13), '1pm')
})

test('dayLong maps day codes, passing unknown codes through', () => {
  assert.equal(dayLong('R'), 'Th')
  assert.equal(dayLong('U'), 'Su')
  assert.equal(dayLong('X'), 'X')
})

test('overlaps: touching endpoints do not overlap (half-open)', () => {
  assert.equal(overlaps(540, 650, 650, 700), false)
  assert.equal(overlaps(650, 700, 540, 650), false)
})

test('overlaps: partial and containing intervals overlap', () => {
  assert.equal(overlaps(540, 650, 600, 700), true)
  assert.equal(overlaps(540, 700, 600, 650), true)
  assert.equal(overlaps(600, 650, 540, 700), true)
})

test('meetingSummary is TBA for empty or time-less meetings', () => {
  assert.equal(meetingSummary([]), 'TBA')
  assert.equal(meetingSummary(null), 'TBA')
  assert.equal(meetingSummary([{ days: ['M'], startTime: '', endTime: '' }]), 'TBA')
})

test('meetingSummary formats days and times', () => {
  const s = meetingSummary([{ days: ['M', 'W', 'F'], startTime: '09:00', endTime: '09:50' }])
  assert.ok(s.includes('M,W,F'))
  assert.ok(s.includes('9:00am'))
  assert.ok(s.includes('9:50am'))
})
