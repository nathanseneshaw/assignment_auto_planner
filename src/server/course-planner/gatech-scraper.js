/**
 * Georgia Tech scraper.
 *
 * GT decommissioned its old OSCAR Banner-8 pages (oscar.gatech.edu now 404s)
 * and runs Banner 9 Student Registration SSB at registration.banner.gatech.edu,
 * public and guest-accessible. The shared banner-ssb factory does the work:
 * full seat counts (maximumEnrollment / enrollment / seatsAvailable) plus
 * meeting times and instructors from the JSON API.
 *
 * GT's term list mixes in "Language Institute" IEP mini-terms (e.g. "Language
 * Inst IEP: Spring 2 26") whose labels parse to the same Season+Year as the
 * real semester and can shadow it in the term-window dedup, so getTerms drops
 * them here. No trimming to current/next happens here - that stays in
 * term-window.js.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'gatech',
  base: 'https://registration.banner.gatech.edu',
  // GT fronts Banner with a multi-node F5 pool; without fresh connections the
  // BIGipServer persistence cookie never arrives and term binding is lost.
  closeConnections: true,
})

export async function getTerms() {
  const terms = await impl.getTerms()
  return terms.filter((t) => !/language\s+inst/i.test(t.label))
}

export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
