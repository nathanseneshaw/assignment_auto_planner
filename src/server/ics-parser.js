import ical from 'node-ical'

const DESCRIPTION_MAX = 16 * 1024
const RRULE_PAST_DAYS = 30
const RRULE_FUTURE_DAYS = 365

/**
 * Parse an ICS text body into { calendarName, events }.
 * Throws if the body does not look like an iCalendar feed (LMS often returns an HTML login page).
 */
export function parseIcsBuffer(text) {
  const trimmed = (text || '').replace(/^﻿/, '').trimStart()
  if (!/^BEGIN:VCALENDAR/i.test(trimmed)) {
    throw new Error('Response is not an iCalendar feed (BEGIN:VCALENDAR missing). The URL may require login.')
  }

  const data = ical.parseICS(trimmed)
  const calendarName = readCalendarName(trimmed)

  const events = []
  for (const key of Object.keys(data)) {
    const item = data[key]
    if (!item || (item.type !== 'VEVENT' && item.type !== 'VTODO')) continue
    events.push(item)
  }
  return { calendarName, events }
}

/** Pull X-WR-CALNAME from the raw text  node-ical exposes it inconsistently. */
function readCalendarName(text) {
  const m = text.match(/^X-WR-CALNAME:(.+)$/m)
  if (!m) return ''
  return m[1].trim().replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ')
}

/**
 * Heuristically extract { courseExternalId, courseName } from an event.
 *
 * Priority:
 *   1. Canvas /courses/<numeric-id>          → canvas:<id>
 *   2. Blackboard course_id=_xxx_x           → bb:<id>
 *   3. [Bracket] in SUMMARY (Canvas style)   → canvas:<id> via map, else name:<bracket>
 *   4. "Course: ..." line in DESCRIPTION     → name:<line>     (Blackboard classic)
 *   5. CATEGORIES                            → name:<category> (Brightspace, BB Ultra)
 *   6. Course code in SUMMARY (e.g. CS 3340) → name:<code>     (fallback heuristic)
 *   7. X-WR-CALNAME                          → cal:<name>
 *   8. 'Unknown course'
 *
 * bracketToCanvasId is an optional Map<bracketNameLower, canvasNumericId> built by
 * parseAndExpand in a first pass. It lets bracket-name-only events (e.g. calendar
 * announcements) resolve to the same canvas:<id> as assignment events for the same
 * course, preventing duplicate course rows.
 */
export function extractCourse(event, calendarName, bracketToCanvasId, opts = {}) {
  const feedLabel = opts.feedLabel ? String(opts.feedLabel).trim() : ''
  const feedId = opts.feedId || ''

  const summary = stringOf(event.summary)
  const description = stringOf(event.description)
  const url = stringOf(event.url)
  const location = stringOf(event.location)
  const haystack = `${description} ${url} ${location}`

  // 1. Canvas: /courses/<numeric-id> in DESCRIPTION/URL/LOCATION
  const canvasMatch = haystack.match(/\/courses\/(\d+)/)
  if (canvasMatch) {
    const bracketName = extractBracketName(summary)
    return {
      courseExternalId: `canvas:${canvasMatch[1]}`,
      courseName: bracketName || calendarName || `Canvas course ${canvasMatch[1]}`,
    }
  }

  // 2. Blackboard: course_id=_NNNN_N (classic) or /ultra/courses/_NNNN_N/ (Ultra).
  // Blackboard's internal id format uses underscores, so the Canvas regex above
  // intentionally won't match these.
  const bbMatch = haystack.match(/course_id=(_\d+_\d+)|\/courses\/(_\d+_\d+)/)
  if (bbMatch) {
    const bbId = bbMatch[1] || bbMatch[2]
    const fromDesc = extractCourseLineFromDescription(description)
    const fromCode = extractCourseCodeFromText(summary) || extractCourseCodeFromText(description)
    const bracketName = extractBracketName(summary)
    return {
      courseExternalId: `bb:${bbId}`,
      courseName: fromDesc || bracketName || fromCode || `Blackboard course ${bbId}`,
    }
  }

  // 3. [Bracket] in SUMMARY (Canvas convention).
  // If a prior event already mapped this bracket name to a canvas course id, reuse
  // it so both event types land in the same course row.
  const bracketName = extractBracketName(summary)
  if (bracketName) {
    const knownCanvasId = bracketToCanvasId?.get(bracketName.toLowerCase())
    if (knownCanvasId) {
      return {
        courseExternalId: `canvas:${knownCanvasId}`,
        courseName: bracketName,
      }
    }
    return {
      courseExternalId: `name:${bracketName.toLowerCase()}`,
      courseName: bracketName,
    }
  }

  // 4. "Course: <name>" / "Course Name: <name>" line in DESCRIPTION (Blackboard classic).
  const courseLine = extractCourseLineFromDescription(description)
  if (courseLine) {
    return {
      courseExternalId: `name:${courseLine.toLowerCase()}`,
      courseName: courseLine,
    }
  }

  // 5. CATEGORIES (Brightspace / Blackboard Ultra often populate this)
  const categories = readCategories(event)
  if (categories.length > 0) {
    const name = categories[0]
    return {
      courseExternalId: `name:${name.toLowerCase()}`,
      courseName: name,
    }
  }

  // 6. Course code anywhere in SUMMARY or DESCRIPTION (e.g. "Lab 5 - CS 3340.501").
  // This is a heuristic and may misfire on assignment titles containing digit
  // sequences, so it sits below the higher-confidence checks above.
  const code = extractCourseCodeFromText(summary) || extractCourseCodeFromText(description)
  if (code) {
    return {
      courseExternalId: `name:${code.toLowerCase()}`,
      courseName: code,
    }
  }

  // 7. User-provided feed label.
  // For per-course feeds that carry no event-level course identity (typical of
  // Blackboard gradebook feeds), the label the user entered when adding the feed
  // is the only reliable course name we have.
  if (feedLabel) {
    return {
      courseExternalId: `label:${feedLabel.toLowerCase()}`,
      courseName: feedLabel,
    }
  }

  // 8. X-WR-CALNAME. Qualified by feedId so two feeds from the same institution
  // (both X-WR-CALNAME = "University of X") don't collapse into one course row.
  if (calendarName) {
    return {
      courseExternalId: feedId ? `feed:${feedId}` : `cal:${calendarName.toLowerCase()}`,
      courseName: calendarName,
    }
  }

  // 9. Fallback bucket
  return {
    courseExternalId: feedId ? `feed:${feedId}` : 'name:unknown course',
    courseName: 'Unknown course',
  }
}

/**
 * Pull a "Course: ..." line out of an event DESCRIPTION.
 * Blackboard typically writes this as the first line of the body. Tolerates
 * "Course Name:" and strips any inline HTML node-ical left behind.
 */
function extractCourseLineFromDescription(s) {
  if (!s) return ''
  const m = s.match(/(?:^|\n)\s*Course(?:\s*Name)?\s*[:\-]\s*([^\r\n]+)/i)
  if (!m) return ''
  return m[1].replace(/<[^>]+>/g, '').trim()
}

/**
 * Find a course-code-shaped substring (e.g. "CS 3340", "MATH-2418.501").
 * Used only as a last-ditch heuristic when no structured fields identify the course.
 */
function extractCourseCodeFromText(s) {
  if (!s) return ''
  const m = s.match(/\b([A-Z]{2,5}[\s\-]?\d{3,4}(?:\.\d+)?)\b/)
  if (!m) return ''
  return m[1].trim()
}

function extractBracketName(s) {
  if (!s) return ''
  const tail = s.match(/\[([^\]]+)\]\s*$/)
  if (tail) return tail[1].trim()
  const head = s.match(/^\[([^\]]+)\]\s+/)
  if (head) return head[1].trim()
  return ''
}

function readCategories(event) {
  const c = event.categories
  if (!c) return []
  if (Array.isArray(c)) return c.map((x) => String(x).trim()).filter(Boolean)
  return String(c)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function stringOf(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && typeof v.val === 'string') return v.val
  return String(v)
}

/**
 * Normalize a non-recurring VEVENT/VTODO occurrence into the shape the writer expects.
 */
function normalizeOccurrence(event, occurrenceStart, occurrenceEnd, course, sourceUrl, uidOverride) {
  const baseUid = stringOf(event.uid) || `${stringOf(event.summary)}@${occurrenceStart?.toISOString?.() || ''}`
  const uid = uidOverride || baseUid

  const title = stringOf(event.summary).trim() || 'Untitled assignment'

  // Prefer the occurrence end (DUE/DTEND) over start for assignment due time.
  const dueAt = (occurrenceEnd || occurrenceStart || new Date()).toISOString()

  let description = stringOf(event.description)
  const eventUrl = stringOf(event.url).trim() || sourceUrl
  if (eventUrl && !description.includes(eventUrl)) {
    description = description ? `${description}\n\nLink: ${eventUrl}` : `Link: ${eventUrl}`
  }
  if (description.length > DESCRIPTION_MAX) {
    description = description.slice(0, DESCRIPTION_MAX - 3) + '...'
  }

  return {
    uid,
    title,
    dueAt,
    description: description || null,
    sourceUrl: eventUrl || null,
    courseExternalId: course.courseExternalId,
    courseName: course.courseName,
  }
}

/**
 * Coerce an ICS date value (Date | string) to a Date.
 * Handles the compact ICS form like "20260520T040000Z" which is not a valid Date() input.
 */
function toDate(v) {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const s = String(v).trim()
  // Compact ICS form: 20260520T040000Z or 20260520T040000 or 20260520
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}${m[7] || 'Z'}`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Expand a single ICS event into 1..N normalized assignment occurrences.
 * Handles RRULE-recurring events by expanding within the [now-30d, now+365d] window
 * and giving each occurrence a unique external id (so they don't collide on the
 * (user_id, external_assignment_id) unique index).
 */
export function expandEvent(event, calendarName, bracketToCanvasId, opts) {
  const course = extractCourse(event, calendarName, bracketToCanvasId, opts)
  const out = []

  const baseStart = toDate(event.start)
  // For VTODO, node-ical fabricates `end = new Date()` (current time) which is useless.
  // Prefer the real DUE field for VTODO; fall back to .end only for VEVENT.
  const baseDue = toDate(event.due)
  const baseEnd = event.type === 'VTODO' ? null : toDate(event.end)
  const effectiveEnd = baseDue || baseEnd || baseStart

  if (event.rrule) {
    const now = Date.now()
    const windowStart = new Date(now - RRULE_PAST_DAYS * 24 * 60 * 60 * 1000)
    const windowEnd = new Date(now + RRULE_FUTURE_DAYS * 24 * 60 * 60 * 1000)

    let occurrences = []
    try {
      occurrences = event.rrule.between(windowStart, windowEnd, true) || []
    } catch {
      occurrences = []
    }

    const durationMs =
      baseStart && effectiveEnd ? effectiveEnd.getTime() - baseStart.getTime() : 0

    const overrides = event.recurrences || {}

    for (const occStart of occurrences) {
      const isoKey = occStart.toISOString().slice(0, 10) // YYYY-MM-DD
      const override = overrides[isoKey]
      if (override) {
        // Override events have their own UID-ish shape; treat as a one-off.
        const ovStart = toDate(override.start)
        const ovDue = toDate(override.due)
        const ovEnd = override.type === 'VTODO' ? null : toDate(override.end)
        const overrideEnd = ovDue || ovEnd || ovStart
        const overrideCourse = extractCourse(override, calendarName, bracketToCanvasId, opts)
        const overrideUid = `${stringOf(event.uid) || 'evt'}@${occStart.toISOString()}`
        out.push(
          normalizeOccurrence(
            override,
            ovStart,
            overrideEnd,
            overrideCourse,
            stringOf(override.url) || stringOf(event.url),
            overrideUid
          )
        )
        continue
      }

      const occEnd = durationMs > 0 ? new Date(occStart.getTime() + durationMs) : occStart
      const uid = `${stringOf(event.uid) || 'evt'}@${occStart.toISOString()}`
      out.push(
        normalizeOccurrence(event, occStart, occEnd, course, stringOf(event.url), uid)
      )
    }
    return out
  }

  if (!baseStart && !effectiveEnd) return out
  out.push(normalizeOccurrence(event, baseStart, effectiveEnd, course, stringOf(event.url)))
  return out
}

/**
 * Convenience: parse the raw ICS text into a flat array of normalized occurrences.
 *
 * Runs a first pass over all events to build a bracketName→canvasId map so that
 * calendar/announcement events (which lack a /courses/ URL) resolve to the same
 * course row as assignment events for the same course.
 */
export function parseAndExpand(text, opts = {}) {
  const { calendarName, events } = parseIcsBuffer(text)

  // First pass: collect bracket-name → canvas numeric id mappings from events
  // that have both a [bracket] summary and a /courses/<id> URL.
  const bracketToCanvasId = new Map()
  for (const ev of events) {
    const canvasMatch = (stringOf(ev.description) + ' ' + stringOf(ev.url)).match(/\/courses\/(\d+)/)
    if (canvasMatch) {
      const bracket = extractBracketName(stringOf(ev.summary))
      if (bracket) bracketToCanvasId.set(bracket.toLowerCase(), canvasMatch[1])
    }
  }

  const out = []
  for (const ev of events) {
    for (const occ of expandEvent(ev, calendarName, bracketToCanvasId, opts)) out.push(occ)
  }
  return { calendarName, occurrences: out }
}
