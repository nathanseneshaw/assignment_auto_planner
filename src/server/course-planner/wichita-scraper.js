/**
 * Wichita State University scraper.
 *
 * Wichita State runs the standard public Banner 9 Student Registration SSB JSON
 * API (ssbprod.wichita.edu) - the same engine as Texas Tech / Northeastern, so
 * the shared factory does all the work. Full seat counts + meeting times +
 * instructors. Past terms carry "(View Only)" and drop out in the term window.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'wichita',
  base: 'https://ssbprod.wichita.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
