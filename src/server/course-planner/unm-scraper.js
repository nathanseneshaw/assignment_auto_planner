/**
 * University of New Mexico scraper.
 *
 * UNM runs a public Banner 9 Student Registration SSB (lobowebapp.unm.edu) -
 * the same JSON API as Texas Tech / Northeastern, so the shared factory does
 * the work. Full seat counts + meeting times.
 *
 * Two UNM specifics:
 *  - Its term list carries "MD & PHARMD Fall 2026"-style Health-Sciences cohort
 *    terms listed BEFORE the main "Fall 2026". They normalize to the same
 *    Season+Year and would shadow the real semester in the term-window dedup, so
 *    getTerms drops them (same pattern NEU/GT use). No current/next trimming
 *    here - that stays in term-window.js.
 *  - The public search returns NO faculty for any section (verified live), so
 *    instructors is always empty - that is UNM's data, not a bug.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'unm',
  base: 'https://lobowebapp.unm.edu',
})

export async function getTerms() {
  const terms = await impl.getTerms()
  return terms.filter((t) => !/\bMD\s*&\s*PHARMD\b/i.test(t.label))
}

export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
