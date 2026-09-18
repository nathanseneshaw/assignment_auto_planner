import test from 'node:test'
import assert from 'node:assert/strict'
import {
  localDateKey,
  utcDateKey,
  isDateOnlyKey,
  isDateOnlyInstant,
  dueDateKeyFromInstant,
  dueAtFromDueDate,
} from '../dueDate.js'

/** Run `fn` as if the viewer's machine were in `tz`. */
function withTz(tz, fn) {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

// Canvas exports a due date of "Sep 18, 11:59 PM" in US Central as the next
// morning in UTC. Bucketing that instant by its UTC day is what pushed every
// assignment one square to the right on the calendar.
const CANVAS_1159PM_CDT = '2026-09-19T04:59:00+00:00'

test('localDateKey formats the local calendar day, zero padded', () => {
  withTz('America/Chicago', () => {
    assert.equal(localDateKey(new Date('2026-09-19T04:59:00Z')), '2026-09-18')
    assert.equal(localDateKey(new Date('2026-01-05T18:00:00Z')), '2026-01-05')
  })
})

test('utcDateKey formats the UTC calendar day', () => {
  assert.equal(utcDateKey(new Date('2026-09-19T04:59:00Z')), '2026-09-19')
})

test('isDateOnlyKey accepts a bare day key and nothing else', () => {
  assert.equal(isDateOnlyKey('2026-09-18'), true)
  assert.equal(isDateOnlyKey(' 2026-09-18 '), true)
  assert.equal(isDateOnlyKey('2026-09-18T00:00:00Z'), false)
  assert.equal(isDateOnlyKey(null), false)
})

test('isDateOnlyInstant only matches an exact midnight-UTC timestamp', () => {
  assert.equal(isDateOnlyInstant(new Date('2026-09-18T00:00:00.000Z')), true)
  assert.equal(isDateOnlyInstant(new Date('2026-09-18T00:00:00.001Z')), false)
  assert.equal(isDateOnlyInstant(new Date('2026-09-19T04:59:00.000Z')), false)
})

test('a timed due date lands on the viewer\'s local day, not the UTC one', () => {
  withTz('America/Chicago', () => {
    assert.equal(dueDateKeyFromInstant(CANVAS_1159PM_CDT), '2026-09-18')
  })
  withTz('America/Los_Angeles', () => {
    assert.equal(dueDateKeyFromInstant(CANVAS_1159PM_CDT), '2026-09-18')
  })
  // East of UTC that same instant really is the 19th locally.
  withTz('Asia/Tokyo', () => {
    assert.equal(dueDateKeyFromInstant(CANVAS_1159PM_CDT), '2026-09-19')
  })
})

test('an all-day item (midnight UTC) shows the same day in every timezone', () => {
  for (const tz of ['America/Los_Angeles', 'America/Chicago', 'UTC', 'Asia/Tokyo', 'Pacific/Auckland']) {
    withTz(tz, () => {
      assert.equal(dueDateKeyFromInstant('2026-09-17T00:00:00.000Z'), '2026-09-17', tz)
    })
  }
})

test('dueDateKeyFromInstant falls back to today on missing or garbage input', () => {
  withTz('America/Chicago', () => {
    assert.equal(dueDateKeyFromInstant(null), localDateKey())
    assert.equal(dueDateKeyFromInstant('not a date'), localDateKey())
  })
})

test('dueDateKeyFromInstant passes a bare day key straight through', () => {
  withTz('America/Chicago', () => {
    assert.equal(dueDateKeyFromInstant('2026-09-18'), '2026-09-18')
  })
})

test('dueAtFromDueDate stores a hand-picked day as midnight UTC', () => {
  withTz('America/Chicago', () => {
    assert.equal(dueAtFromDueDate('2026-09-18'), '2026-09-18T00:00:00.000Z')
  })
})

test('dueAtFromDueDate preserves a real instant so a feed due time is not flattened', () => {
  assert.equal(dueAtFromDueDate(CANVAS_1159PM_CDT), '2026-09-19T04:59:00.000Z')
  assert.equal(dueAtFromDueDate(new Date('2026-09-19T04:59:00Z')), '2026-09-19T04:59:00.000Z')
})

test('a day key survives the write/read round trip on both sides of UTC', () => {
  for (const tz of ['Pacific/Auckland', 'Asia/Tokyo', 'UTC', 'America/Chicago', 'America/Los_Angeles']) {
    withTz(tz, () => {
      assert.equal(dueDateKeyFromInstant(dueAtFromDueDate('2026-09-18')), '2026-09-18', tz)
    })
  }
})

test('a feed instant survives the round trip for a viewer in its own timezone', () => {
  withTz('America/Chicago', () => {
    const key = dueDateKeyFromInstant(CANVAS_1159PM_CDT)
    // Marking it done re-persists the untouched instant, so the day cannot drift.
    assert.equal(dueDateKeyFromInstant(dueAtFromDueDate(CANVAS_1159PM_CDT)), key)
    // Moving it by hand drops the instant and stores the new day instead.
    assert.equal(dueDateKeyFromInstant(dueAtFromDueDate('2026-09-20')), '2026-09-20')
  })
})
