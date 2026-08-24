/**
 * Texas A&M International University scraper.
 *
 * TAMIU (Laredo) runs a stock Banner 9 SSB instance at banssbprod.tamiu.edu
 * with no mepCode required — schedule.tamiu.edu is just a redirect to its
 * public term-selection page. Logic lives in the shared banner-ssb factory.
 * Full enrollment data (max / enrolled / available seats) + meeting times +
 * open/closed status are available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'tamiu',
  base: 'https://banssbprod.tamiu.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
