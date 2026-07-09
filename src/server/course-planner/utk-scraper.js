/**
 * University of Tennessee, Knoxville scraper.
 *
 * UTK runs the standard public Banner 9 Student Registration SSB JSON API
 * (bannerreg.utk.edu) — same engine as Texas Tech / Temple, so the shared
 * factory does all the work. Full seat counts come straight from the search
 * results. Term labels are "Fall Sem 2026" style ("Sem" abbreviation parses
 * fine in the term window); past terms and mini-terms carry "(View Only)".
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'utk',
  base: 'https://bannerreg.utk.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
