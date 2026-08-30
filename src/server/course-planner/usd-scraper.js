/**
 * University of South Dakota scraper.
 *
 * Same shared South Dakota Board of Regents Banner 9 SSB instance as SDSU (see
 * sdstate-scraper.js for the mepCode / txt_campus note); campus code `U` selects
 * USD. Full seat counts + meeting times + instructors.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'usd',
  base: 'https://registration.sdbor.edu',
  mepCode: 'BOR',
  campus: 'U',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
