/**
 * West Virginia University scraper.
 *
 * WVU runs the standard public Banner 9 Student Registration SSB JSON API
 * (starss.wvu.edu) — same engine as Texas Tech / Temple, so the shared
 * factory does all the work. Full seat counts come straight from the search
 * results. Term labels are plain "Fall 2026"; past terms carry "(View Only)".
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'wvu',
  base: 'https://starss.wvu.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
