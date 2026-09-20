/**
 * University of Alaska Fairbanks scraper.
 *
 * The University of Alaska system runs one Banner 9 SSB on Ellucian's cloud
 * (reg-prod.ec.alaska.edu) covering UAF, UAA and UAS. UAOnline's own links point
 * at studentssb-prod.ec.alaska.edu, which answers "No valid route" for the
 * registration app; reg-prod is the host that actually serves class search.
 *
 * Scoping this to Fairbanks needs the CLIENT-side filter, not mepCode and not
 * txt_campus. Both of those are no-ops on this instance: mepCode=UAF and
 * mepCode=UAA return the same 34 ECON sections, and txt_campus is ignored
 * outright (verified live - passing every UAF campus code, every UAA code, or
 * none at all all return the identical 34 rows). Each row's campusDescription IS
 * reliable, though ("UAF - Fairbanks Campus", "UAF - eCampus", "UAA - Anchorage
 * Campus"), so campusRe keeps the UAF ones. mepCode is still sent because the
 * host expects an institution in the URL.
 *
 * The regex deliberately keeps every UAF campus - Fairbanks, eCampus, CTC and
 * the rural campuses - because they are one university's catalog, not separate
 * schools. Full seat counts + meeting times + instructors. Term codes are the
 * compact YYYYNN form (202603 = Fall 2026).
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'uaf',
  base: 'https://reg-prod.ec.alaska.edu',
  mepCode: 'UAF',
  campusRe: /^UAF\b/i,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
