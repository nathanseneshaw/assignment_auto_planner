// Canvas sync — extension-imported cookie sessions (see /api/canvas routes).

import { apiUrl } from './apiBase.js'
import { fetchApiJson } from './fetchApiJson.js'

const API_BASE = '/api/canvas'

/**
 * Validate a user-supplied Canvas URL.
 * @param {string} input
 * @returns {string} normalized origin (https://host)
 */
export function validateCanvasBrowserUrl(input) {
  if (!input || !String(input).trim()) {
    throw new Error('Enter your Canvas URL')
  }
  let u = String(input).trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  let parsed
  try {
    parsed = new URL(u)
  } catch {
    throw new Error('Invalid Canvas URL')
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    throw new Error('Enter a full Canvas host (e.g. yourschool.instructure.com)')
  }
  const forbidden = ['example.com', 'invalid', 'test']
  const host = parsed.hostname.toLowerCase()
  if (forbidden.some((f) => host === f)) {
    throw new Error('Enter your real Canvas school URL')
  }
  return parsed.origin
}

export async function syncCanvasBrowserSession(sessionId) {
  return fetchApiJson(`${API_BASE}/sync-session/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * After cookie sync, download modules / files / pages as a ZIP (long-running).
 * @param {string} sessionId
 * @param {string} [courses] — comma-separated Canvas course ids, or 'all'
 */
export async function downloadCanvasModuleFilesZip(sessionId, courses = 'all') {
  const res = await fetch(apiUrl(`${API_BASE}/scrape-files/${sessionId}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courses }),
  })

  const ct = res.headers.get('content-type') || ''

  if (!res.ok) {
    if (ct.includes('application/json')) {
      const text = await res.text()
      let data = {}
      try {
        data = JSON.parse(text)
      } catch {
        /* ignore */
      }
      throw new Error(data.error || `Download failed (${res.status})`)
    }
    const text = await res.text()
    throw new Error(
      text.trimStart().slice(0, 64).toLowerCase().startsWith('<!doctype')
        ? 'The app got HTML instead of a ZIP. Is the backend running on port 3001?'
        : text.slice(0, 200) || `Download failed (${res.status})`
    )
  }

  if (!ct.includes('zip') && !ct.includes('octet-stream')) {
    const text = await res.text()
    throw new Error(text.slice(0, 160) || 'Server did not return a ZIP file')
  }

  const blob = await res.blob()
  const dispo = res.headers.get('content-disposition')
  let filename = `canvas-scrape-${Date.now()}.zip`
  const m = dispo?.match(/filename="?([^";]+)"?/i)
  if (m) filename = m[1].trim()

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function closeCanvasSession(sessionId) {
  return fetchApiJson(`${API_BASE}/close-session/${sessionId}`, {
    method: 'POST',
  })
}
