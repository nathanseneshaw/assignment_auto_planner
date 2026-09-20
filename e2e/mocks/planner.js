/**
 * Shared fixtures for the Planner / ICS-feeds / syllabus-import specs.
 *
 * Two kinds of thing live here:
 *
 *  1. Backend payload builders. Every shape below is copied from the real
 *     Express handlers so a stub can never drift from the server:
 *       - `ics_feeds` rows come from the select list in
 *         `src/server/ics-routes.js` (GET/POST /api/ics/feeds).
 *       - the sync envelope comes from POST /api/ics/sync in the same file.
 *       - the syllabus draft/meta envelope comes from POST /api/syllabus/parse
 *         in `src/server/syllabus-routes.js`.
 *
 *  2. Calendar label helpers. The Planner renders its headings from `new Date()`,
 *     so a spec must derive the expected string the same way rather than
 *     hard-coding a month. All of these take a day/month offset from today.
 *
 * Note for future readers: under `.env.e2e` Supabase is unconfigured, so
 * `icsService` / `syllabusService` throw their "Supabase is not configured"
 * guard before any of these endpoints is ever requested. The payload builders
 * are kept anyway - they are what the stubs must return the moment a signed-in
 * session becomes reachable at this level, and they document the contract.
 */

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

/** The client-side guard both ICS and syllabus calls hit in local-only mode. */
export const NO_SUPABASE_ERROR = 'Supabase is not configured'

// ── Calendar label helpers ───────────────────────────────────────────────────

/** `Date` for today plus `offset` days, normalised to midnight local time. */
export function dateAt(offset = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}

/** The `<h1>` the day view renders, e.g. "Thursday, September 3". */
export function dayHeading(offset = 0) {
  const d = dateAt(offset)
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`
}

/** The `<h1>` the month view renders, e.g. "September 2026". */
export function monthHeading(offset = 0) {
  const d = new Date()
  const anchor = new Date(d.getFullYear(), d.getMonth() + offset, 1)
  return `${MONTHS_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`
}

/**
 * The accessible name of a month-cell "add" button, e.g.
 * "Add task on Thursday 3". Only in-month cells render one, which makes the
 * day number unambiguous inside the 42-cell grid.
 */
export function addTaskCellLabel(offset = 0) {
  const d = dateAt(offset)
  return `Add task on ${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()}`
}

// ── Backend payload builders ─────────────────────────────────────────────────

/**
 * One `ics_feeds` row, exactly the columns the server selects.
 * `last_sync_status` is 'pending' on insert and 'ok' / 'error' after a sync.
 */
export function makeIcsFeed(overrides = {}) {
  return {
    id: 'feed-1',
    url: 'https://canvas.instructure.com/feeds/calendars/user_abc123.ics',
    label: null,
    last_synced_at: null,
    last_sync_status: 'pending',
    last_sync_error: null,
    created_at: '2026-01-05T09:00:00.000Z',
    ...overrides,
  }
}

/** GET /api/ics/feeds */
export function icsFeedsResponse(feeds = []) {
  return { success: true, feeds }
}

/** POST /api/ics/feeds */
export function icsFeedCreatedResponse(feed) {
  return { success: true, feed }
}

/** POST /api/ics/sync */
export function icsSyncResponse({ feeds = [], changed = true, totals = {} } = {}) {
  return {
    success: true,
    syncedFeeds: feeds.length,
    changed,
    totals: {
      coursesInserted: 0,
      coursesUpdated: 0,
      assignmentsInserted: 0,
      assignmentsUpdated: 0,
      assignmentsArchived: 0,
      ...totals,
    },
    results: feeds.map((f) => ({ feedId: f.id, url: f.url, status: 'ok' })),
    feeds,
  }
}

/** POST /api/syllabus/parse */
export function syllabusParseResponse({ course = {}, assignments = [], truncated = false } = {}) {
  const draft = {
    course: {
      name: 'Introduction to Algorithms',
      code: 'CS 3340',
      term: 'Fall 2026',
      instructor: 'Dr. Ada Lovelace',
      ...course,
    },
    assignments,
  }
  return {
    success: true,
    draft,
    meta: {
      textLength: 24_000,
      truncated,
      assignmentCount: draft.assignments.length,
    },
  }
}

// ── Upload fixtures ──────────────────────────────────────────────────────────

/**
 * The smallest thing the browser will hand over as a PDF. The component only
 * checks the extension and the 5 MB ceiling before uploading, so an in-memory
 * buffer spares the repo a binary fixture file.
 */
export function pdfUpload(name = 'syllabus.pdf') {
  return {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
  }
}

/** A file the picker accepts but the component must reject on extension. */
export function unsupportedUpload(name = 'syllabus.txt') {
  return {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from('Week 1: read chapter one.'),
  }
}
