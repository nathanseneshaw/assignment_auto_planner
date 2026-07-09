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

// Baylor lists "(View Only)" and Trimester / MPAS / LAW variants ("2026 - Fall
// Trimester (View Only)") before the real "2026 - Fall"; their labels parse to
// the same Season+Year and would shadow it in the term-window dedup.
export async function getTerms() {
  const terms = await impl.getTerms()
  const filtered = terms.filter((t) => !/\b(view only|trimester|mpas|law)\b/i.test(t.label))
  return filtered.length ? filtered : terms
}
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
