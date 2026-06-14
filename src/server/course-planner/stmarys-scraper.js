/**
 * St. Mary's University (San Antonio) scraper.
 *
 * St. Mary's runs Banner 8 "classic" self-service and publishes the Class
 * Schedule Listing at appssbprd.stmarytx.edu/BPRD with no login. Shared
 * banner-classic factory does the work. Note St. Mary's uses short subject
 * codes (AC=Accounting, BL=Biology, EN=English, MT=Math) and a "Wintermester"
 * term type. Meeting times + instructors are available; seat counts are not.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'stmarys',
  base: 'https://appssbprd.stmarytx.edu',
  prefix: '/BPRD',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
