/**
 * University of Alaska Anchorage scraper.
 *
 * Same shared University of Alaska Banner 9 SSB instance as UAF - see
 * uaf-scraper.js for why the campus split has to happen client-side on
 * campusDescription rather than through mepCode or txt_campus. This regex keeps
 * every UAA campus (Anchorage, Kenai Peninsula, Kodiak, Matanuska-Susitna,
 * Prince William Sound). Full seat counts + meeting times + instructors.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'uaa',
  base: 'https://reg-prod.ec.alaska.edu',
  mepCode: 'UAA',
  campusRe: /^UAA\b/i,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
