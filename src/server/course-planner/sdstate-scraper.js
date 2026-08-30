/**
 * South Dakota State University scraper.
 *
 * All six South Dakota Board of Regents universities share ONE public Banner 9
 * SSB instance (registration.sdbor.edu). `mepCode` does not split them -
 * verified live, mepCodes SDSU / USD / BOR return byte-identical subject and
 * section lists - so the campus is selected with Banner's `txt_campus` filter
 * instead. Campus codes come from the instance's own get_campus facet:
 * B=BHSU, D=DSU, N=NSU, M=SD Mines, S=SDSU, U=USD.
 *
 * Because `get_subject` is likewise catalog-wide (223 subjects across all six
 * campuses), the factory's `campus` option also derives the subject list from
 * this campus's own sections - see banner-ssb.js. Full seat counts + meeting
 * times + instructors.
 */
import { createBannerScraper } from './banner-ssb.js'

const scraper = createBannerScraper({
  school: 'sdstate',
  base: 'https://registration.sdbor.edu',
  mepCode: 'BOR',
  campus: 'S',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
