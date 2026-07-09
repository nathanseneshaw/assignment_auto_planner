/**
 * Dartmouth College scraper.
 *
 * courses.dartmouth.edu ("Dartmouth Class Search") is the same public
 * CourseLeaf "FOSE" JSON API as Boulder / W&M (see fose.js). Quarter school:
 * the dropdown holds three plain "Season YYYY" terms (202609 = Fall 2026).
 * Seat counts come from `route=details`, whose `seats` snippet abbreviates to
 * "Max Enrollment: 50 / Seats Available: 8" — covered by the factory's
 * relaxed html regexes.
 */
import { createFoseScraper } from './fose.js'

const scraper = createFoseScraper({
  school: 'dartmouth',
  base: 'https://courses.dartmouth.edu',
  seats: 'html',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
