/**
 * University of Texas at El Paso scraper.
 *
 * UTEP runs Banner 8 "classic" self-service ("Goldmine"). The modern SSB +
 * portal are CAS/Duo login-gated, but the legacy Class Schedule Listing at
 * goldmine.utep.edu/prod is public (Texas HB 2504 "Public Access to Course
 * Information"). Shared banner-classic factory does the work. Meeting times +
 * instructors are available; seat counts are not.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'utep',
  base: 'https://goldmine.utep.edu',
  prefix: '/prod',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
