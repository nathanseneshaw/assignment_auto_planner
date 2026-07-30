/**
 * George Mason University scraper.
 *
 * Mason's public "Schedule of Classes" (patriotweb.gmu.edu/pls/prod) is the
 * classic Banner 8 bwckschd flow - same engine as Auburn / UTSA, so the shared
 * factory does the work, including the per-CRN detail-page walk that fills
 * Capacity / Actual / Remaining seats.
 *
 * The one Mason quirk: an OPNET web accelerator fronts patriotweb and 404s the
 * bare `.../bwckschd.p_disp_dyn_sched` path - the real page only answers with a
 * trailing slash. `trailingSlash: true` appends that slash to every mod_plsql
 * procedure URL (form, subject POST, section POST, and detail page). Past terms
 * carry "(View only)" and drop out in the term window.
 */
import { createBannerClassicScraper } from './banner-classic.js'

const scraper = createBannerClassicScraper({
  school: 'gmu',
  base: 'https://patriotweb.gmu.edu',
  prefix: '/pls/prod',
  trailingSlash: true,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
