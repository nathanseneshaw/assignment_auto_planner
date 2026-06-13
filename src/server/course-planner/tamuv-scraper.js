/**
 * Texas A&M University-Victoria scraper.
 *
 * TAMU-Victoria (institution 00765) is hosted on the same public UH-System
 * PeopleSoft class search as UH main; only the institution code differs. Logic
 * lives in the shared peoplesoft-uh factory. Meeting times + open/closed status
 * are available; seat counts are not.
 */
import { createUhSystemScraper } from './peoplesoft-uh.js'

const impl = createUhSystemScraper({ school: 'tamuv', institution: '00765' })

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
