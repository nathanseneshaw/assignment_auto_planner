/**
 * Normalizes Blackboard course list titles that mix the real title with
 * instructor, announcements, and term codes from the portal UI.
 */

/** @param {string} raw */
export function extractInstructorFromBlackboardRaw(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const m = raw.match(/\bInstructor:\s*([^;]+)/i)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

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

/**
 * True if visible text plausibly names a university course (filters announcement links, etc.).
 * @param {string} text
 */
export function looksLikeBlackboardCourseListEntry(text) {
  if (!text || typeof text !== 'string') return false
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 8 || t.length > 500) return false
  // Course code is the strongest signal (before generic "announcement-looking" checks)
  if (/\b[A-Z]{2,10}\s+\d{4}(?:\.\d{2,4})?\b/i.test(t)) return true
  if (/\b[A-Z]{2,10}-\d{3,5}(?:-\d{2,4}[A-Z]?)?\b/i.test(t)) return true
  if (/^(book|click|please|view|read)\s+a\s+/i.test(t)) return false
  if (/\bAnnouncements?\s*:/i.test(t)) return false
  return false
}

/** True if two titles refer to the same Blackboard course after normalizing cruft. */
export function blackboardCourseTitlesLooselyEqual(a, b) {
  if (a == null || b == null) return false
  const sa = String(a).trim()
  const sb = String(b).trim()
  if (!sa || !sb) return false
  if (sa === sb) return true
  return sanitizeBlackboardCourseDisplayName(sa) === sanitizeBlackboardCourseDisplayName(sb)
}

/**
 * @param {string} name raw or pre-cleaned course list title
 * @returns {{ code: string, term: string, instructor: string, shortName: string }}
 */
export function parseBlackboardCourseDisplayFields(name) {
  const raw = String(name || '')
  const instructorLabel = extractInstructorFromBlackboardRaw(raw)
  const cleaned = sanitizeBlackboardCourseDisplayName(raw)

  const codeHyphen = cleaned.match(
    /\b([A-Z]{2,10})-(\d{3,5})(-(\d{2,4}[A-Z]?))?\b/i
  )
  const codeSpace = cleaned.match(/\b([A-Z]{2,10})\s+(\d{4}(?:\.\d{2,4})?)\b/i)
  let code = ''
  if (codeHyphen) code = codeHyphen[0]
  else if (codeSpace) code = codeSpace[0]

  const termMatch = cleaned.match(/\b(Spring|Summer|Fall|Winter)\s+(\d{4})\b/i)
  const term = termMatch ? `${termMatch[1]} ${termMatch[2]}` : ''

  let instructorComma = ''
  const parts = cleaned.split(',').map((p) => p.trim())
  if (parts.length >= 2 && !/^(Spring|Summer|Fall|Winter)/i.test(parts[1])) {
    instructorComma = parts[1]
  }

  const instructor = instructorLabel || instructorComma
  return {
    code,
    term,
    instructor,
    shortName: cleaned,
  }
}
