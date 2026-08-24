/**
 * South Texas College scraper.
 *
 * STC (McAllen) runs a stock Banner 9 SSB instance at
 * registration.southtexascollege.edu with no mepCode required. Logic lives in
 * the shared banner-ssb factory. Full enrollment data (max / enrolled /
 * available seats) + meeting times + open/closed status are available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'stc',
  base: 'https://registration.southtexascollege.edu',
})

// STC lists its Continuing Education quarters ("Quarter 1 CE Fall 2026", code
// 520271) BEFORE the credit terms (202710 "Fall 2026"). Their labels clean to
// the same Season+Year, so the term-window dedup was binding Fall to the CE
// catalog instead of the academic one.
export async function getTerms() {
  const terms = await impl.getTerms()
  const credit = terms.filter((t) => !/\bCE\b|\bQuarter\b/i.test(t.label))
  return credit.length ? credit : terms
}
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
