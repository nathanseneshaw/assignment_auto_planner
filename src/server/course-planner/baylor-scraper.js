/**
 * Baylor University scraper.
 *
 * Baylor runs a stock Banner 9 SSB instance at bearweb.baylor.edu with no mepCode
 * required. Logic lives in the shared banner-ssb factory. Baylor's subject/term
 * labels arrive with HTML entities (e.g. "Acad. for Teaching &amp; Learning");
 * the factory decodes those. Full enrollment data + meeting times are available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'baylor',
  base: 'https://bearweb.baylor.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
