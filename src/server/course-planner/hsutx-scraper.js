/**
 * Hardin-Simmons University scraper.
 *
 * Hardin-Simmons (Abilene) runs Ellucian Colleague Self-Service with a guest
 * "Course Catalog" search (no login) at selfservice.hsutx.edu/Student/Courses,
 * so all logic lives in the shared colleague factory and this file only pins the
 * host. Full enrollment (capacity / enrolled / available) + meeting times are
 * public.
 */
import { createColleagueScraper } from './colleague.js'

const impl = createColleagueScraper({
  school: 'hsutx',
  // Older Self-Service release: unsuffixed endpoints + bare criteria payload.
  legacyApi: true,
  base: 'https://selfservice.hsutx.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
