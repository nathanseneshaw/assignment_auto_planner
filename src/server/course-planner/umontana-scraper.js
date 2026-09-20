/**
 * University of Montana scraper.
 *
 * UM runs its Banner 9 Student Registration SSB on Ellucian's cloud
 * (reg-prod.ec.umt.edu), the same JSON API as Texas Tech / Northeastern, so the
 * shared factory does the work. Full seat counts + meeting times + instructors.
 *
 * One UM specific: its term list carries "School of Law Autumn 2026" (202675)
 * BEFORE the main-campus "Autumn Semester 2026" (202670). Both normalize to
 * "Fall 2026" and the term-window dedup keeps the first listed, so without this
 * filter the whole school would bind to the Law catalog - the same shadowing
 * pattern the TTU / TAMU / Baylor / UTRGV audit fixed. No current/next trimming
 * here; that stays in term-window.js.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'umontana',
  base: 'https://reg-prod.ec.umt.edu',
})

export async function getTerms() {
  const terms = await impl.getTerms()
  return terms.filter((t) => !/\bSchool of Law\b/i.test(t.label))
}

export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
