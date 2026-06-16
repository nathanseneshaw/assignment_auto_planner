/**
 * University of Houston scraper (PeopleSoft classic public Class Search).
 *
 * UH exposes COMMUNITY_ACCESS.CLASS_SEARCH.GBL with no login. Institution 00730 =
 * University of Houston main campus; the same component also serves UH-Downtown,
 * UH-Clear Lake and TAMU-Victoria (see peoplesoft-uh.js for the shared factory).
 *
 * Only open/closed status is exposed — no seat counts.
 */
import { createUhSystemScraper } from './peoplesoft-uh.js'

const impl = createUhSystemScraper({ school: 'uh', institution: '00730' })

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
