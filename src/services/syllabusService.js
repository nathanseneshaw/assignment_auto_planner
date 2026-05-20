/**
 * Client wrapper for the Syllabus Parser backend (`/api/syllabus/*`).
 *
 * Two calls:
 *   parse(file) — multipart upload, returns the AI-extracted draft. Uses raw
 *                 fetch (not fetchApiJson) because the body is FormData — we
 *                 must NOT set Content-Type so the browser inserts the
 *                 multipart boundary automatically.
 *   save(draft) — JSON POST, returns { courseId, assignmentsInserted, ... }.
 */
import { fetchApiJson } from './fetchApiJson'
import { apiUrl } from './apiBase'
import { supabase } from '../lib/supabase'

async function bearerToken() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data?.session?.access_token
  if (!token) throw new Error('You must be signed in to parse a syllabus.')
  return token
}

/**
 * Upload a PDF or DOCX syllabus. Returns the AI-extracted draft for review.
 * @param {File} file
 * @returns {Promise<{ course: object, assignments: object[], meta: object }>}
 */
export async function parseSyllabus(file) {
  const token = await bearerToken()
  const fd = new FormData()
  fd.append('file', file, file.name)

  // IMPORTANT: do NOT set Content-Type — the browser must add the
  // multipart boundary parameter, and a manual value would break it.
  const res = await fetch(apiUrl('/api/syllabus/parse'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      res.ok
        ? `Server returned non-JSON: ${text.slice(0, 160)}`
        : `HTTP ${res.status}: ${text.slice(0, 160)}`
    )
  }
  if (!res.ok) {
    throw new Error(data?.error || `Parse failed (${res.status})`)
  }
  return data
}

/**
 * Persist the (user-edited) draft as a course + N assignments.
 * @param {{ course: object, assignments: object[] }} draft
 * @returns {Promise<{ success: true, courseId: string, assignmentsInserted: number, assignmentsSkipped: number }>}
 */
export async function saveSyllabus(draft) {
  const token = await bearerToken()
  return fetchApiJson('/api/syllabus/save', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(draft),
  })
}
