/**
 * Sul Ross State University scraper.
 *
 * Sul Ross (Alpine) runs Banner 9 SSB on Ellucian's hosted cloud, on the
 * non-standard port 8103 that the university's own "Class Schedule" quick link
 * points at. Logic lives in the shared banner-ssb factory. Full enrollment data
 * (max / enrolled / available seats) + meeting times + open/closed status are
 * available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'sulross',
  base: 'https://reg-prod.srsu.elluciancloud.com:8103',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
