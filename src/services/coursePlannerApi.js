/**
 * Unified Course Planner API the renderer talks to.
 *
 * Every school is fetched from the Node server's `/api/course-planner/*`
 * endpoints, so web and desktop clients hit the same API. The schools list is
 * entirely server-driven (see course-planner-routes.js).
 */
import { fetchApiJson } from './fetchApiJson.js'

/** Schools dropdown — entirely server-driven now. */
export async function listSchools() {
  const data = await fetchApiJson('/api/course-planner/schools')
  return data.schools || []
}

export async function getTerms(schoolCode) {
  const data = await fetchApiJson(`/api/course-planner/${schoolCode}/terms`)
  return data.terms || []
}

export async function getSubjects(schoolCode, termCode) {
  const data = await fetchApiJson(
    `/api/course-planner/${schoolCode}/subjects?term=${encodeURIComponent(termCode)}`
  )
  return data.subjects || []
}

export async function getSections(schoolCode, { termCode, subjectCode, termLabel, subjectLabel }) {
  const params = new URLSearchParams({
    term: termCode,
    subject: subjectCode,
    termLabel: termLabel || '',
    subjectLabel: subjectLabel || '',
  })
  const data = await fetchApiJson(
    `/api/course-planner/${schoolCode}/sections?${params}`
  )
  return data.sections || []
}
