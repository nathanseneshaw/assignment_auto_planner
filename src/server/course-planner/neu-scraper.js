/**
 * Northeastern University scraper.
 *
 * NEU runs a public Banner 9 Student Registration SSB at nubanner.neu.edu -
 * the exact same JSON API as Texas Tech / Georgia Tech, so the shared
 * banner-ssb factory does the work. Full seat counts + meeting times +
 * instructors.
 *
 * NEU's term list interleaves College of Professional Studies quarter terms
 * ("Summer 2026 CPS Quarter") and Law terms with the main semesters. Those
 * parse to the same Season+Year as the real semester and can shadow it in the
 * term-window dedup, so getTerms keeps only the plain "<Season> <Year>
 * Semester" terms. No current/next trimming here - that stays in
 * term-window.js.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'neu',
  base: 'https://nubanner.neu.edu',
})

export async function getTerms() {
  const terms = await impl.getTerms()
  return terms.filter((t) => !/\b(CPS|Law)\b/i.test(t.label))
}

export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
