/**
 * William & Mary scraper.
 *
 * registration.wm.edu ("W&M PATH") is the same public CourseLeaf "FOSE" JSON
 * API Brown / Yale / UPenn run (see fose.js). Term codes are 6-digit
 * academic-year style (202710 = Fall 2026, 202630 = Summer 2026). The subject
 * select renders bare-code labels ("CSCI"); the human names live in a parallel
 * "Subject Attributes" select whose option values are prefixed
 * "subject_attributes_CSCI" — the factory uses those as a label map. Seat
 * counts come from each section's `route=details` `seats` HTML snippet
 * ("Maximum Enrollment: 26 / Seats Avail: 26").
 */
import { createFoseScraper } from './fose.js'

const scraper = createFoseScraper({
  school: 'wm',
  base: 'https://registration.wm.edu',
  subjectValuePrefix: 'subject_attributes_',
  seats: 'html',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
