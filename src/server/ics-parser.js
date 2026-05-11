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

/** Pull X-WR-CALNAME from the raw text — node-ical exposes it inconsistently. */
function readCalendarName(text) {
  const m = text.match(/^X-WR-CALNAME:(.+)$/m)
  if (!m) return ''
  return m[1].trim().replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ')
}

/**
 * Heuristically extract { courseExternalId, courseName } from an event.
 * Order: Canvas /courses/<id> URL → [bracket] in SUMMARY → CATEGORIES → X-WR-CALNAME → 'Unknown course'.
 *
 * bracketToCanvasId is an optional Map<bracketNameLower, canvasNumericId> built by
 * parseAndExpand in a first pass. It lets bracket-name-only events (e.g. calendar
 * announcements) resolve to the same canvas:<id> as assignment events for the same
 * course, preventing duplicate course rows.
 */
export function extractCourse(event, calendarName, bracketToCanvasId) {
  const summary = stringOf(event.summary)
  const description = stringOf(event.description)
  const url = stringOf(event.url)

  // 1. Canvas: /courses/<id> in DESCRIPTION or URL is the most stable id
  const canvasMatch = (description + ' ' + url).match(/\/courses\/(\d+)/)
  if (canvasMatch) {
    const bracketName = extractBracketName(summary)
    return {
      courseExternalId: `canvas:${canvasMatch[1]}`,
      courseName: bracketName || calendarName || `Canvas course ${canvasMatch[1]}`,
    }
  }

  // 2. SUMMARY with [Course Code] suffix or prefix (Canvas convention).
  // If a prior event already mapped this bracket name to a canvas course id, reuse
  // that id so both event types land in the same course row.
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

  // 3. CATEGORIES (Brightspace / Blackboard Ultra often populate this)
  const categories = readCategories(event)
  if (categories.length > 0) {
    const name = categories[0]
    return {
      courseExternalId: `name:${name.toLowerCase()}`,
      courseName: name,
    }
  }

  // 4. Calendar-level name (typical for per-course feeds)
  if (calendarName) {
    return {
      courseExternalId: `cal:${calendarName.toLowerCase()}`,
      courseName: calendarName,
    }
  }

  // 5. Fallback bucket
  return {
    courseExternalId: 'name:unknown course',
    courseName: 'Unknown course',
  }
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
export function expandEvent(event, calendarName, bracketToCanvasId) {
  const course = extractCourse(event, calendarName, bracketToCanvasId)
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
        const overrideCourse = extractCourse(override, calendarName, bracketToCanvasId)
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
export function parseAndExpand(text) {
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
    for (const occ of expandEvent(ev, calendarName, bracketToCanvasId)) out.push(occ)
  }
  return { calendarName, occurrences: out }
}
