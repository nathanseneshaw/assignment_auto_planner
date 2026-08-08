/**
 * College of Charleston scraper.
 *
 * CofC runs the standard public Banner 9 Student Registration SSB JSON API
 * (ssb.cofc.edu) - the same engine as Texas Tech / Northeastern, so the shared
 * factory does all the work. Full seat counts + meeting times + instructors.
 * Term labels are "2026 Fall" style (year first) which the term window parses
 * fine; past terms carry "(View Only)" and drop out there.
 *
 * Like Georgia Tech, CofC fronts Banner with a multi-node F5 pool that only
 * issues its persistence cookie on a fresh TCP connection, so without
 * `closeConnections` the term binding is lost about half the time and the
 * search returns 0 rows (verified live: 0/5 without, 5/5 with).
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'cofc',
  base: 'https://ssb.cofc.edu',
  closeConnections: true,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
