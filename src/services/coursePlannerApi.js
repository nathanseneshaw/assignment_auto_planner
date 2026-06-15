/**
 * Unified Course Planner API the renderer talks to.
 *
 * Every school is fetched from the Node server's `/api/course-planner/*`
 * endpoints, so web and desktop clients hit the same API. The schools list is
 * entirely server-driven (see course-planner-routes.js).
 *
 * Catalog scrapes can be slow on a cold cache (the upstream university sites
 * need warm-up round-trips), so every call carries a client-side timeout — a
 * hung scrape must surface as a clear, recoverable error rather than an
 * infinite spinner. Callers may also pass an AbortSignal to cancel a request
 * that a newer selection supersedes.
 */
import { fetchApiJson } from './fetchApiJson.js'

// Generous enough for a cold scrape, but bounded so the UI always recovers.
const CATALOG_TIMEOUT_MS = 25_000

/** Schools dropdown — entirely server-driven now. */
export async function listSchools({ signal } = {}) {
  const data = await fetchApiJson('/api/course-planner/schools', {
    timeoutMs: CATALOG_TIMEOUT_MS,
    signal,
  })
  return data.schools || []
}

export async function getTerms(schoolCode, { signal } = {}) {
  const data = await fetchApiJson(`/api/course-planner/${schoolCode}/terms`, {
    timeoutMs: CATALOG_TIMEOUT_MS,
    signal,
  })
  return data.terms || []
}

export async function getSubjects(schoolCode, termCode, { signal } = {}) {
  const data = await fetchApiJson(
    `/api/course-planner/${schoolCode}/subjects?term=${encodeURIComponent(termCode)}`,
    { timeoutMs: CATALOG_TIMEOUT_MS, signal }
  )
  return data.subjects || []
}

export async function getSections(
  schoolCode,
  { termCode, subjectCode, termLabel, subjectLabel },
  { signal } = {}
) {
  const params = new URLSearchParams({
    term: termCode,
    subject: subjectCode,
    termLabel: termLabel || '',
    subjectLabel: subjectLabel || '',
  })
  const data = await fetchApiJson(
    `/api/course-planner/${schoolCode}/sections?${params}`,
    { timeoutMs: CATALOG_TIMEOUT_MS, signal }
  )
  return data.sections || []
}
