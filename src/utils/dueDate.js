/**
 * Conversions between the instant Supabase stores (`assignments.due_at`, a
 * timestamptz) and the `YYYY-MM-DD` key every screen in the app buckets by.
 *
 * The rule the whole app follows: a due instant belongs to the calendar day it
 * falls on **in the viewer's local timezone**. Canvas exports an assignment due
 * 11:59 PM CDT as 04:59Z the following morning, so reading that instant with UTC
 * getters (what `toISOString().slice(0, 10)` does) files it a day late. Every
 * calendar/date helper in the app builds its keys from local getters, so the
 * conversion here has to match or rows land in the wrong cell.
 *
 * The exception is an all-day item, which names a calendar date and carries no
 * time at all. Those are stored at exactly `00:00:00.000Z` and read back with UTC
 * getters, so they show the same day for every viewer regardless of timezone.
 * The cost of that marker: a real due time landing on exactly midnight UTC (7 PM
 * Eastern, to the second) is read as all-day. LMS due times cluster at 11:59 PM
 * local, so in practice it does not fire.
 *
 * Framework-free on purpose so `node --test` can exercise it directly.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function pad(n) {
  return String(n).padStart(2, '0')
}

/** `YYYY-MM-DD` for a Date's **local** calendar day (defaults to today). */
export function localDateKey(date) {
  const d = date instanceof Date ? date : date == null ? new Date() : new Date(date)
  const base = Number.isNaN(d.getTime()) ? new Date() : d
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

/** `YYYY-MM-DD` for a Date's **UTC** calendar day. */
export function utcDateKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** True for a bare `YYYY-MM-DD`: the shape the date pickers and stores hold. */
export function isDateOnlyKey(value) {
  return typeof value === 'string' && DATE_ONLY_RE.test(value.trim())
}

/**
 * True when an instant sits exactly on midnight UTC, the marker this app uses
 * for "a calendar date with no time" (all-day feed events, and dates the user
 * picked by hand).
 */
export function isDateOnlyInstant(date) {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  )
}

/**
 * Supabase `due_at` → the `YYYY-MM-DD` key the UI buckets by.
 * Bad/missing input falls back to today so a malformed row can't crash the grid.
 */
export function dueDateKeyFromInstant(dueAt) {
  if (!dueAt) return localDateKey()
  if (isDateOnlyKey(dueAt)) return dueAt.trim()
  const d = new Date(dueAt)
  if (Number.isNaN(d.getTime())) return localDateKey()
  return isDateOnlyInstant(d) ? utcDateKey(d) : localDateKey(d)
}

/**
 * A store `dueAt` / `dueDate` → the ISO instant to write to `due_at`.
 * A bare date key becomes midnight UTC (the date-only marker {@link
 * dueDateKeyFromInstant} reads back); anything else keeps its exact instant, so
 * a feed's real due time survives an unrelated edit such as marking it done.
 */
export function dueAtFromDueDate(due) {
  if (!due) return new Date().toISOString()
  if (isDateOnlyKey(due)) return `${due.trim()}T00:00:00.000Z`
  const d = new Date(due)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
