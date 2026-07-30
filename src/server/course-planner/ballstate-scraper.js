/**
 * Ball State University scraper.
 *
 * Ball State runs the standard public Banner 9 Student Registration SSB JSON API
 * (banner.bsu.edu) - the same engine as Texas Tech / Northeastern, so the shared
 * factory does all the work. Full seat counts + meeting times + instructors
 * straight from the search results. Past terms carry "(View Only)" and drop out
 * in the term window.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'ballstate',
  base: 'https://banner.bsu.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
