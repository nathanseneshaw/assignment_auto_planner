import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  parseTerm,
  nowTermKey,
  selectCurrentAndNextTerms,
} from '../course-planner/term-window.js'

// ── parseTerm: label dialects → clean "Season YYYY" ───────────────────────────

describe('parseTerm', () => {
  const label = (l, code = 'x') => parseTerm({ code, label: l })?.label

  it('passes through "Fall 2026"', () => assert.equal(label('Fall 2026'), 'Fall 2026'))
  it('title-cases "FALL 2026"', () => assert.equal(label('FALL 2026'), 'Fall 2026'))
  it('reorders "2026 Fall"', () => assert.equal(label('2026 Fall'), 'Fall 2026'))
  it('spaces "Fall2025" (Columbia)', () => assert.equal(label('Fall2025'), 'Fall 2025'))
  it('expands "26 Fall" two-digit year (TCU)', () => assert.equal(label('26 Fall'), 'Fall 2026'))

  it('strips "(View Only)" noise', () => assert.equal(label('Fall 2026 (View Only)'), 'Fall 2026'))
  it('strips "(UGRD)" noise (Colleague)', () => assert.equal(label('Fall 2026 (UGRD)'), 'Fall 2026'))
  it('strips campus suffix', () =>
    assert.equal(label('Fall 2026 - College Station'), 'Fall 2026'))
  it('strips PeopleSoft session text', () =>
    assert.equal(label('2026 Fall Regular Academic Session'), 'Fall 2026'))

  // Forced four-name mapping.
  it('maps Autumn → Fall', () => assert.equal(label('Autumn 2026'), 'Fall 2026'))
  it('maps IAP → Winter (MIT)', () => assert.equal(label('IAP 2026'), 'Winter 2026'))
  it('maps Wintersession → Winter (TCU)', () => assert.equal(label('Wintersession 2026'), 'Winter 2026'))
  it('maps Maymester → Summer (TCU)', () => assert.equal(label('Maymester 2026'), 'Summer 2026'))

  // Stanford academic-year range: Fall takes the first year, others the second.
  it('range + Autumn → first year (Stanford)', () =>
    assert.equal(label('2025-2026 Autumn'), 'Fall 2025'))
  it('range + Winter → second year', () => assert.equal(label('2025-2026 Winter'), 'Winter 2026'))
  it('range + Spring → second year', () => assert.equal(label('2025-2026 Spring'), 'Spring 2026'))
  it('range + Summer → second year', () => assert.equal(label('2025-2026 Summer'), 'Summer 2026'))
  it('handles "2025-26" short range', () => assert.equal(label('2025-26 Autumn'), 'Fall 2025'))

  // Embedded date spans must not be mistaken for academic-year ranges: in
  // "…26-MAY-2026 - 31-JUL-2026" the "2026 - 31" match is non-consecutive,
  // so the plain season year wins (Texas State).
  it('ignores date spans in labels (Texas State)', () =>
    assert.equal(label('Summer 2026 26-MAY-2026 - 31-JUL-2026'), 'Summer 2026'))
  it('ignores date spans for Spring terms', () =>
    assert.equal(label('Spring 2026 20-JAN-2026 - 13-MAY-2026 (View Only)'), 'Spring 2026'))

  it('returns null with no season', () => assert.equal(parseTerm({ code: 'x', label: '2026' }), null))
  it('returns null with no year', () => assert.equal(parseTerm({ code: 'x', label: 'Fall' }), null))
  it('returns null for empty label', () => assert.equal(parseTerm({ code: 'x', label: '' }), null))
  it('returns null for null / undefined / empty input', () => {
    assert.equal(parseTerm(null), null)
    assert.equal(parseTerm(undefined), null)
    assert.equal(parseTerm({}), null)
  })
  it('returns null for a whitespace-only label', () =>
    assert.equal(parseTerm({ code: 'x', label: '   ' }), null))
  it('returns null for a numeric-only label (Banner term code)', () =>
    assert.equal(parseTerm({ code: 'x', label: 202610 }), null))

  it('expands a two-digit year at the top of the range ("99 Fall")', () =>
    assert.equal(label('99 Fall'), 'Fall 2099'))
  it('ignores a non-consecutive year pair and uses the plain year', () =>
    // "2025-2027" is not an academic year, so the four-digit match wins.
    assert.equal(label('2025-2027 Autumn'), 'Fall 2025'))
  it('collapses repeated whitespace in a label', () =>
    assert.equal(label('  Fall     2026  '), 'Fall 2026'))

  it('keeps the original code', () =>
    assert.equal(parseTerm({ code: '202610', label: 'Fall 2026' }).code, '202610'))

  it('orders Winter < Spring < Summer < Fall within a year', () => {
    const key = (l) => parseTerm({ code: 'x', label: l }).key
    assert.ok(key('Winter 2026') < key('Spring 2026'))
    assert.ok(key('Spring 2026') < key('Summer 2026'))
    assert.ok(key('Summer 2026') < key('Fall 2026'))
    assert.ok(key('Fall 2026') < key('Winter 2027'))
  })
})

// ── nowTermKey: month → in-progress season ────────────────────────────────────

describe('nowTermKey', () => {
  const keyOf = (iso) => nowTermKey(new Date(iso))
  it('March is Spring', () => assert.equal(keyOf('2026-03-15'), parseTerm({ label: 'Spring 2026' }).key))
  it('June is Summer', () => assert.equal(keyOf('2026-06-23'), parseTerm({ label: 'Summer 2026' }).key))
  it('October is Fall', () => assert.equal(keyOf('2026-10-01'), parseTerm({ label: 'Fall 2026' }).key))
  it('December is Fall', () => assert.equal(keyOf('2026-12-20'), parseTerm({ label: 'Fall 2026' }).key))

  // Month boundaries. Built with local-time constructors so the assertion does
  // not flip a month west of UTC the way `new Date('2026-05-01')` would.
  const key = (l) => parseTerm({ label: l }).key
  const local = (y, monthIndex, day) => nowTermKey(new Date(y, monthIndex, day))

  it('Jan 1 is Spring (the Spring window opens the year)', () =>
    assert.equal(local(2026, 0, 1), key('Spring 2026')))
  it('Apr 30 is still Spring', () => assert.equal(local(2026, 3, 30), key('Spring 2026')))
  it('May 1 flips to Summer', () => assert.equal(local(2026, 4, 1), key('Summer 2026')))
  it('Jul 31 is still Summer', () => assert.equal(local(2026, 6, 31), key('Summer 2026')))
  it('Aug 1 flips to Fall', () => assert.equal(local(2026, 7, 1), key('Fall 2026')))
  it('Dec 31 is still Fall of that year', () =>
    assert.equal(local(2026, 11, 31), key('Fall 2026')))
  it('Jan 1 of the next year is Spring of the next year', () =>
    assert.equal(local(2027, 0, 1), key('Spring 2027')))
})

// ── selectCurrentAndNextTerms: current + next, cleaned ────────────────────────

describe('selectCurrentAndNextTerms', () => {
  const JUNE = { now: new Date('2026-06-23') } // current term = Summer 2026

  it('returns the current term plus the next, oldest first', () => {
    const raw = [
      { code: 'a', label: 'Spring 2026' },
      { code: 'b', label: 'Summer 2026' },
      { code: 'c', label: 'Fall 2026' },
      { code: 'd', label: 'Spring 2027' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: 'b', label: 'Summer 2026' },
      { code: 'c', label: 'Fall 2026' },
    ])
  })

  it('drops terms going back to 2004', () => {
    const raw = [
      { code: 'old', label: 'Fall 2004' },
      { code: 'b', label: 'Summer 2026' },
      { code: 'c', label: 'Fall 2026' },
    ]
    const out = selectCurrentAndNextTerms(raw, JUNE)
    assert.deepEqual(out.map((t) => t.label), ['Summer 2026', 'Fall 2026'])
  })

  it('normalises labels regardless of input order or dialect', () => {
    const raw = [
      { code: 'c', label: '202630' }, // unparseable, ignored
      { code: 'b', label: '2026 SUMMER' },
      { code: 'd', label: 'FALL2026' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: 'b', label: 'Summer 2026' },
      { code: 'd', label: 'Fall 2026' },
    ])
  })

  it('skips a season the school does not offer', () => {
    const raw = [
      { code: 'a', label: 'Spring 2026' },
      { code: 'c', label: 'Fall 2026' }, // no summer term listed
      { code: 'd', label: 'Spring 2027' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: 'c', label: 'Fall 2026' },
      { code: 'd', label: 'Spring 2027' },
    ])
  })

  it('collapses duplicate season+year (summer sub-sessions)', () => {
    const raw = [
      { code: 's1', label: 'Summer 2026 8-Week' },
      { code: 's2', label: 'Summer 2026 First 5 Week' },
      { code: 'f', label: 'Fall 2026' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: 's1', label: 'Summer 2026' },
      { code: 'f', label: 'Fall 2026' },
    ])
  })

  it('returns the single current term when nothing follows it (MIT)', () => {
    const raw = [{ code: 'f26', label: 'Fall 2026' }]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [{ code: 'f26', label: 'Fall 2026' }])
  })

  it('falls back to the latest term(s) when every term is in the past', () => {
    const raw = [
      { code: 'a', label: 'Fall 2024' },
      { code: 'b', label: 'Spring 2025' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: 'a', label: 'Fall 2024' },
      { code: 'b', label: 'Spring 2025' },
    ])
  })

  it('degrades to the raw list when no term parses', () => {
    const raw = [
      { code: '202630', label: '202630' },
      { code: '202620', label: '202620' },
      { code: '202610', label: '202610' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: '202630', label: '202630' },
      { code: '202620', label: '202620' },
    ])
  })

  it('handles an empty / non-array input', () => {
    assert.deepEqual(selectCurrentAndNextTerms([], JUNE), [])
    assert.deepEqual(selectCurrentAndNextTerms(undefined, JUNE), [])
  })

  it('honours a custom count', () => {
    const raw = [
      { code: 'a', label: 'Spring 2026' },
      { code: 'b', label: 'Summer 2026' },
      { code: 'c', label: 'Fall 2026' },
      { code: 'd', label: 'Spring 2027' },
    ]
    const MARCH = { now: new Date(2026, 2, 1) }
    assert.deepEqual(selectCurrentAndNextTerms(raw, { ...MARCH, count: 1 }), [
      { code: 'a', label: 'Spring 2026' },
    ])
    assert.deepEqual(
      selectCurrentAndNextTerms(raw, { ...MARCH, count: 3 }).map((t) => t.label),
      ['Spring 2026', 'Summer 2026', 'Fall 2026']
    )
  })

  it('returns everything available when count exceeds the list', () => {
    const raw = [{ code: 'c', label: 'Fall 2026' }]
    assert.equal(selectCurrentAndNextTerms(raw, { ...JUNE, count: 5 }).length, 1)
  })

  it('skips unparseable entries mixed in with parseable ones', () => {
    const raw = [null, { code: 'a', label: 'Fall 2026' }, undefined, { code: 'b' }]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [{ code: 'a', label: 'Fall 2026' }])
  })

  it('throws on a list where every entry is null (known unguarded fallback)', () => {
    // Nothing parses, so the raw-list fallback runs and dereferences `t.code`
    // on a null entry. No scraper emits this today; pinned so a future guard is
    // a deliberate change rather than an accident.
    assert.throws(() => selectCurrentAndNextTerms([null, null], JUNE), TypeError)
  })

  it('preserves non-string codes exactly', () => {
    const raw = [{ code: 202630, label: 'Summer 2026' }, { code: 0, label: 'Fall 2026' }]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JUNE), [
      { code: 202630, label: 'Summer 2026' },
      { code: 0, label: 'Fall 2026' },
    ])
  })
})

// ── selectCurrentAndNextTerms: year rollover ──────────────────────────────────

describe('selectCurrentAndNextTerms year rollover', () => {
  // Local-time constructors, not ISO strings: `new Date('2026-12-15')` is UTC
  // midnight and can land on the previous day (and previous month) west of UTC.
  const DEC = { now: new Date(2026, 11, 15) } // current term = Fall 2026
  const JAN = { now: new Date(2026, 0, 10) } // current term = Spring 2026

  it('rolls the "next" term into the following calendar year', () => {
    const raw = [
      { code: 'f26', label: 'Fall 2026' },
      { code: 'w27', label: 'Winter 2027' },
      { code: 's27', label: 'Spring 2027' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, DEC), [
      { code: 'f26', label: 'Fall 2026' },
      { code: 'w27', label: 'Winter 2027' },
    ])
  })

  it('skips to next Spring when the school has no Winter term', () => {
    const raw = [
      { code: 'f26', label: 'Fall 2026' },
      { code: 's27', label: 'Spring 2027' },
      { code: 'su27', label: 'Summer 2027' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, DEC), [
      { code: 'f26', label: 'Fall 2026' },
      { code: 's27', label: 'Spring 2027' },
    ])
  })

  it('never shows a prior-year term in December', () => {
    const raw = [
      { code: 'sp26', label: 'Spring 2026' },
      { code: 'su26', label: 'Summer 2026' },
      { code: 'f26', label: 'Fall 2026' },
      { code: 'w27', label: 'Winter 2027' },
    ]
    const labels = selectCurrentAndNextTerms(raw, DEC).map((t) => t.label)
    assert.ok(!labels.includes('Spring 2026'))
    assert.ok(!labels.includes('Summer 2026'))
  })

  it('treats a January intersession term as already past', () => {
    // nowTermKey maps Jan-Apr to Spring, so a Winter term running that same
    // January sorts before "now" and is dropped.
    const raw = [
      { code: 'w26', label: 'Winter 2026' },
      { code: 'sp26', label: 'Spring 2026' },
      { code: 'su26', label: 'Summer 2026' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, JAN), [
      { code: 'sp26', label: 'Spring 2026' },
      { code: 'su26', label: 'Summer 2026' },
    ])
  })

  it('falls back to the newest terms when the catalog stops mid-year', () => {
    const raw = [
      { code: 'sp26', label: 'Spring 2026' },
      { code: 'su26', label: 'Summer 2026' },
    ]
    assert.deepEqual(selectCurrentAndNextTerms(raw, DEC), [
      { code: 'sp26', label: 'Spring 2026' },
      { code: 'su26', label: 'Summer 2026' },
    ])
  })
})
