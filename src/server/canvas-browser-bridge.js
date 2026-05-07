/**
 * Headed Playwright session for Canvas web login (SSO / MFA), then cookie-based API sync.
 */

import { randomUUID } from 'crypto'
import { chromium } from 'playwright'
import { buildChromiumLaunchOptions } from './playwright-launch.js'
import {
  normalizeCanvasBaseUrl,
  verifyCanvasCookieSession,
  syncCanvasDataWithCookies,
} from './canvas-lms.js'
import { scrapeCanvasFilesToZipResponse } from './canvas-file-scraper.js'

/** @type {Map<string, any>} */
const pendingBrowserSessions = new Map()

/** @type {Map<string, { baseUrl: string, cookieHeader: string, createdAt: number }>} */
const httpCookieSessions = new Map()

const PENDING_BROWSER_TTL_MS = 45 * 60 * 1000
const HTTP_COOKIE_SESSION_TTL_MS = 45 * 60 * 1000

function normalizeCdpUrl(input) {
  if (input == null || input === '') return undefined
  const t = String(input).trim()
  if (!t) return undefined
  if (/^https?:\/\//i.test(t)) return t
  if (/^\d{2,5}$/.test(t)) return `http://127.0.0.1:${t}`
  return t
}

function resolvePlaywrightChannel(browserChannel) {
  const raw = String(browserChannel || process.env.PLAYWRIGHT_CHANNEL || '')
    .toLowerCase()
    .trim()
  if (raw === 'chrome' || raw === 'msedge') return raw
  return undefined
}

function cookieHeaderFromPlaywrightCookies(cookies) {
  if (!Array.isArray(cookies)) return ''
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

export function isCanvasBrowserPending(sessionId) {
  return pendingBrowserSessions.has(sessionId)
}

export function getCanvasBrowserSessionStatus(sessionId) {
  const p = pendingBrowserSessions.get(sessionId)
  if (p) {
    return {
      exists: true,
      mode: 'browser_pending',
      status: p.status,
      createdAt: p.createdAt,
      canvasUrl: p.canvasBaseUrl,
    }
  }
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

function sessionExpired(createdAt, ttl) {
  return Date.now() - createdAt > ttl
}

function cleanupExpiredPending() {
  for (const [id, e] of pendingBrowserSessions) {
    if (sessionExpired(e.createdAt, PENDING_BROWSER_TTL_MS)) {
      void closeCanvasBrowserOnly(id, e).catch(() => {})
      pendingBrowserSessions.delete(id)
    }
  }
}

function cleanupExpiredHttp() {
  for (const [id, e] of httpCookieSessions) {
    if (sessionExpired(e.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
      httpCookieSessions.delete(id)
    }
  }
}

async function closeCanvasBrowserOnly(sessionId, entry) {
  try {
    if (!entry) return
    if (entry.attachedToExistingBrowser) {
      await entry.page?.close({ runBeforeUnload: false }).catch(() => {})
      await entry.browser?.close().catch(() => {})
    } else {
      await entry.context?.close().catch(() => {})
      await entry.browser?.close().catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} opts
 * @param {string} opts.canvasUrl
 * @param {boolean} [opts.useSameBrowser]
 * @param {string} [opts.cdpUrl]
 * @param {string} [opts.browserChannel]
 * @param {boolean} [opts.alsoOpenInDefaultBrowser]
 */
export async function startCanvasBrowserSession(opts = {}) {
  const {
    canvasUrl,
    useSameBrowser = false,
    cdpUrl: cdpFromBody,
    browserChannel: browserChannelFromBody,
    alsoOpenInDefaultBrowser = false,
  } = opts

  const canvasBaseUrl = normalizeCanvasBaseUrl(canvasUrl || '')

  const sessionId = randomUUID()
  const cdpUrl = useSameBrowser ? normalizeCdpUrl(cdpFromBody || process.env.PUPPETEER_CDP_URL) : null

  let browser
  let context
  let page
  let attachedToExistingBrowser = false
  let ownsBrowser = true
  let launchChannelUsed = null

  try {
    if (useSameBrowser && cdpUrl) {
      try {
        browser = await chromium.connectOverCDP(cdpUrl)
        attachedToExistingBrowser = true
        ownsBrowser = false
        context = browser.contexts()[0] ?? (await browser.newContext())
        page = await context.newPage()
        console.log(`[Canvas browser] Session ${sessionId} connected via CDP ${cdpUrl}`)
      } catch (e) {
        console.warn(`[Canvas browser] CDP failed (${e.message}); launching Chromium.`)
      }
    }

    if (!page) {
      const ch = resolvePlaywrightChannel(browserChannelFromBody)
      const launchOpts = buildChromiumLaunchOptions(ch)
      if (ch) launchChannelUsed = ch
      browser = await chromium.launch(launchOpts)
      context = await browser.newContext()
      page = await context.newPage()
    }

    console.log(`[Canvas browser] Session ${sessionId} → ${canvasBaseUrl}`)
    await page.goto(canvasBaseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 })

    if (alsoOpenInDefaultBrowser === true) {
      try {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        const { platform } = process
        if (platform === 'win32') {
          await execAsync(`start "" "${canvasBaseUrl}"`)
        } else if (platform === 'darwin') {
          await execAsync(`open "${canvasBaseUrl}"`)
        } else {
          await execAsync(`xdg-open "${canvasBaseUrl}"`)
        }
      } catch (e) {
        console.warn('[Canvas browser] alsoOpenInDefaultBrowser:', e.message)
      }
    }

    pendingBrowserSessions.set(sessionId, {
      status: 'pending',
      browser,
      context,
      page,
      canvasBaseUrl,
      createdAt: Date.now(),
      ownsBrowser,
      attachedToExistingBrowser,
      launchChannel: launchChannelUsed,
    })

    return {
      sessionId,
      message:
        'Complete Canvas sign-in in the browser window (including MFA if prompted). This dialog detects when your session can access Canvas.',
      canvasUrl: canvasBaseUrl,
      attachedToExistingBrowser,
      launchChannel: launchChannelUsed ?? null,
      alsoOpenedInDefaultBrowser: alsoOpenInDefaultBrowser === true,
    }
  } catch (e) {
    try {
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
    } catch {
      /* ignore */
    }
    throw e
  }
}

async function finalizePendingToCookieSession(sessionId, entry, cookieHeader) {
  pendingBrowserSessions.delete(sessionId)
  await closeCanvasBrowserOnly(sessionId, entry)
  httpCookieSessions.set(sessionId, {
    baseUrl: entry.canvasBaseUrl,
    cookieHeader,
    createdAt: Date.now(),
  })
}

/**
 * Poll login: when Canvas cookies can call the API, closes the browser and registers a cookie session.
 */
export async function checkCanvasBrowserLogin(sessionId) {
  cleanupExpiredPending()
  cleanupExpiredHttp()

  const http = httpCookieSessions.get(sessionId)
  if (http) {
    if (sessionExpired(http.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
      httpCookieSessions.delete(sessionId)
      return {
        loggedIn: false,
        currentUrl: '',
        error: 'Session expired. Start again from your Canvas URL.',
        mode: 'none',
      }
    }
    return { loggedIn: true, currentUrl: null, mode: 'http_cookie' }
  }

  const entry = pendingBrowserSessions.get(sessionId)
  if (!entry) {
    return {
      loggedIn: false,
      currentUrl: '',
      error: 'Session not found',
      mode: 'none',
    }
  }

  if (sessionExpired(entry.createdAt, PENDING_BROWSER_TTL_MS)) {
    pendingBrowserSessions.delete(sessionId)
    await closeCanvasBrowserOnly(sessionId, entry).catch(() => {})
    return {
      loggedIn: false,
      currentUrl: '',
      error: 'Sign-in timed out. Start again.',
      mode: 'none',
    }
  }

  let currentUrl = ''
  try {
    currentUrl = entry.page.url()
  } catch {
    currentUrl = ''
  }

  const cookies = await entry.context.cookies().catch(() => [])
  const cookieHeader = cookieHeaderFromPlaywrightCookies(cookies)
  const ok = await verifyCanvasCookieSession(entry.canvasBaseUrl, cookieHeader)

  if (!ok) {
    return {
      loggedIn: false,
      currentUrl,
      mode: 'browser_pending',
    }
  }

  try {
    await finalizePendingToCookieSession(sessionId, entry, cookieHeader)
  } catch (e) {
    return {
      loggedIn: false,
      currentUrl,
      error: e.message || 'Failed to finalize Canvas session',
      mode: 'browser_pending',
    }
  }

  return { loggedIn: true, currentUrl, mode: 'http_cookie' }
}

export async function syncCanvasBrowserCookieSession(sessionId, onProgress) {
  cleanupExpiredHttp()
  const entry = httpCookieSessions.get(sessionId)
  if (!entry) {
    throw new Error('Session not found. Finish signing in, or start a new session.')
  }
  if (sessionExpired(entry.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
    httpCookieSessions.delete(sessionId)
    throw new Error('Session expired. Start again from your Canvas URL.')
  }

  onProgress?.({ phase: 'courses' })
  const verified = await verifyCanvasCookieSession(entry.baseUrl, entry.cookieHeader)
  if (!verified) {
    httpCookieSessions.delete(sessionId)
    throw new Error(
      'Canvas session cookies are no longer valid. Sign in again with a new browser session.'
    )
  }

  onProgress?.({ phase: 'assignments' })
  const data = await syncCanvasDataWithCookies(entry.baseUrl, entry.cookieHeader)
  entry.createdAt = Date.now()
  return data
}

/**
 * After browser SSO, stream a ZIP of module files / pages / assignments (cookie API).
 * @param {import('express').Response} res
 * @param {string} sessionId
 * @param {object} [body]
 * @param {string} [body.courses] — comma-separated course ids or 'all'
 */
export async function scrapeCanvasBrowserSessionToZip(res, sessionId, body = {}) {
  cleanupExpiredHttp()
  const entry = httpCookieSessions.get(sessionId)
  if (!entry) {
    throw new Error('Session not found. Finish signing in, or start a new session.')
  }
  if (sessionExpired(entry.createdAt, HTTP_COOKIE_SESSION_TTL_MS)) {
    httpCookieSessions.delete(sessionId)
    throw new Error('Session expired. Start again from your Canvas URL.')
  }

  const verified = await verifyCanvasCookieSession(entry.baseUrl, entry.cookieHeader)
  if (!verified) {
    httpCookieSessions.delete(sessionId)
    throw new Error(
      'Canvas session cookies are no longer valid. Sign in again with a new browser session.'
    )
  }

  const courses = body?.courses != null ? body.courses : 'all'
  await scrapeCanvasFilesToZipResponse(res, {
    baseUrl: entry.baseUrl,
    cookieHeader: entry.cookieHeader,
    courses,
    onProgress: (p) => console.log('[Canvas file scrape]', p.phase, p.courseName || p.courseId || ''),
  })
  entry.createdAt = Date.now()
}

export async function closeCanvasBrowserSession(sessionId) {
  const p = pendingBrowserSessions.get(sessionId)
  if (p) {
    pendingBrowserSessions.delete(sessionId)
    await closeCanvasBrowserOnly(sessionId, p).catch(() => {})
  }
  httpCookieSessions.delete(sessionId)
}

export async function closeAllCanvasBrowserSessions() {
  const pendingIds = [...pendingBrowserSessions.keys()]
  for (const id of pendingIds) {
    const e = pendingBrowserSessions.get(id)
    pendingBrowserSessions.delete(id)
    await closeCanvasBrowserOnly(id, e).catch(() => {})
  }
  httpCookieSessions.clear()
}
