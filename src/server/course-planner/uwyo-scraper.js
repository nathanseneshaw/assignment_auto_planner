/**
 * University of Wyoming scraper.
 *
 * UW runs the standard public Banner 9 Student Registration SSB JSON API
 * (wyossb.uwyo.edu) - the same engine as Texas Tech / Northeastern, so the
 * shared factory does all the work. Full seat counts + meeting times +
 * instructors. Past terms carry "(View Only)" and drop out in the term window.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'uwyo',
  base: 'https://wyossb.uwyo.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
