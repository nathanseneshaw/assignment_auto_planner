/**
 * St. Edward's University scraper.
 *
 * St. Edward's (Austin) runs a stock Banner 9 SSB instance at
 * banner.stedwards.edu with no mepCode required. Logic lives in the shared
 * banner-ssb factory. Full enrollment data (max / enrolled / available seats) +
 * meeting times + open/closed status are available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'stedwards',
  base: 'https://banner.stedwards.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
