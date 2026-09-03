/**
 * Backend payloads for the auth / shell / account specs.
 *
 * Only one endpoint is involved: ProfilePage (and CoursePlannerPage) load the
 * supported-school list on mount, so any spec that opens Settings has to stub
 * `/api/course-planner/schools` or the fixture answers it with a 503.
 */

/** A deliberately tiny catalog: enough to pick from, small enough to assert on. */
export const SCHOOLS = [
  { code: 'rice', name: 'Rice University' },
  { code: 'twu', name: "Texas Woman's University" },
  { code: 'utd', name: 'The University of Texas at Dallas' },
]

/** The exact body `listSchools()` expects back. */
export const schoolsResponse = { schools: SCHOOLS }
