/**
 * University of Louisville scraper.
 *
 * UofL's public COMMUNITY_ACCESS class search sits on csprd.louisville.edu.
 * (htmlaccess.louisville.edu/classSchedule/, the link the registrar publishes,
 * just redirects here.) The SUBJECT field is a <select>, so the shared
 * PeopleSoft factory does the work; UOFL1 is the only institution on the node.
 *
 * Its term dropdown reaches back to Spring 2022 and labels terms
 * "4258: Fall 2025" - the code is repeated in the label, which term-window's
 * parser ignores. Seat counts come from the shared class-detail walk.
 */
import { createPeopleSoftScraper } from './peoplesoft.js'

const scraper = createPeopleSoftScraper({
  school: 'louisville',
  url: 'https://csprd.louisville.edu/psc/ps_class/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL',
  institution: 'UOFL1',
})

export const getTerms = scraper.getTerms
export const getSubjects = scraper.getSubjects
export const getSections = scraper.getSections
