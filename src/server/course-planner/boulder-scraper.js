/**
 * University of Colorado Boulder scraper.
 *
 * classes.colorado.edu is the same public CourseLeaf "FOSE" JSON API Brown /
 * Yale / UPenn run (see fose.js). Term codes are 4-digit (2267 = Fall 2026);
 * the dropdown's compound entries ("Summer & Fall 2026", "Academic Year
 * 2025-2026") are dropped by the factory's plain-label filter. Seat counts
 * come from each section's `route=details` call, whose `seats` field is an
 * HTML snippet ("Maximum Enrollment: 140 / Seats Avail: 58").
 */
import { createFoseScraper } from './fose.js'

const scraper = createFoseScraper({
  school: 'boulder',
  base: 'https://classes.colorado.edu',
  seats: 'html',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
