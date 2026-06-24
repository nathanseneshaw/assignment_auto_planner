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

  it('returns null with no season', () => assert.equal(parseTerm({ code: 'x', label: '2026' }), null))
  it('returns null with no year', () => assert.equal(parseTerm({ code: 'x', label: 'Fall' }), null))
  it('returns null for empty label', () => assert.equal(parseTerm({ code: 'x', label: '' }), null))

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
})
