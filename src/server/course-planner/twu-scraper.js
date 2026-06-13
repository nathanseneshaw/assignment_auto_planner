/**
 * Texas Woman's University scraper.
 *
 * TWU runs Ellucian Colleague Self-Service with a guest "Course Catalog" search
 * (no login) at selfservice.twu.edu/Student/Courses. All logic lives in the
 * shared colleague factory; this file pins the host. Full enrollment data
 * (capacity / enrolled / available seats) + meeting times + open/closed status
 * are available.
 */
import { createColleagueScraper } from './colleague.js'

const impl = createColleagueScraper({
  school: 'twu',
  base: 'https://selfservice.twu.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
