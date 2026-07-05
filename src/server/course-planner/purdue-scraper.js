/**
 * Purdue University scraper.
 *
 * Purdue (West Lafayette) still exposes the legacy Banner 8 "classic"
 * Class Schedule Listing at selfservice.mypurdue.purdue.edu/prod - public,
 * no login. The shared banner-classic factory does the work: meeting times,
 * instructors, credits. Purdue's section headers use th.ddlabel instead of
 * the stock th.ddtitle (handled in the factory).
 *
 * Seats are deliberately NOT fetched: Purdue rate-bans the caller's IP after
 * ~90 rapid per-CRN detail-page hits (verified 2026-07-05 - every response
 * degrades to a 519-byte "Information Page" for a while), and the bulk
 * bwskfcls "Look Up Classes" page is login-gated. With 600+ section subjects
 * there is no safe public seat source, so enrollment stays null and status
 * stays unknown.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const impl = createBannerClassicScraper({
  school: 'purdue',
  base: 'https://selfservice.mypurdue.purdue.edu',
  prefix: '/prod',
  enrichSeats: false,
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
