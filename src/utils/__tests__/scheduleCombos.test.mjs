import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sectionIntervals,
  shiftIntervals,
  intervalsConflict,
  sectionUnavailable,
  splitIntoComponentSlots,
  passesFilters,
  generateCombos,
  comboMetrics,
  sortCombos,
} from '../scheduleCombos.js'

let crnCounter = 0

/** Open section with seats; override any field per test. */
function sec(over = {}) {
  return {
    school: 'rice',
    termCode: '202610',
    subjectCode: 'COMP',
    courseNumber: '140',
    sectionNumber: '001',
    crn: `crn-${++crnCounter}`,
    title: 'Test Course',
    instructors: [],
    credits: 3,
    enrollment: { max: 30, current: 10, available: 20 },
    status: 'open',
    meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '09:50', location: '' }],
    ...over,
  }
}

function slot(key, sections, extra = {}) {
  return { key, label: key, sections, ...extra }
}

// ── sectionIntervals / shiftIntervals ─────────────────────────────────────────

test('sectionIntervals expands each meeting across its days', () => {
  const ivs = sectionIntervals(sec())
  assert.deepEqual(ivs, [
    { day: 'M', startMin: 540, endMin: 590 },
    { day: 'W', startMin: 540, endMin: 590 },
  ])
})

test('sectionIntervals skips meetings with missing or unparseable times', () => {
  const s = sec({
    meetings: [
      { days: ['M'], startTime: '09:00', endTime: '09:50' },
      { days: ['R'], startTime: '', endTime: '' },
      { days: ['F'], startTime: 'TBA', endTime: 'TBA' },
    ],
  })
  assert.deepEqual(sectionIntervals(s), [{ day: 'M', startMin: 540, endMin: 590 }])
})

test('sectionIntervals is empty for async sections (meetings: [])', () => {
  assert.deepEqual(sectionIntervals(sec({ meetings: [] })), [])
})

test('shiftIntervals expands work shifts the same way', () => {
  const ivs = shiftIntervals([
    { id: 'w1', days: ['M', 'F'], startTime: '13:00', endTime: '17:00' },
    { id: 'w2', days: ['S'], startTime: '', endTime: '' },
  ])
  assert.deepEqual(ivs, [
    { day: 'M', startMin: 780, endMin: 1020 },
    { day: 'F', startMin: 780, endMin: 1020 },
  ])
})

// ── intervalsConflict ─────────────────────────────────────────────────────────

test('back-to-back sections do not conflict', () => {
  const a = sectionIntervals(sec({ meetings: [{ days: ['M'], startTime: '10:00', endTime: '10:50' }] }))
  const b = sectionIntervals(sec({ meetings: [{ days: ['M'], startTime: '10:50', endTime: '11:40' }] }))
  assert.equal(intervalsConflict(a, b), false)
})

test('R (Thursday) and U (Sunday) are distinct days', () => {
  const a = sectionIntervals(sec({ meetings: [{ days: ['R'], startTime: '10:00', endTime: '11:00' }] }))
  const b = sectionIntervals(sec({ meetings: [{ days: ['U'], startTime: '10:00', endTime: '11:00' }] }))
  assert.equal(intervalsConflict(a, b), false)
})

test('a multi-meeting section conflicts if ANY meeting overlaps', () => {
  const lectureAndLab = sectionIntervals(sec({
    meetings: [
      { days: ['M', 'W', 'F'], startTime: '09:00', endTime: '09:50' },
      { days: ['R'], startTime: '13:00', endTime: '14:50' },
    ],
  }))
  const other = sectionIntervals(sec({ meetings: [{ days: ['R'], startTime: '14:00', endTime: '15:00' }] }))
  assert.equal(intervalsConflict(lectureAndLab, other), true)
})

test('an async section never conflicts', () => {
  const async1 = sectionIntervals(sec({ meetings: [] }))
  const busy = sectionIntervals(sec())
  assert.equal(intervalsConflict(async1, busy), false)
  assert.equal(intervalsConflict(busy, async1), false)
})

// ── sectionUnavailable ────────────────────────────────────────────────────────

test('sectionUnavailable mirrors the page logic', () => {
  assert.equal(sectionUnavailable(sec()), null)
  assert.equal(sectionUnavailable(sec({ status: 'closed' })), 'closed')
  assert.equal(sectionUnavailable(sec({ enrollment: { max: 30, current: 30, available: 0 } })), 'full')
  assert.equal(sectionUnavailable(sec({ enrollment: { max: 25, current: 25, available: null } })), 'full')
  assert.equal(sectionUnavailable(sec({ enrollment: { max: null, current: null, available: null } })), null)
  assert.equal(sectionUnavailable(sec({ enrollment: undefined })), null)
})

// ── splitIntoComponentSlots ───────────────────────────────────────────────────

test('two distinct component tokens split into two slots', () => {
  const rows = [
    sec({ sectionNumber: 'LEC 001' }),
    sec({ sectionNumber: 'LEC 002' }),
    sec({ sectionNumber: 'DIS 201' }),
    sec({ sectionNumber: 'DIS-202' }),
  ]
  const slots = splitIntoComponentSlots(rows)
  assert.equal(slots.length, 2)
  const byComponent = Object.fromEntries(slots.map((s) => [s.component, s.sections.length]))
  assert.deepEqual(byComponent, { LEC: 2, DIS: 2 })
})

test('plain numeric sectionNumbers stay a single slot', () => {
  const rows = [sec({ sectionNumber: '001' }), sec({ sectionNumber: '002' })]
  const slots = splitIntoComponentSlots(rows)
  assert.equal(slots.length, 1)
  assert.equal(slots[0].component, '')
  assert.equal(slots[0].sections.length, 2)
})

test('a single uniform token stays a single slot', () => {
  const rows = [sec({ sectionNumber: 'LEC 001' }), sec({ sectionNumber: 'LEC 002' })]
  const slots = splitIntoComponentSlots(rows)
  assert.equal(slots.length, 1)
  assert.equal(slots[0].sections.length, 2)
})

// ── passesFilters ─────────────────────────────────────────────────────────────

test('earliestStart rejects a section that starts too early', () => {
  const s = sec({ meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] })
  assert.equal(passesFilters(s, { earliestStart: '09:00' }), false)
  assert.equal(passesFilters(s, { earliestStart: '08:00' }), true)
  assert.equal(passesFilters(s, { earliestStart: '' }), true)
})

test('latestEnd rejects a section that ends too late', () => {
  const s = sec({ meetings: [{ days: ['M'], startTime: '15:00', endTime: '16:15' }] })
  assert.equal(passesFilters(s, { latestEnd: '16:00' }), false)
  assert.equal(passesFilters(s, { latestEnd: '16:15' }), true)
})

test('daysOff rejects a section meeting on an off day', () => {
  const s = sec({ meetings: [{ days: ['M', 'F'], startTime: '09:00', endTime: '09:50' }] })
  assert.equal(passesFilters(s, { daysOff: ['F'] }), false)
  assert.equal(passesFilters(s, { daysOff: ['R'] }), true)
})

test('openOnly rejects closed and full sections', () => {
  assert.equal(passesFilters(sec({ status: 'closed' }), { openOnly: true }), false)
  assert.equal(passesFilters(sec({ enrollment: { max: 30, current: 30, available: 0 } }), { openOnly: true }), false)
  assert.equal(passesFilters(sec({ status: 'closed' }), { openOnly: false }), true)
})

test('async sections always pass time/day filters but still obey openOnly', () => {
  const asyncSec = sec({ meetings: [] })
  assert.equal(passesFilters(asyncSec, { earliestStart: '10:00', latestEnd: '12:00', daysOff: ['M', 'T', 'W', 'R', 'F', 'S', 'U'] }), true)
  assert.equal(passesFilters(sec({ meetings: [], status: 'closed' }), { openOnly: true }), false)
})

// ── generateCombos ────────────────────────────────────────────────────────────

test('generates the full cartesian product when nothing conflicts', () => {
  const a1 = sec({ meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
  const a2 = sec({ meetings: [{ days: ['M'], startTime: '10:00', endTime: '10:50' }] })
  const b1 = sec({ meetings: [{ days: ['T'], startTime: '09:00', endTime: '09:50' }] })
  const b2 = sec({ meetings: [{ days: ['T'], startTime: '10:00', endTime: '10:50' }] })
  const { combos, truncated, emptySlots } = generateCombos({
    slots: [slot('a', [a1, a2]), slot('b', [b1, b2])],
  })
  assert.equal(combos.length, 4)
  assert.equal(truncated, false)
  assert.deepEqual(emptySlots, [])
})

test('conflicting pairs are excluded', () => {
  const a1 = sec({ meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
  const a2 = sec({ meetings: [{ days: ['M'], startTime: '10:00', endTime: '10:50' }] })
  // Overlaps a1 only.
  const b1 = sec({ meetings: [{ days: ['M'], startTime: '09:30', endTime: '10:00' }] })
  const b2 = sec({ meetings: [{ days: ['T'], startTime: '09:00', endTime: '09:50' }] })
  const { combos } = generateCombos({ slots: [slot('a', [a1, a2]), slot('b', [b1, b2])] })
  assert.equal(combos.length, 3)
  assert.ok(!combos.some((c) => c.sections.includes(a1) && c.sections.includes(b1)))
})

test('combos keep the caller slot order even after internal pruning-sort', () => {
  const a1 = sec({ subjectCode: 'AAAA', meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
  const b1 = sec({ subjectCode: 'BBBB', meetings: [{ days: ['T'], startTime: '09:00', endTime: '09:50' }] })
  const b2 = sec({ subjectCode: 'BBBB', meetings: [{ days: ['T'], startTime: '10:00', endTime: '10:50' }] })
  // Slot 'b' has more sections, so the DFS visits 'a' first internally.
  const { combos } = generateCombos({ slots: [slot('b', [b1, b2]), slot('a', [a1])] })
  for (const c of combos) {
    assert.deepEqual(c.sections.map((s) => s.subjectCode), ['BBBB', 'AAAA'])
  }
})

test('work busy intervals prune overlapping sections', () => {
  const a1 = sec({ meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
  const a2 = sec({ meetings: [{ days: ['M'], startTime: '13:00', endTime: '13:50' }] })
  const busy = shiftIntervals([{ id: 'w', days: ['M'], startTime: '09:00', endTime: '12:00' }])
  const { combos } = generateCombos({ slots: [slot('a', [a1, a2])], busyIntervals: busy })
  assert.equal(combos.length, 1)
  assert.equal(combos[0].sections[0], a2)
})

test('async sections appear in combos and never conflict', () => {
  const asyncSec = sec({ meetings: [] })
  const timed = sec({ meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
  const { combos } = generateCombos({ slots: [slot('a', [asyncSec]), slot('b', [timed])] })
  assert.equal(combos.length, 1)
  assert.deepEqual(combos[0].sections, [asyncSec, timed])
})

test('all-async slots generate the exact cartesian product', () => {
  const mk = () => sec({ meetings: [] })
  const { combos } = generateCombos({
    slots: [slot('a', [mk(), mk()]), slot('b', [mk(), mk(), mk()])],
  })
  assert.equal(combos.length, 6)
})

test('maxCombos truncates and sets the flag', () => {
  const mk = (day, start, end) => sec({ meetings: [{ days: [day], startTime: start, endTime: end }] })
  const { combos, truncated } = generateCombos({
    slots: [
      slot('a', [mk('M', '09:00', '09:50'), mk('M', '10:00', '10:50')]),
      slot('b', [mk('T', '09:00', '09:50'), mk('T', '10:00', '10:50')]),
    ],
    maxCombos: 2,
  })
  assert.equal(combos.length, 2)
  assert.equal(truncated, true)
})

test('an empty slot short-circuits with reason no-sections', () => {
  const { combos, emptySlots } = generateCombos({
    slots: [slot('a', [sec()]), slot('b', [])],
  })
  assert.deepEqual(combos, [])
  assert.deepEqual(emptySlots, [{ key: 'b', label: 'b', reason: 'no-sections' }])
})

test('a slot fully removed by filters reports filtered-out', () => {
  const early = sec({ meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] })
  const { combos, emptySlots } = generateCombos({
    slots: [slot('a', [early])],
    filters: { earliestStart: '09:00' },
  })
  assert.deepEqual(combos, [])
  assert.deepEqual(emptySlots, [{ key: 'a', label: 'a', reason: 'filtered-out' }])
})

test('a pinned slot constrains every combo and wins over filters', () => {
  const pinnedEarly = sec({ crn: 'PINNED', meetings: [{ days: ['M'], startTime: '08:00', endTime: '08:50' }] })
  const other1 = sec({ meetings: [{ days: ['T'], startTime: '10:00', endTime: '10:50' }] })
  const other2 = sec({ meetings: [{ days: ['W'], startTime: '10:00', endTime: '10:50' }] })
  const { combos } = generateCombos({
    slots: [slot('a', [pinnedEarly], { pinned: true }), slot('b', [other1, other2])],
    // Would normally reject the 8am pinned section.
    filters: { earliestStart: '09:00' },
  })
  assert.equal(combos.length, 2)
  assert.ok(combos.every((c) => c.sections.some((s) => s.crn === 'PINNED')))
})

// ── comboMetrics ──────────────────────────────────────────────────────────────

test('gap math: 9:00-9:50 and 11:00-11:50 on the same day is a 70 min gap', () => {
  const a = sec({ meetings: [{ days: ['M'], startTime: '09:00', endTime: '09:50' }] })
  const b = sec({ meetings: [{ days: ['M'], startTime: '11:00', endTime: '11:50' }] })
  const m = comboMetrics([a, b])
  assert.equal(m.totalGapMin, 70)
  assert.equal(m.daysOnCampus, 1)
  assert.equal(m.earliestStartMin, 540)
  assert.equal(m.latestEndMin, 710)
})

test('daysOnCampus counts distinct days with course intervals', () => {
  const a = sec({ meetings: [{ days: ['M', 'W', 'F'], startTime: '09:00', endTime: '09:50' }] })
  const b = sec({ meetings: [{ days: ['T'], startTime: '10:00', endTime: '11:00' }] })
  assert.equal(comboMetrics([a, b]).daysOnCampus, 4)
})

test('an all-async combo has 0 days on campus and null earliest/latest', () => {
  const m = comboMetrics([sec({ meetings: [] }), sec({ meetings: [] })])
  assert.equal(m.daysOnCampus, 0)
  assert.equal(m.totalGapMin, 0)
  assert.equal(m.earliestStartMin, null)
  assert.equal(m.latestEndMin, null)
})

test('creditTotal sums non-null credits only', () => {
  const m = comboMetrics([sec({ credits: 3 }), sec({ credits: null }), sec({ credits: 4 })])
  assert.equal(m.creditTotal, 7)
})

// ── sortCombos ────────────────────────────────────────────────────────────────

function comboWith(metrics) {
  return { sections: [], metrics }
}

test('fewestDays orders by daysOnCampus ascending', () => {
  const combos = [
    comboWith({ daysOnCampus: 3, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
    comboWith({ daysOnCampus: 1, totalGapMin: 100, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
    comboWith({ daysOnCampus: 2, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
  ]
  assert.deepEqual(sortCombos(combos, 'fewestDays').map((c) => c.metrics.daysOnCampus), [1, 2, 3])
})

test('leastGaps orders by totalGapMin ascending', () => {
  const combos = [
    comboWith({ daysOnCampus: 2, totalGapMin: 90, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
    comboWith({ daysOnCampus: 5, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
    comboWith({ daysOnCampus: 2, totalGapMin: 45, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
  ]
  assert.deepEqual(sortCombos(combos, 'leastGaps').map((c) => c.metrics.totalGapMin), [0, 45, 90])
})

test('earliestDone orders by latestEndMin ascending with null (async) last', () => {
  const combos = [
    comboWith({ daysOnCampus: 2, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 900, creditTotal: 9 }),
    comboWith({ daysOnCampus: 0, totalGapMin: 0, earliestStartMin: null, latestEndMin: null, creditTotal: 9 }),
    comboWith({ daysOnCampus: 2, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
  ]
  assert.deepEqual(sortCombos(combos, 'earliestDone').map((c) => c.metrics.latestEndMin), [700, 900, null])
})

test('latestStart orders by earliestStartMin descending with null (async) last', () => {
  const combos = [
    comboWith({ daysOnCampus: 2, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 9 }),
    comboWith({ daysOnCampus: 0, totalGapMin: 0, earliestStartMin: null, latestEndMin: null, creditTotal: 9 }),
    comboWith({ daysOnCampus: 2, totalGapMin: 0, earliestStartMin: 660, latestEndMin: 800, creditTotal: 9 }),
  ]
  assert.deepEqual(sortCombos(combos, 'latestStart').map((c) => c.metrics.earliestStartMin), [660, 540, null])
})

test('sortCombos is stable and does not mutate its input', () => {
  const a = comboWith({ daysOnCampus: 1, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 3 })
  const b = comboWith({ daysOnCampus: 1, totalGapMin: 0, earliestStartMin: 540, latestEndMin: 700, creditTotal: 3 })
  const input = [a, b]
  const out = sortCombos(input, 'fewestDays')
  assert.equal(out[0], a)
  assert.equal(out[1], b)
  assert.notEqual(out, input)
})
