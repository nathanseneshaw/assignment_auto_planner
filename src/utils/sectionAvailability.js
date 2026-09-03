/**
 * Section availability: the single answer to "can a student actually register
 * for this?" Shared by the Course Planner store, the browse list, the Builder
 * panel and the combo engine so all four agree on what counts as takeable.
 *
 * No Vue, Pinia, DOM or storage imports - pure functions over Section objects.
 *
 * Deliberately conservative: 'unknown' status with no seat data is treated as
 * AVAILABLE. Plenty of schools publish no enrollment data at all (MIT, UTD,
 * Cornell...), and hiding their whole catalogue would be far worse than showing
 * a section that turns out to be full.
 */

/** 'closed' | 'full' | null - null means the student can still register. */
export function sectionUnavailable(section) {
  if (section?.status === 'closed') return 'closed'
  const enr = section?.enrollment || {}
  if (enr.available != null && enr.available <= 0) return 'full'
  if (enr.max != null && enr.current != null && enr.current >= enr.max) return 'full'
  return null
}

/** Convenience inverse of sectionUnavailable(). */
export function isSectionAvailable(section) {
  return sectionUnavailable(section) === null
}

/**
 * Group a subject's sections into courses, in first-seen order.
 *
 * `available` counts the sections a student could actually register for, so a
 * course with `available === 0` is a dead course: it appears in the catalogue
 * for the term but every one of its sections is full or closed. Those are the
 * rows the planner hides by default.
 *
 * Returns [{ courseNumber, first, sections, available }].
 */
export function groupSectionsByCourse(sections) {
  const map = new Map()
  for (const s of sections || []) {
    const key = s.courseNumber
    if (!map.has(key)) {
      map.set(key, { courseNumber: key, first: s, sections: [], available: 0 })
    }
    const group = map.get(key)
    group.sections.push(s)
    if (isSectionAvailable(s)) group.available++
  }
  return [...map.values()]
}
