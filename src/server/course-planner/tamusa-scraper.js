/**
 * Texas A&M University-San Antonio scraper.
 *
 * A&M-San Antonio runs Banner 8 "classic" self-service and leaves the public
 * Class Schedule Listing open at banner.tamusa.edu/prodssb (Texas HB 2504
 * "Public Access to Course Information"). All logic lives in the shared
 * banner-classic factory; this file pins the host + package path. Meeting
 * times, instructors and seat counts (via per-CRN detail pages) are available.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'tamusa',
  base: 'https://banner.tamusa.edu',
  prefix: '/prodssb',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
