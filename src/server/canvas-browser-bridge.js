/**
 * HTTP cookie sessions for Canvas. Cookies are imported from the user's own browser
 * via the Assignment Planner extension; this file owns the in-memory session map
 * and the helpers that consume it (sync, ZIP scrape, cleanup).
 */

import {
  verifyCanvasCookieSession,
  syncCanvasDataWithCookies,
} from './canvas-lms.js'
import { scrapeCanvasFilesToZipResponse } from './canvas-file-scraper.js'

/** @type {Map<string, { baseUrl: string, cookieHeader: string, createdAt: number }>} */
const httpCookieSessions = new Map()

const HTTP_COOKIE_SESSION_TTL_MS = 45 * 60 * 1000

function sessionExpired(createdAt, ttl) {
  return Date.now() - createdAt > ttl
}

function cleanupExpiredHttp() {
  for (const [id, e] of httpCookieSessions) {
    if (sessionExpired(e.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
      httpCookieSessions.delete(id)
    }
  }
}

export function registerCanvasHttpCookieSession(sessionId, baseUrl, cookieHeader) {
  httpCookieSessions.set(sessionId, {
    baseUrl,
    cookieHeader,
    createdAt: Date.now(),
  })
}

export function getCanvasBrowserSessionStatus(sessionId) {
  const h = httpCookieSessions.get(sessionId)
  if (h) {
    return {
      exists: true,
      mode: 'http_cookie',
      createdAt: h.createdAt,
      canvasUrl: h.baseUrl,
    }
  }
  return { exists: false, mode: 'none' }
}

export async function syncCanvasBrowserCookieSession(sessionId, onProgress) {
  cleanupExpiredHttp()
  const entry = httpCookieSessions.get(sessionId)
  if (!entry) {
    throw new Error('Session not found. Sync your cookies again from the extension.')
  }
  if (sessionExpired(entry.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
    httpCookieSessions.delete(sessionId)
    throw new Error('Session expired. Sync your cookies again from the extension.')
  }

  onProgress?.({ phase: 'courses' })
  const verified = await verifyCanvasCookieSession(entry.baseUrl, entry.cookieHeader)
  if (!verified) {
    httpCookieSessions.delete(sessionId)
    throw new Error(
      'Canvas session cookies are no longer valid. Re-run the extension to refresh them.'
    )
  }

  onProgress?.({ phase: 'assignments' })
  const data = await syncCanvasDataWithCookies(entry.baseUrl, entry.cookieHeader)
  entry.createdAt = Date.now()
  return data
}

/**
 * Stream a ZIP of module files / pages / assignments using a stored cookie session.
 * @param {import('express').Response} res
 * @param {string} sessionId
 * @param {object} [body]
 * @param {string} [body.courses] — comma-separated course ids or 'all'
 */
export async function scrapeCanvasBrowserSessionToZip(res, sessionId, body = {}) {
  cleanupExpiredHttp()
  const entry = httpCookieSessions.get(sessionId)
  if (!entry) {
    throw new Error('Session not found. Sync your cookies again from the extension.')
  }
  if (sessionExpired(entry.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
    httpCookieSessions.delete(sessionId)
    throw new Error('Session expired. Sync your cookies again from the extension.')
  }

  const verified = await verifyCanvasCookieSession(entry.baseUrl, entry.cookieHeader)
  if (!verified) {
    httpCookieSessions.delete(sessionId)
    throw new Error(
      'Canvas session cookies are no longer valid. Re-run the extension to refresh them.'
    )
  }

  const courses = body?.courses != null ? body.courses : 'all'
  await scrapeCanvasFilesToZipResponse(res, {
    baseUrl: entry.baseUrl,
    cookieHeader: entry.cookieHeader,
    courses,
    onProgress: (p) =>
      console.log('[Canvas file scrape]', p.phase, p.courseName || p.courseId || ''),
  })
  entry.createdAt = Date.now()
}

export async function closeCanvasBrowserSession(sessionId) {
  httpCookieSessions.delete(sessionId)
}

export async function closeAllCanvasBrowserSessions() {
  httpCookieSessions.clear()
}
