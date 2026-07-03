/**
 * University of Texas at San Antonio scraper.
 *
 * UTSA runs Banner 8 "classic" self-service (ASAP) and exposes the public
 * Class Schedule Listing at asap.utsa.edu/pls/prod with no login. All logic
 * lives in the shared banner-classic factory; this file pins the host + package
 * path. Meeting times, instructors and seat counts (via per-CRN detail pages)
 * are all available.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'utsa',
  base: 'https://asap.utsa.edu',
  prefix: '/pls/prod',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
