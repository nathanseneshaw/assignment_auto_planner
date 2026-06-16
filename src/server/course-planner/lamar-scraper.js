/**
 * Lamar University scraper.
 *
 * Lamar (Beaumont) runs Banner 8 "classic" self-service. The modern portal is
 * login-gated, but the legacy Class Schedule Listing at ssbprod.lamar.edu/btdb is
 * public (Texas HB 2504 "Public Access to Course Information"). The shared
 * banner-classic factory does the work. Meeting times + instructors are
 * available; seat counts are not.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'lamar',
  base: 'https://ssbprod.lamar.edu',
  prefix: '/btdb',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
