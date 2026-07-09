/**
 * Rensselaer Polytechnic Institute scraper.
 *
 * RPI's SIS (sis.rpi.edu/rss) is the classic public Banner 8 bwckschd flow —
 * same engine as UTSA / UTEP / Lamar, so the shared factory does all the
 * work, including the per-CRN detail-page walk that fills Capacity / Actual /
 * Remaining seats. Past terms are suffixed "(View only)" but still parse to
 * past season+year labels, so the term window drops them naturally.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const scraper = createBannerClassicScraper({
  school: 'rpi',
  base: 'https://sis.rpi.edu',
  prefix: '/rss',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
