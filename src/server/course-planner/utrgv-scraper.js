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

// UTRGV lists School-of-Medicine cohort terms ("Fall-Spr 2026-27 SOM Y4") and
// "FALL 2026 MODULE 2" mini-terms before the real "FALL 2026"; their labels
// parse to the same Season+Year and would shadow it in the term-window dedup.
export async function getTerms() {
  const terms = await impl.getTerms()
  const filtered = terms.filter((t) => !/fall-spr|\bSOM\b|\bSOPM\b|module/i.test(t.label))
  return filtered.length ? filtered : terms
}
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
