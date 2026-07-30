/**
 * University of Idaho scraper.
 *
 * Idaho runs the standard public Banner 9 Student Registration SSB JSON API
 * (banner.uidaho.edu) - the same engine as Texas Tech / Northeastern, so the
 * shared factory does all the work. Full seat counts + meeting times +
 * instructors. Past/future view-only terms carry "(View Only)" and drop out in
 * the term window.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'uidaho',
  base: 'https://banner.uidaho.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
