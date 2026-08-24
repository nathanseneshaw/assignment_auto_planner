/**
 * San Jacinto College scraper.
 *
 * San Jac runs Banner 8 "classic" self-service on Ellucian's hosted cloud
 * (ssb-prod.ec.sanjac.edu/PROD) with the Class Schedule Listing public. The
 * shared banner-classic factory does the work: meeting times, rooms and
 * instructors all come from the listing.
 *
 * `enrichSeats:false` because San Jac's public per-CRN detail pages omit the
 * "Registration Availability" table altogether (verified 2026-08-22 against
 * live CRNs — the page renders fees and restrictions, then stops), so the walk
 * would cost one request per section and fill nothing. Seats therefore stay
 * null and status stays "unknown", same as Alabama.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'sanjac',
  base: 'https://ssb-prod.ec.sanjac.edu',
  prefix: '/PROD',
  enrichSeats: false,
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
