/**
 * Texas A&M University-Texarkana scraper.
 *
 * A&M-Texarkana runs Banner 8 "classic" self-service; its public Schedule of
 * Classes lives at banssbtexp.tamut.edu/texp with no login. The shared
 * banner-classic factory does the work. Meeting times, instructors and seat
 * counts (via per-CRN detail pages) are all available.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'tamut',
  base: 'https://banssbtexp.tamut.edu',
  prefix: '/texp',
})

// A&M-Texarkana lists a "(View only)" Spring 2027 shell BEFORE the live Fall
// 2026 term. Its subject list is empty (the term isn't built yet), so leaving it
// in would put a dead term in the dropdown. Every browsable term here is the
// unsuffixed one. (Texas Southern marks even its live terms "(View only)", so
// this filter stays per-school rather than moving into the factory.)
export async function getTerms() {
  const terms = await impl.getTerms()
  const filtered = terms.filter((t) => !/\(view only\)/i.test(t.label))
  return filtered.length ? filtered : terms
}
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
