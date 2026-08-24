/**
 * Texas Southern University scraper.
 *
 * TSU runs Banner 8 "classic" self-service on Ellucian's hosted cloud
 * (ssb-prod.ec.tsu.edu/PROD) and leaves the Class Schedule Listing public. The
 * shared banner-classic factory does the work. Meeting times, instructors and
 * seat counts (via per-CRN detail pages) are all available.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'tsu',
  base: 'https://ssb-prod.ec.tsu.edu',
  prefix: '/PROD',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
