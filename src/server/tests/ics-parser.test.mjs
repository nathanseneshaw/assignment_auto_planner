import assert from 'node:assert'
import { describe, it } from 'node:test'
import { parseIcsBuffer, extractCourse, parseAndExpand } from '../ics-parser.js'

// ── ICS construction helpers ──────────────────────────────────────────────────

const CRLF = '\r\n'

function ics(...lines) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join(CRLF) + CRLF
}

function vevent(fields) {
  return ['BEGIN:VEVENT', ...Object.entries(fields).map(([k, v]) => `${k}:${v}`), 'END:VEVENT'].join(CRLF)
}

function vtodo(fields) {
  return ['BEGIN:VTODO', ...Object.entries(fields).map(([k, v]) => `${k}:${v}`), 'END:VTODO'].join(CRLF)
}

// Minimal event object for extractCourse tests (bypasses node-ical parsing overhead)
function evt(fields) {
  return { summary: '', description: '', url: '', location: '', ...fields }
}

// ── parseIcsBuffer ────────────────────────────────────────────────────────────

describe('parseIcsBuffer', () => {
  it('throws on HTML response (LMS login page)', () => {
    assert.throws(
      () => parseIcsBuffer('<html><body>Please log in</body></html>'),
      /BEGIN:VCALENDAR/
    )
  })

  it('throws on empty string', () => {
    assert.throws(() => parseIcsBuffer(''), /BEGIN:VCALENDAR/)
  })

  it('throws on null / undefined', () => {
    assert.throws(() => parseIcsBuffer(null), /BEGIN:VCALENDAR/)
    assert.throws(() => parseIcsBuffer(undefined), /BEGIN:VCALENDAR/)
  })

  it('strips UTF-8 BOM before validation', () => {
    const withBom = '﻿' + ics()
    assert.doesNotThrow(() => parseIcsBuffer(withBom))
  })

  it('reads X-WR-CALNAME', () => {
    const feed = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Spring 2026 Courses', 'END:VCALENDAR'].join(CRLF) + CRLF
    const { calendarName } = parseIcsBuffer(feed)
    assert.equal(calendarName, 'Spring 2026 Courses')
  })

  it('returns empty calendarName when X-WR-CALNAME is absent', () => {
    const { calendarName } = parseIcsBuffer(ics())
    assert.equal(calendarName, '')
  })

  it('parses a VEVENT and includes it in events[]', () => {
    const feed = ics(vevent({ UID: 'test-1@x', SUMMARY: 'Quiz 1', DTSTART: '20260901T120000Z', DTEND: '20260901T130000Z' }))
    const { events } = parseIcsBuffer(feed)
    assert.equal(events.length, 1)
    assert.equal(events[0].summary, 'Quiz 1')
  })

  it('parses a VTODO and includes it in events[]', () => {
    const feed = ics(vtodo({ UID: 'todo-1@x', SUMMARY: 'Problem Set 1', DTSTART: '20260901T000000Z', DUE: '20260908T235900Z' }))
    const { events } = parseIcsBuffer(feed)
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'VTODO')
  })

  it('returns multiple events from a multi-event feed', () => {
    const feed = ics(
      vevent({ UID: 'e1@x', SUMMARY: 'Event A', DTSTART: '20260901T120000Z', DTEND: '20260901T130000Z' }),
      vevent({ UID: 'e2@x', SUMMARY: 'Event B', DTSTART: '20260902T120000Z', DTEND: '20260902T130000Z' })
    )
    const { events } = parseIcsBuffer(feed)
    assert.equal(events.length, 2)
  })
})

// ── extractCourse — source priority ──────────────────────────────────────────

describe('extractCourse — source priority', () => {
  it('1. Canvas /courses/<id> in description → canvas:<id>', () => {
    const result = extractCourse(
      evt({ description: 'https://canvas.example.edu/courses/12345/assignments/1', summary: 'HW [CS 3340]' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'canvas:12345')
    assert.equal(result.courseName, 'CS 3340') // bracket name from summary
  })

  it('1. Canvas /courses/<id> in url field → canvas:<id>', () => {
    const result = extractCourse(
      evt({ url: 'https://canvas.example.edu/courses/99/assignments/7', summary: 'Lab' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'canvas:99')
  })

  it('1. Canvas /courses/<id> in location field → canvas:<id>', () => {
    const result = extractCourse(
      evt({ location: 'https://canvas.example.edu/courses/777' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'canvas:777')
  })

  it('2. Blackboard course_id=_NNN_N in description → bb:<id>', () => {
    const result = extractCourse(
      evt({ description: 'course_id=_123456_1\nDue Sept 5' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'bb:_123456_1')
  })

  it('2. Blackboard Ultra /courses/_NNN_N/ in description → bb:<id>', () => {
    const result = extractCourse(
      evt({ description: 'https://mybb.example.edu/ultra/courses/_78910_1/outline' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'bb:_78910_1')
  })

  it('3. [Bracket] at end of summary → name:<bracket>', () => {
    const result = extractCourse(evt({ summary: 'Midterm [CS 3340]' }), '', null)
    assert.equal(result.courseExternalId, 'name:cs 3340')
    assert.equal(result.courseName, 'CS 3340')
  })

  it('3. [Bracket] at start of summary → name:<bracket>', () => {
    const result = extractCourse(evt({ summary: '[MATH 2418] Exam 1' }), '', null)
    assert.equal(result.courseExternalId, 'name:math 2418')
  })

  it('3. [Bracket] resolves via bracketToCanvasId map → canvas:<id>', () => {
    const map = new Map([['cs 3340', '99999']])
    const result = extractCourse(evt({ summary: 'Announcement [CS 3340]' }), '', map)
    assert.equal(result.courseExternalId, 'canvas:99999')
  })

  it('4. "Course:" line in description → name:<name>', () => {
    const result = extractCourse(
      evt({ description: 'Course: Introduction to Algorithms\nDue: Sept 5', summary: 'HW 1' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'name:introduction to algorithms')
    assert.equal(result.courseName, 'Introduction to Algorithms')
  })

  it('4. "Course Name:" variant also matches', () => {
    const result = extractCourse(
      evt({ description: 'Course Name: Linear Algebra', summary: 'Quiz' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'name:linear algebra')
  })

  it('5. CATEGORIES (array) → name:<first entry>', () => {
    const result = extractCourse(
      evt({ summary: 'Quiz', categories: ['MATH 2418'] }),
      '', null
    )
    assert.equal(result.courseExternalId, 'name:math 2418')
    assert.equal(result.courseName, 'MATH 2418')
  })

  it('5. CATEGORIES (comma-separated string) → name:<first>', () => {
    const result = extractCourse(
      evt({ summary: 'Quiz', categories: 'MATH 2418, Physics' }),
      '', null
    )
    assert.equal(result.courseExternalId, 'name:math 2418')
  })

  it('6. Course code in summary → name:<code>', () => {
    const result = extractCourse(evt({ summary: 'Lab 5 - CS 3340' }), '', null)
    assert.match(result.courseExternalId, /^name:cs[\s\-]?3340/)
  })

  it('6. Course code with section number (CS 3340.501) → name:<code>', () => {
    const result = extractCourse(evt({ summary: 'CS 3340.501 Assignment' }), '', null)
    assert.match(result.courseExternalId, /^name:cs[\s\-]?3340/)
  })

  it('7. feedLabel option → label:<label>', () => {
    const result = extractCourse(
      evt({ summary: 'Office Hours' }),
      '', null,
      { feedLabel: 'Calculus II' }
    )
    assert.equal(result.courseExternalId, 'label:calculus ii')
    assert.equal(result.courseName, 'Calculus II')
  })

  it('8. calendarName → cal:<name>', () => {
    const result = extractCourse(evt({ summary: 'Lecture' }), 'Physics 101', null)
    assert.equal(result.courseName, 'Physics 101')
    // Without feedId, uses cal: prefix
    assert.ok(result.courseExternalId.startsWith('cal:') || result.courseExternalId.startsWith('name:'))
  })

  it('8. feedId qualifies calendarName to avoid cross-feed collisions', () => {
    const result = extractCourse(evt({ summary: 'Lecture' }), 'My University', null, { feedId: 'feed-42' })
    assert.equal(result.courseExternalId, 'feed:feed-42')
    assert.equal(result.courseName, 'My University')
  })

  it('9. fallback bucket → Unknown course', () => {
    const result = extractCourse(evt({ summary: 'Something random' }), '', null)
    assert.equal(result.courseName, 'Unknown course')
    assert.ok(result.courseExternalId === 'name:unknown course' || result.courseExternalId.startsWith('feed:'))
  })

  it('Canvas takes priority over bracket alone', () => {
    // Both Canvas URL and bracket present — canvas wins with bracket as name
    const result = extractCourse(
      evt({
        description: 'https://canvas.example.edu/courses/55555',
        summary: 'Quiz [CS 3340]',
      }),
      '', null
    )
    assert.equal(result.courseExternalId, 'canvas:55555')
  })
})

// ── parseAndExpand ────────────────────────────────────────────────────────────

describe('parseAndExpand', () => {
  it('returns empty occurrences for an empty feed', () => {
    const { occurrences } = parseAndExpand(ics())
    assert.equal(occurrences.length, 0)
  })

  it('throws when the text is an HTML login page', () => {
    assert.throws(
      () => parseAndExpand('<html><body>Login required</body></html>'),
      /BEGIN:VCALENDAR/
    )
  })

  it('extracts a Canvas VEVENT into a normalized occurrence', () => {
    const feed = ics(vevent({
      UID: 'hw1@canvas.example.edu',
      SUMMARY: 'Homework 1 [CS 3340]',
      DTSTART: '20260901T120000Z',
      DTEND: '20260901T235900Z',
      URL: 'https://canvas.example.edu/courses/12345/assignments/67890',
    }))
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences.length, 1)
    const occ = occurrences[0]
    assert.equal(occ.uid, 'hw1@canvas.example.edu')
    assert.equal(occ.title, 'Homework 1 [CS 3340]')
    assert.equal(occ.courseExternalId, 'canvas:12345')
    assert.equal(occ.sourceUrl, 'https://canvas.example.edu/courses/12345/assignments/67890')
    assert.ok(occ.dueAt.startsWith('2026-09-01'))
  })

  it('uses DUE (not DTEND) for VTODO dueAt', () => {
    const feed = ics(vtodo({
      UID: 'todo1@test',
      SUMMARY: 'Problem Set 3',
      DTSTART: '20260901T000000Z',
      DUE: '20260908T235900Z',
    }))
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences.length, 1)
    assert.ok(occurrences[0].dueAt.startsWith('2026-09-08'))
  })

  it('builds bracketToCanvasId map so bracket-only events share the same course row', () => {
    // First event seeds the map (Canvas URL + bracket)
    // Second event (no URL) should resolve to the same canvas:<id>
    const feed = ics(
      vevent({
        UID: 'hw1@canvas',
        SUMMARY: 'HW 1 [CS 3340]',
        DTSTART: '20260901T120000Z',
        DTEND: '20260901T235900Z',
        URL: 'https://canvas.example.edu/courses/12345/assignments/1',
      }),
      vevent({
        UID: 'ann1@canvas',
        SUMMARY: 'Announcement [CS 3340]',
        DTSTART: '20260902T090000Z',
        DTEND: '20260902T100000Z',
      })
    )
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences.length, 2)
    assert.equal(occurrences[0].courseExternalId, 'canvas:12345')
    assert.equal(occurrences[1].courseExternalId, 'canvas:12345')
  })

  it('appends URL to description when URL is absent from description body', () => {
    const feed = ics(vevent({
      UID: 'x@test',
      SUMMARY: 'Quiz',
      DTSTART: '20260901T120000Z',
      DTEND: '20260901T130000Z',
      URL: 'https://canvas.example.edu/courses/1/assignments/2',
      DESCRIPTION: 'Review chapters 1-3',
    }))
    const { occurrences } = parseAndExpand(feed)
    assert.ok(occurrences[0].description.includes('https://canvas.example.edu/courses/1/assignments/2'))
  })

  it('passes calendarName through from X-WR-CALNAME', () => {
    const feed = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Spring 2026',
      vevent({ UID: 'x@test', SUMMARY: 'Quiz', DTSTART: '20260901T120000Z', DTEND: '20260901T130000Z' }),
      'END:VCALENDAR',
    ].join(CRLF) + CRLF
    const { calendarName, occurrences } = parseAndExpand(feed)
    assert.equal(calendarName, 'Spring 2026')
    assert.equal(occurrences.length, 1)
  })

  it('uses feedLabel option for course identification', () => {
    const feed = ics(vevent({
      UID: 'x@test',
      SUMMARY: 'Lecture',
      DTSTART: '20260901T120000Z',
      DTEND: '20260901T130000Z',
    }))
    const { occurrences } = parseAndExpand(feed, { feedLabel: 'Operating Systems' })
    assert.equal(occurrences[0].courseExternalId, 'label:operating systems')
    assert.equal(occurrences[0].courseName, 'Operating Systems')
  })

  it('gives each occurrence a uid derived from event UID', () => {
    const feed = ics(vevent({
      UID: 'unique-id-123@lms',
      SUMMARY: 'Assignment',
      DTSTART: '20260901T120000Z',
      DTEND: '20260901T130000Z',
    }))
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences[0].uid, 'unique-id-123@lms')
  })
})

// Regression guard for the RRULE-expansion DoS: a hostile feed must not be able
// to make one recurring event explode into a huge number of occurrences (which
// would pin the event loop / exhaust memory on the shared server). See the
// sub-daily skip + occurrence cap in expandEvent.
describe('parseAndExpand — RRULE expansion is bounded (DoS guard)', () => {
  const recurring = (rrule) => ics(vevent({
    UID: 'rec@test',
    SUMMARY: 'Recurring',
    DTSTART: '20260101T000000Z',
    DTEND: '20260101T010000Z',
    RRULE: rrule,
  }))

  for (const freq of ['SECONDLY', 'MINUTELY', 'HOURLY']) {
    it(`collapses sub-daily FREQ=${freq} to a single occurrence (no explosion)`, () => {
      const t0 = process.hrtime.bigint()
      const { occurrences } = parseAndExpand(recurring(`FREQ=${freq}`))
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      assert.equal(occurrences.length, 1)
      assert.ok(ms < 2000, `expansion took ${ms}ms — should be near-instant`)
    })
  }

  it('bounds an unbounded high-COUNT daily rule to the occurrence cap', () => {
    const { occurrences } = parseAndExpand(recurring('FREQ=DAILY;COUNT=999999'))
    assert.ok(occurrences.length > 0, 'legit daily rule should still expand')
    assert.ok(occurrences.length <= 1000, `expected <= 1000, got ${occurrences.length}`)
  })

  it('still expands a legitimate weekly rule normally', () => {
    const { occurrences } = parseAndExpand(recurring('FREQ=WEEKLY'))
    assert.ok(occurrences.length > 1 && occurrences.length <= 1000)
  })
})

// ── normalizeOccurrence — field shaping ──────────────────────────────────────
// The writer compares these fields verbatim to decide insert / update /
// unchanged, so their exact shape (null vs '' vs truncated) is load-bearing.

describe('parseAndExpand — occurrence field shaping', () => {
  const base = { UID: 'shape@test', DTSTART: '20260901T120000Z', DTEND: '20260901T130000Z' }

  it('falls back to "Untitled assignment" when SUMMARY is missing', () => {
    const { occurrences } = parseAndExpand(ics(vevent(base)))
    assert.equal(occurrences.length, 1)
    assert.equal(occurrences[0].title, 'Untitled assignment')
  })

  it('trims whitespace off the title', () => {
    const { occurrences } = parseAndExpand(ics(vevent({ ...base, SUMMARY: '   Quiz 2   ' })))
    assert.equal(occurrences[0].title, 'Quiz 2')
  })

  it('emits null (not "") for an absent description and sourceUrl', () => {
    const { occurrences } = parseAndExpand(ics(vevent(base)))
    assert.equal(occurrences[0].description, null)
    assert.equal(occurrences[0].sourceUrl, null)
  })

  it('does not append the URL twice when the description already contains it', () => {
    const url = 'https://lms.example.edu/a/1'
    const { occurrences } = parseAndExpand(ics(vevent({
      ...base, SUMMARY: 'HW', URL: url, DESCRIPTION: `Read the brief at ${url} first`,
    })))
    assert.equal(occurrences[0].description, `Read the brief at ${url} first`)
    assert.equal(occurrences[0].description.match(/lms\.example\.edu/g).length, 1)
  })

  it('truncates a huge description to 16KB with an ellipsis', () => {
    const { occurrences } = parseAndExpand(ics(vevent({
      ...base, SUMMARY: 'HW', DESCRIPTION: 'y'.repeat(40_000),
    })))
    const desc = occurrences[0].description
    assert.equal(desc.length, 16 * 1024)
    assert.ok(desc.endsWith('...'))
  })

  it('marks a single (non-recurring) event isRecurring:false', () => {
    const { occurrences } = parseAndExpand(ics(vevent({ ...base, SUMMARY: 'HW' })))
    assert.equal(occurrences[0].isRecurring, false)
  })

  it('drops an event that carries no usable date at all', () => {
    const { occurrences } = parseAndExpand(ics(vevent({ UID: 'nodate@test', SUMMARY: 'Someday' })))
    assert.equal(occurrences.length, 0)
  })

  it('keeps a date-only (VALUE=DATE) event as a single occurrence with a valid dueAt', () => {
    const feed = ['BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:allday@test', 'SUMMARY:Reading day', 'DTSTART;VALUE=DATE:20260901', 'END:VEVENT',
      'END:VCALENDAR'].join(CRLF) + CRLF
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences.length, 1)
    assert.ok(!Number.isNaN(Date.parse(occurrences[0].dueAt)))
  })

  it('uses DUE for a VTODO that has no DTSTART', () => {
    const { occurrences } = parseAndExpand(ics(vtodo({ UID: 'todo@test', SUMMARY: 'Essay', DUE: '20260908T235900Z' })))
    assert.equal(occurrences.length, 1)
    assert.equal(occurrences[0].dueAt, '2026-09-08T23:59:00.000Z')
  })

  it('unescapes commas and semicolons in X-WR-CALNAME', () => {
    const feed = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Fall 2026\\, Section 1', 'END:VCALENDAR'].join(CRLF) + CRLF
    assert.equal(parseIcsBuffer(feed).calendarName, 'Fall 2026, Section 1')
  })
})

// ── RRULE expansion — identity of the expanded occurrences ───────────────────
// The writer relies on both of these: unique UIDs keep the occurrences off each
// other's unique index, and isRecurring excludes them from the content-based
// rotated-UID dedupe (many same-titled rows would be ambiguous).

describe('parseAndExpand — recurring occurrence identity', () => {
  // Anchor the series inside the [now-30d, now+365d] expansion window.
  const soon = new Date(Date.now() + 7 * 86_400_000)
  const stamp = soon.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const feed = ics(vevent({
    UID: 'series@test', SUMMARY: 'Weekly lab', DTSTART: stamp, DTEND: stamp, RRULE: 'FREQ=WEEKLY;COUNT=3',
  }))

  it('gives every occurrence a distinct uid derived from the base UID + instant', () => {
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences.length, 3)
    for (const occ of occurrences) assert.ok(occ.uid.startsWith('series@test@'))
    assert.equal(new Set(occurrences.map((o) => o.uid)).size, 3)
  })

  it('flags every expanded occurrence isRecurring:true', () => {
    const { occurrences } = parseAndExpand(feed)
    assert.deepEqual(occurrences.map((o) => o.isRecurring), [true, true, true])
  })

  it('keeps the whole series under one course', () => {
    const { occurrences } = parseAndExpand(feed, { feedLabel: 'Physics Lab' })
    assert.equal(new Set(occurrences.map((o) => o.courseExternalId)).size, 1)
    assert.equal(occurrences[0].courseExternalId, 'label:physics lab')
  })
})

// ── multi-course feeds ───────────────────────────────────────────────────────

describe('parseAndExpand — multiple courses in one feed', () => {
  it('splits occurrences across the courses their events identify', () => {
    const feed = ics(
      vevent({ UID: 'a@t', SUMMARY: 'HW 1 [CS 3340]', DTSTART: '20260901T120000Z', DTEND: '20260901T130000Z' }),
      vevent({ UID: 'b@t', SUMMARY: 'Quiz [MATH 2418]', DTSTART: '20260902T120000Z', DTEND: '20260902T130000Z' }),
      vevent({ UID: 'c@t', SUMMARY: 'HW 2 [CS 3340]', DTSTART: '20260903T120000Z', DTEND: '20260903T130000Z' })
    )
    const { occurrences } = parseAndExpand(feed)
    assert.equal(occurrences.length, 3)
    assert.deepEqual(
      occurrences.map((o) => o.courseExternalId),
      ['name:cs 3340', 'name:math 2418', 'name:cs 3340']
    )
  })

  it('does not let feedLabel override a course identified by the event itself', () => {
    const feed = ics(vevent({
      UID: 'a@t', SUMMARY: 'HW 1 [CS 3340]', DTSTART: '20260901T120000Z', DTEND: '20260901T130000Z',
    }))
    const { occurrences } = parseAndExpand(feed, { feedLabel: 'Whatever the user typed' })
    assert.equal(occurrences[0].courseExternalId, 'name:cs 3340')
  })
})
