/**
 * University of Houston-Clear Lake scraper.
 *
 * UHCL (institution 00759) is served by the same public UH-System PeopleSoft
 * class search as UH main; only the institution code differs. Logic lives in the
 * shared peoplesoft-uh factory. Open/closed status is available; seat counts are
 * not.
 */
import { createUhSystemScraper } from './peoplesoft-uh.js'

const impl = createUhSystemScraper({ school: 'uhcl', institution: '00759' })

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
