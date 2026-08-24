/**
 * Alamo Colleges District scraper (San Antonio).
 *
 * The five Alamo colleges (San Antonio, Northeast Lakeview, Northwest Vista,
 * Palo Alto, St. Philip's) share one Banner 9 SSB instance, linked from each
 * college's "Schedule of Classes" page and reachable with no login on port
 * 8010. Logic lives in the shared banner-ssb factory. Full enrollment data
 * (max / enrolled / available seats) + meeting times + instructors are
 * available, and sections from every campus come back together.
 */
import { createBannerScraper } from './banner-ssb.js'
import { stripLeadingCode } from './util.js'

const impl = createBannerScraper({
  school: 'alamo',
  base: 'https://lum010.alamo.edu:8010',
})

export const getTerms = impl.getTerms
export const getSections = impl.getSections

/** Alamo repeats the code in its own description ("ACCT-Accounting"). */
export async function getSubjects(termCode) {
  const subjects = await impl.getSubjects(termCode)
  return subjects.map((s) => ({ code: s.code, label: stripLeadingCode(s.code, s.label) }))
}
