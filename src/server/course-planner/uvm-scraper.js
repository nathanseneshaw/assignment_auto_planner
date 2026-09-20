/**
 * University of Vermont scraper.
 *
 * soc.uvm.edu ("Search Courses") is the same public CourseLeaf "FOSE" JSON API
 * Brown / Yale / UPenn / CU Boulder run - the page even loads fose.js - so the
 * shared factory does the work. Term codes are 6-digit (202609 = Fall 2026).
 *
 * Seat counts come from each section's `route=details` call, whose `seats` field
 * is the span-based HTML snippet Brown and UPenn use ("Maximum Enrollment: 45 /
 * Seats Avail: 9"), so `seats: 'html'` parses it unchanged.
 *
 * No rooms, like every other FOSE school: the factory builds meetings from the
 * structured `meetingTimes` JSON, which carries days and times only. UVM does
 * print a room in the details call's `meeting_html` blob, but that is a
 * per-section extra fetch the search results do not have.
 */
import { createFoseScraper } from './fose.js'

const scraper = createFoseScraper({
  school: 'uvm',
  base: 'https://soc.uvm.edu',
  seats: 'html',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
