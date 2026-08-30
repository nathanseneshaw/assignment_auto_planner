/**
 * University of Nevada, Reno scraper.
 *
 * MyNEVADA's public COMMUNITY_ACCESS class search on cs.nevada.unr.edu needs
 * both of the shared PeopleSoft factory's awkward-instance options:
 *
 *  - `subjectLookup`, because SUBJECT is a free-text input rather than a
 *    <select>, so the list has to come from the field's lookup button walked one
 *    alphabet tab at a time (UT Arlington's shape, stock PeopleSoft row ids).
 *  - `byCareer`, because a subject-only search bounces back to the criteria page
 *    ("Select at least 2 search criteria"). UNR's careers are UGRD / GRAD / MEDS.
 *
 * The catalog-number second criterion that works for UT Arlington does NOT work
 * here: "greater than or equal to 0" is rejected outright (the host re-renders
 * the entry page), and the "contains" operator that IS accepted would silently
 * drop every course number missing that digit. See peoplesoft.js.
 *
 * Seat counts come from the shared class-detail walk.
 */
import { createPeopleSoftScraper } from './peoplesoft.js'

const scraper = createPeopleSoftScraper({
  school: 'unr',
  url: 'https://cs.nevada.unr.edu/psc/unrcsprd/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  institution: 'UNR01',
  subjectLookup: true,
  byCareer: true,
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
