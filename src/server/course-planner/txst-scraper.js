/**
 * Texas State University scraper.
 *
 * Texas State runs a stock Banner 9 SSB instance at reg-prod.ec.txstate.edu with
 * no mepCode required. All the logic lives in the shared banner-ssb factory; this
 * file just pins the host. Full enrollment data (max / enrolled / available) and
 * meeting times are available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'txst',
  base: 'https://reg-prod.ec.txstate.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
