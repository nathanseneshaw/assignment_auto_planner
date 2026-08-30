/**
 * University of Hawaii at Manoa scraper.
 *
 * UH retired the long-running `sis.hawaii.edu/uhdad/avail.classes` CGI (it now
 * answers HTTP 502 to everything) and moved class search to Banner 9 SSB, served
 * on a non-standard port: www.sis.hawaii.edu:9234, linked from
 * hawaii.edu/its-banner as "Course Availability-Public".
 *
 * Like South Dakota's, this is ONE instance covering the whole ten-campus system,
 * so Manoa is selected with Banner's `txt_campus` filter (code MAN) and the
 * subject list is derived from Manoa's own sections rather than the 275-subject
 * system-wide facet - see banner-ssb.js. Full seat counts + meeting times +
 * instructors.
 *
 * Term filtering: the dropdown lists "Fall 2026 Extension" (202713) and
 * "Fall 2026 Apprenticeship" (202711) BEFORE the main "Fall 2026" (202710).
 * All three normalize to "Fall 2026" and the term-window dedup keeps the first
 * listed, so the Extension catalog would shadow the real semester. It also
 * carries a sentinel "The End of Time" row, which parseTerm drops on its own
 * (no season + year) but which is filtered here too so the intent is explicit.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'hawaii',
  base: 'https://www.sis.hawaii.edu:9234',
  campus: 'MAN',
})

const TERM_NOISE_RE = /\b(Extension|Apprenticeship|End of Time)\b/i

export async function getTerms() {
  const terms = await impl.getTerms()
  return terms.filter((t) => !TERM_NOISE_RE.test(t.label))
}

export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
