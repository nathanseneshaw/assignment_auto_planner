/**
 * Auburn University scraper.
 *
 * Auburn's self-service (ssbprod.auburn.edu/pls/PROD) is the classic public
 * Banner 8 bwckschd flow — same engine as UTSA / RPI, so the shared factory
 * does all the work, including the per-CRN detail-page walk that fills
 * Capacity / Actual / Remaining seats (verified live: the detail pages are
 * public and carry the full Registration Availability table). Past terms are
 * suffixed "(View only)" and drop out in the term window.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const scraper = createBannerClassicScraper({
  school: 'auburn',
  base: 'https://ssbprod.auburn.edu',
  prefix: '/pls/PROD',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
