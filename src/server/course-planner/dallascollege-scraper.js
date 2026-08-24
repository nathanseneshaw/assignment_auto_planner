/**
 * Dallas College scraper — Continuing Education / Workforce catalog.
 *
 * Dallas College runs Ellucian Colleague Self-Service with a guest "Course
 * Catalog" search (no login) at selfsrv.dcccd.edu/Student/Courses, so all logic
 * lives in the shared colleague factory and this file only pins the host.
 * Full enrollment (capacity / enrolled / available), meeting times, rooms and
 * instructors are public.
 *
 * IMPORTANT — this instance carries **Continuing Education only**. Verified
 * 2026-08-22 against the live host: filtering the catalog by academic level
 * returns 0 sections for "CR" (Credit) and every section for "CE" across all
 * three published terms (2026SP 2175, 2026SU 1247, 2026FA 978), and every
 * section prices in CEUs rather than credit hours. The academic-transfer
 * catalog (MATH 1314, ENGL 1301, GOVT 2305 …) is NOT here — Dallas College
 * moved credit to Workday Student, whose public face is the WAF-gated
 * schedule.dallascollege.edu. See scraper-status.md for that path's findings.
 *
 * Two per-school data notes, both properties of the source rather than parser
 * gaps:
 *   - CourseName prints as "ITSC-1001" (hyphen) where TWU prints "MKT*3113";
 *     the factory splits on either separator.
 *   - `credits` is always null. Colleague populates `Ceus` (e.g. 3.2) and
 *     leaves MinimumCredits null for every section, and CEUs are not credit
 *     hours — reporting them as `credits` would misstate the course.
 */
import { createColleagueScraper } from './colleague.js'
import { stripLeadingCode } from './util.js'

const impl = createColleagueScraper({
  school: 'dallascollege',
  base: 'https://selfsrv.dcccd.edu',
})

export const getTerms = impl.getTerms
export const getSections = impl.getSections

/**
 * Roughly half of Dallas College's subject descriptions repeat the subject code
 * they're already keyed by, with an inconsistent separator: "ACNT Accounting-
 * WECM", "AERM -Aircraft MechaniTech-CE", "ARTZ - Art - CE". The picker renders
 * subjects as "CODE · label", so left alone they read "ACNT · ACNT
 * Accounting-WECM" (see stripLeadingCode in util.js).
 */
export async function getSubjects(termCode) {
  const subjects = await impl.getSubjects(termCode)
  return subjects.map((s) => ({ code: s.code, label: stripLeadingCode(s.code, s.label) }))
}
