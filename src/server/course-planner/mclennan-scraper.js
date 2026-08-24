/**
 * McLennan Community College scraper.
 *
 * McLennan (Waco) runs Ellucian Colleague Self-Service with a guest "Course
 * Catalog" search (no login) at selfservice.mclennan.edu/Student/Courses, so all
 * logic lives in the shared colleague factory and this file only pins the host.
 * Full enrollment (capacity / enrolled / available) + meeting times are public.
 */
import { createColleagueScraper } from './colleague.js'

const impl = createColleagueScraper({
  school: 'mclennan',
  // Older Self-Service release: unsuffixed endpoints + bare criteria payload.
  legacyApi: true,
  base: 'https://selfservice.mclennan.edu',
})

export const getTerms = impl.getTerms
export const getSubjects = impl.getSubjects
export const getSections = impl.getSections
