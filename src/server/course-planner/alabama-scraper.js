/**
 * University of Alabama scraper.
 *
 * UA's self-service (ssb.ua.edu/pls/PROD) is the classic public Banner 8
 * bwckschd flow — same engine as UTSA / RPI. `enrichSeats` is OFF because
 * UA's public per-CRN detail page (p_disp_detail_sched) omits the
 * "Registration Availability" table entirely (verified 2026-07-08: the page
 * renders only "Detailed Class Information" — seats live behind myBama
 * login), and the listing carries no seat columns either. Sections therefore
 * ship with null enrollment and `unknown` status, like Purdue.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const scraper = createBannerClassicScraper({
  school: 'alabama',
  base: 'https://ssb.ua.edu',
  prefix: '/pls/PROD',
  enrichSeats: false,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
