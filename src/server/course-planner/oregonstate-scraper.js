/**
 * Oregon State University scraper.
 *
 * classes.oregonstate.edu is the same public CourseLeaf "FOSE" JSON API Brown /
 * Yale / UPenn run (see fose.js). Term codes are 6-digit but oddly sequenced
 * (202700 = Summer 2026, 202701 = Fall 2026, 202702 = Winter 2027); the
 * "999999 = All Terms" entry is dropped by the factory's plain-label filter.
 * Unlike the other FOSE schools, Oregon State's `route=details` response
 * carries seat counts as plain JSON fields (max_enroll / enrollment /
 * ssbsect_seats_avail), so the full max/current/available triple is exact.
 */
import { createFoseScraper } from './fose.js'

const scraper = createFoseScraper({
  school: 'oregonstate',
  base: 'https://classes.oregonstate.edu',
  seats: 'fields',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
