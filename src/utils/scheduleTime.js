/**
 * Shared day/time helpers for the Course Planner page and the schedule
 * combination engine. Framework-free on purpose so `node --test` can exercise
 * everything directly.
 *
 * Day codes are single letters: M T W R F S U (R = Thursday, U = Sunday).
 */

export const DAYS = [
  { code: 'M', label: 'Mon' },
  { code: 'T', label: 'Tue' },
  { code: 'W', label: 'Wed' },
  { code: 'R', label: 'Thu' },
  { code: 'F', label: 'Fri' },
  { code: 'S', label: 'Sat' },
  { code: 'U', label: 'Sun' },
]

export function formatHour(h) {
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hh}${h < 12 ? 'am' : 'pm'}`
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

export function meetingSummary(meetings) {
  if (!meetings || !meetings.length) return 'TBA'
  return meetings
    .filter((m) => m.startTime && m.endTime)
    .map((m) => `${(m.days || []).map(dayLong).join(',')}, ${formatClock(m.startTime)}–${formatClock(m.endTime)}`)
    .join(' • ') || 'TBA'
}

export function dayLong(c) {
  return { M: 'M', T: 'Tu', W: 'W', R: 'Th', F: 'F', S: 'Sa', U: 'Su' }[c] || c
}

export function formatClock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  const suf = h < 12 ? 'am' : 'pm'
  return `${hh}:${String(m).padStart(2, '0')}${suf}`
}

/** Half-open interval overlap; touching endpoints do not overlap. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}
