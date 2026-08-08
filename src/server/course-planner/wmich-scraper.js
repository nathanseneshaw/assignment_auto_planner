/**
 * Western Michigan University scraper.
 *
 * WMU runs the standard public Banner 9 Student Registration SSB JSON API
 * (bannerweb.wmich.edu) - the same engine as Texas Tech / Northeastern, so the
 * shared factory does all the work. Full seat counts + meeting times; many labs
 * and online sections carry a TBA instructor (dropped by the factory), so
 * instructor coverage is partial - that is WMU's data, not a parser gap. Past
 * terms carry "(View Only)" and drop out in the term window.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'wmich',
  base: 'https://bannerweb.wmich.edu',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
