/**
 * University of Texas Rio Grande Valley scraper.
 *
 * UTRGV runs a stock Banner 9 SSB instance ("ASSIST") at assist.utrgv.edu and
 * exposes the public no-login class search JSON API — the same one TTU/TxState/
 * Baylor use — with no mepCode required. All logic lives in the shared
 * banner-ssb factory. Full enrollment data (max / enrolled / available) and
 * meeting times are available. (The term list is heavy on School-of-Medicine
 * cohort terms; the standard terms behave like any other Banner SSB instance.)
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'utrgv',
  base: 'https://assist.utrgv.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
