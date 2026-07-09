/**
 * Temple University scraper.
 *
 * Temple runs the standard public Banner 9 Student Registration SSB JSON API
 * (prd-xereg.temple.edu) — same engine as Texas Tech / Georgia Tech /
 * Northeastern, so the shared factory does all the work. Full seat counts
 * (maximumEnrollment / enrollment / seatsAvailable) come straight from the
 * search results. Term labels are "2026 Fall" style; term-window normalizes.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'temple',
  base: 'https://prd-xereg.temple.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
