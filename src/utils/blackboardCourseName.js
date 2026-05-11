/**
 * Normalizes Blackboard course list titles that mix the real title with
 * instructor, announcements, and term codes from the portal UI.
 */

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeBlackboardCourseDisplayName(raw) {
  if (raw == null || typeof raw !== 'string') return ''
  let s = raw.replace(/\s+/g, ' ').trim()
  const semiAnn = s.search(/;\s*Announcements?\s*:/i)
  if (semiAnn >= 0) s = s.slice(0, semiAnn).trim()
  const cutMarkers = [
    /\s+Instructor\s*:/i,
    /\s+Instructors\s*:/i,
    /\s+Announcement\s*:/i,
    /\s+Announcements\s*:/i,
  ]
  for (const re of cutMarkers) {
    const idx = s.search(re)
    if (idx >= 0) s = s.slice(0, idx).trim()
  }
  // Trailing section/term tokens often appended by Learn, e.g. " - S26", " - F25"
  s = s.replace(/\s+-\s+([A-Z]{1,4}\d{2,4})\s*$/i, '').trim()
  return s
}
