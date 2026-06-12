/**
 * Unified Course Planner API the renderer talks to.
 *
 * All schools (rice, ttu, tamu, smu, utd) are fetched from the Node server's
 * `/api/course-planner/*` endpoints. UTD used to require Electron IPC because
 * CourseBook is reCAPTCHA-v3-gated; now the server runs Playwright + stealth
 * for that one, so both web and desktop clients hit the same API.
 */
import { fetchApiJson } from './fetchApiJson.js'

/** Schools dropdown  entirely server-driven now. */
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
