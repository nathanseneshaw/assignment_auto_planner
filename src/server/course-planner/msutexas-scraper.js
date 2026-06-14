/**
 * Midwestern State University (MSU Texas) scraper.
 *
 * MSU Texas (Wichita Falls, part of the Texas Tech University System) runs a
 * stock Banner 9 SSB instance with no mepCode required, served on a non-standard
 * port. Logic lives in the shared banner-ssb factory. Full enrollment data
 * (max / enrolled / available seats) + meeting times + open/closed status are
 * available.
 */
import { createBannerScraper } from './banner-ssb.js'

const impl = createBannerScraper({
  school: 'msutexas',
  base: 'https://bannerxefe4.msutexas.edu:1808',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
