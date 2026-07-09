/**
 * University of Notre Dame scraper.
 *
 * classsearch.nd.edu is the public CourseLeaf "FOSE" JSON API (see fose.js).
 * Term codes are 6-digit (202610 = Fall 2026); labels are wordier than most
 * FOSE skins ("Fall Semester 2026" / "Summer Session 2026"), so the factory's
 * plain-label filter is swapped for one that accepts the Semester/Session
 * middle word. Seat counts come from each section's `route=details` call,
 * whose `seats` field is the bold-tag HTML snippet ("Maximum Enrollment: 39 /
 * Seats Avail: 15").
 */
import { createFoseScraper } from './fose.js'

const scraper = createFoseScraper({
  school: 'nd',
  base: 'https://classsearch.nd.edu',
  seats: 'html',
  termRe: /^(Winter|Spring|Summer|Fall)\s+(Semester|Session)\s+\d{4}$/i,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
