import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  normalizeTime,
  parseDays,
  daysFromBooleans,
  parseCredits,
  parseCsv,
  csvToObjects,
} from '../course-planner/util.js'

// ── normalizeTime ─────────────────────────────────────────────────────────────

describe('normalizeTime', () => {
  it('converts 4-digit military "0900"', () => assert.equal(normalizeTime('0900'), '09:00'))
  it('converts 3-digit military "900"', () => assert.equal(normalizeTime('900'), '09:00'))
  it('converts 4-digit "1430"', () => assert.equal(normalizeTime('1430'), '14:30'))
  it('converts 4-digit "2359"', () => assert.equal(normalizeTime('2359'), '23:59'))
  it('converts "1:00PM"', () => assert.equal(normalizeTime('1:00PM'), '13:00'))
  it('converts "12:00PM" (noon)', () => assert.equal(normalizeTime('12:00PM'), '12:00'))
  it('converts "12:00AM" (midnight)', () => assert.equal(normalizeTime('12:00AM'), '00:00'))
  it('converts "12:30AM"', () => assert.equal(normalizeTime('12:30AM'), '00:30'))
  it('converts "1:00 PM" (space)', () => assert.equal(normalizeTime('1:00 PM'), '13:00'))
  it('converts "9:05AM"', () => assert.equal(normalizeTime('9:05AM'), '09:05'))
  it('passes through already-HH:MM "14:30"', () => assert.equal(normalizeTime('14:30'), '14:30'))
  it('passes through "09:00"', () => assert.equal(normalizeTime('09:00'), '09:00'))
  it('returns null for null', () => assert.equal(normalizeTime(null), null))
  it('returns null for undefined', () => assert.equal(normalizeTime(undefined), null))
  it('returns null for empty string', () => assert.equal(normalizeTime(''), null))
  it('returns null for garbage text', () => assert.equal(normalizeTime('TBA'), null))
})

// ── parseDays ─────────────────────────────────────────────────────────────────

describe('parseDays', () => {
  it('parses "MWF"', () => assert.deepEqual(parseDays('MWF'), ['M', 'W', 'F']))
  it('parses "TR" (R = Thursday)', () => assert.deepEqual(parseDays('TR'), ['T', 'R']))
  it('parses "MTWRF"', () => assert.deepEqual(parseDays('MTWRF'), ['M', 'T', 'W', 'R', 'F']))
  it('parses "MoWeFr" two-letter codes', () => assert.deepEqual(parseDays('MoWeFr'), ['M', 'W', 'F']))
  it('parses "TuTh" → T and R', () => assert.deepEqual(parseDays('TuTh'), ['T', 'R']))
  it('parses "TH" → R', () => assert.deepEqual(parseDays('TH'), ['R']))
  it('parses "SU" → U (Sunday)', () => assert.deepEqual(parseDays('SU'), ['U']))
  it('parses "SA" → S (Saturday)', () => assert.deepEqual(parseDays('SA'), ['S']))
  it('deduplicates repeated letters "MM"', () => assert.deepEqual(parseDays('MM'), ['M']))
  it('returns [] for empty string', () => assert.deepEqual(parseDays(''), []))
  it('returns [] for null', () => assert.deepEqual(parseDays(null), []))
  it('returns [] for undefined', () => assert.deepEqual(parseDays(undefined), []))
  it('ignores unknown characters', () => {
    // "MXF" — X is not a valid day code; should yield M and F
    const result = parseDays('MXF')
    assert.ok(result.includes('M'))
    assert.ok(result.includes('F'))
  })
})

// ── daysFromBooleans ──────────────────────────────────────────────────────────

describe('daysFromBooleans', () => {
  it('maps MWF boolean object', () => {
    assert.deepEqual(
      daysFromBooleans({ monday: true, wednesday: true, friday: true }),
      ['M', 'W', 'F']
    )
  })
  it('maps TR boolean object', () => {
    assert.deepEqual(daysFromBooleans({ tuesday: true, thursday: true }), ['T', 'R'])
  })
  it('puts Sunday first in the order', () => {
    assert.deepEqual(daysFromBooleans({ sunday: true, monday: true }), ['U', 'M'])
  })
  it('includes Saturday as S', () => {
    assert.deepEqual(daysFromBooleans({ saturday: true }), ['S'])
  })
  it('returns [] for all-false object', () => {
    assert.deepEqual(daysFromBooleans({ monday: false, tuesday: false }), [])
  })
  it('returns [] for empty object', () => assert.deepEqual(daysFromBooleans({}), []))
  it('returns [] for undefined', () => assert.deepEqual(daysFromBooleans(), []))
})

// ── parseCredits ──────────────────────────────────────────────────────────────

describe('parseCredits', () => {
  it('parses integer string "3"', () => assert.equal(parseCredits('3'), 3))
  it('parses decimal string "3.0"', () => assert.equal(parseCredits('3.0'), 3))
  it('parses decimal "1.5"', () => assert.equal(parseCredits('1.5'), 1.5))
  it('parses range "1 TO 3" → first number', () => assert.equal(parseCredits('1 TO 3'), 1))
  it('parses numeric type', () => assert.equal(parseCredits(12), 12))
  it('returns null for null', () => assert.equal(parseCredits(null), null))
  it('returns null for undefined', () => assert.equal(parseCredits(undefined), null))
  it('returns null for empty string', () => assert.equal(parseCredits(''), null))
  it('returns null for whitespace-only', () => assert.equal(parseCredits('  '), null))
  it('returns null for non-numeric "TBA"', () => assert.equal(parseCredits('TBA'), null))
  it('returns null for "N/A"', () => assert.equal(parseCredits('N/A'), null))
})

// ── parseCsv ──────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('parses simple two-column CSV', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']])
  })
  it('handles quoted field with comma inside', () => {
    assert.deepEqual(parseCsv('"Smith, John",25'), [['Smith, John', '25']])
  })
  it('handles escaped double-quote inside quoted field', () => {
    assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']])
  })
  it('handles CRLF line endings', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']])
  })
  it('skips blank lines', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,2'), [['a', 'b'], ['1', '2']])
  })
  it('returns single-element row for single value', () => {
    assert.deepEqual(parseCsv('hello'), [['hello']])
  })
  it('returns empty array for empty string', () => {
    assert.deepEqual(parseCsv(''), [])
  })
  it('handles trailing newline without extra empty row', () => {
    const rows = parseCsv('a,b\n1,2\n')
    assert.equal(rows.length, 2)
  })
  it('handles multi-line quoted field', () => {
    const rows = parseCsv('"line1\nline2",x')
    assert.equal(rows[0][0], 'line1\nline2')
    assert.equal(rows[0][1], 'x')
  })
})

// ── csvToObjects ──────────────────────────────────────────────────────────────

describe('csvToObjects', () => {
  it('maps header row to object keys', () => {
    const rows = [['NAME', 'AGE'], ['Alice', '30'], ['Bob', '25']]
    assert.deepEqual(csvToObjects(rows), [
      { NAME: 'Alice', AGE: '30' },
      { NAME: 'Bob', AGE: '25' },
    ])
  })
  it('trims whitespace from header names', () => {
    const rows = [[' NAME ', 'AGE'], ['Alice', '30']]
    assert.deepEqual(csvToObjects(rows), [{ NAME: 'Alice', AGE: '30' }])
  })
  it('returns empty array for empty input', () => {
    assert.deepEqual(csvToObjects([]), [])
  })
  it('returns empty array for header-only input', () => {
    assert.deepEqual(csvToObjects([['A', 'B']]), [])
  })
  it('fills missing fields with empty string', () => {
    const rows = [['A', 'B', 'C'], ['1', '2']]
    assert.deepEqual(csvToObjects(rows), [{ A: '1', B: '2', C: '' }])
  })
  it('handles numeric-string values unchanged', () => {
    const rows = [['SCORE'], ['42']]
    assert.deepEqual(csvToObjects(rows), [{ SCORE: '42' }])
  })
})
