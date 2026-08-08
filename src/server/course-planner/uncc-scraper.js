/**
 * UNC Charlotte scraper.
 *
 * UNC Charlotte runs the standard public Banner 9 Student Registration SSB JSON
 * API (selfservice.charlotte.edu) - the same engine as Texas Tech / Northeastern,
 * so the shared factory does all the work. Full seat counts + meeting times +
 * instructors. Note the Computer Science subject code is "ITCS" (the College of
 * Computing and Informatics prefixes). Past terms carry "(View Only)" and drop
 * out in the term window.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'uncc',
  base: 'https://selfservice.charlotte.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
