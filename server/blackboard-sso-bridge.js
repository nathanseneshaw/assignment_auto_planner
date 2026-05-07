/**
 * Opens a real browser so the user can complete SSO (SAML/OIDC/CAS) with MFA,
 * then transfers cookies into BlackboardHttpSession for the HTTP scraper.
 */

import { randomUUID } from 'crypto'
import { chromium } from 'playwright'
import { buildChromiumLaunchOptions } from './playwright-launch.js'
import { BlackboardHttpSession } from './blackboard-http-session.js'
import { registerBlackboardHttpSession } from './blackboard-http-manager.js'

/** @type {Map<string, any>} */
const ssoSessions = new Map()

function normalizeStartUrl(input) {
  let u = String(input || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    return new URL(u).href
  } catch {
    return ''
  }
}

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

async function pageLooksLoggedIn(page) {
  return page.evaluate(() => {
    const href = window.location.href
    const hrefL = href.toLowerCase()
    if (!document.body) return false

    const bodyHtml = document.body.innerHTML || ''
    const bodyText = (document.body.innerText || '').toLowerCase()

    const onPasswordGate =
      /webapps\/login|\/login\?|sign-?in|saml|auth-saml|idp\/|\/sso\//i.test(href) &&
      document.querySelector('input[type="password"]')
    if (onPasswordGate) return false

    if (
      document.querySelector(
        'a[href*="logout"], a[href*="Logout"], a[href*="/ultra/logout"], #logout'
      )
    )
      return true

    if (
      document.querySelectorAll(
        'a[href*="course_id="], a[href*="/ultra/course/"], a[href*="/ultra/courses/"]'
      ).length > 0
    )
      return true

    if (
      bodyHtml.includes('Log Out') ||
      bodyText.includes('log out') ||
      bodyText.includes('sign out')
    )
      return true

    if (/\/webapps\/portal/i.test(hrefL) && !/\/webapps\/login/i.test(hrefL)) return true

    if (/\/ultra\//i.test(hrefL) && !/password|login/i.test(hrefL)) {
      const hasChrome =
        document.querySelector(
          'bb-ultra, bb-nav, c360-sidenav, [class*="branding"] [class*="avatar"]'
        ) != null
      if (hasChrome) return true
    }

    return false
  })
}

export function isSsoPending(sessionId) {
  return ssoSessions.has(sessionId)
}

export function getSsoSessionStatus(sessionId) {
  const e = ssoSessions.get(sessionId)
  if (!e) return null
  return {
    exists: true,
    status: e.status,
    mode: 'sso_pending',
    createdAt: e.createdAt,
    blackboardUrl: e.blackboardUrl,
  }
}

/**
 * @param {object} opts
 * @param {string} opts.blackboardUrl
 * @param {string} [opts.learnBaseUrl]
 * @param {boolean} [opts.useSameBrowser]
 * @param {string} [opts.cdpUrl]
 * @param {string} [opts.browserChannel]
 * @param {boolean} [opts.alsoOpenInDefaultBrowser]
 */
export async function startBlackboardSsoSession(opts) {
  const {
    blackboardUrl,
    learnBaseUrl,
    useSameBrowser = false,
    cdpUrl: cdpFromBody,
    browserChannel: browserChannelFromBody,
    alsoOpenInDefaultBrowser = false,
  } = opts || {}

  const startUrl = normalizeStartUrl(blackboardUrl)
  if (!startUrl) {
    throw new Error('Invalid blackboardUrl')
  }

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
        console.log(`[Blackboard SSO] Session ${sessionId} connected via CDP ${cdpUrl}`)
      } catch (e) {
        console.warn(`[Blackboard SSO] CDP failed (${e.message}); launching Chromium.`)
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

    console.log(`[Blackboard SSO] Session ${sessionId} → ${startUrl}`)
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 120000 })

    if (alsoOpenInDefaultBrowser) {
      try {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        const { platform } = process
        if (platform === 'win32') {
          await execAsync(`start "" "${startUrl}"`)
        } else if (platform === 'darwin') {
          await execAsync(`open "${startUrl}"`)
        } else {
          await execAsync(`xdg-open "${startUrl}"`)
        }
      } catch (e) {
        console.warn('[Blackboard SSO] alsoOpenInDefaultBrowser:', e.message)
      }
    }

    ssoSessions.set(sessionId, {
      status: 'pending',
      browser,
      context,
      page,
      blackboardUrl: startUrl,
      learnBaseUrl: learnBaseUrl ? String(learnBaseUrl).trim() : '',
      createdAt: Date.now(),
      finalizePromise: null,
      ownsBrowser,
      attachedToExistingBrowser,
      launchChannel: launchChannelUsed,
    })

    return {
      sessionId,
      message:
        'Complete Blackboard / SSO sign-in in the browser window. Return here and we will detect when you are signed in.',
      blackboardUrl: startUrl,
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

async function runFinalize(sessionId, entry) {
  const cookies = await entry.context.cookies()
  const client = new BlackboardHttpSession({
    entryUrl: entry.blackboardUrl,
    learnBaseUrl: entry.learnBaseUrl || undefined,
    username: '',
    password: '',
  })
  await client.applyPlaywrightCookies(cookies)
  const ok = await client.verifyCookieSession()
  if (!ok) {
    throw new Error(
      'Could not verify Blackboard session after SSO. Finish logging in at your school, then try Check login again.'
    )
  }

  try {
    if (entry.attachedToExistingBrowser) {
      await entry.page?.close({ runBeforeUnload: false }).catch(() => {})
    } else {
      await entry.context?.close().catch(() => {})
      await entry.browser?.close().catch(() => {})
    }
  } catch {
    /* ignore */
  }

  ssoSessions.delete(sessionId)
  registerBlackboardHttpSession(sessionId, client, entry.blackboardUrl)
}

export async function closeAllBlackboardSsoSessions() {
  const ids = [...ssoSessions.keys()]
  for (const id of ids) {
    await closeBlackboardSsoSession(id).catch(() => {})
  }
}

/**
 * Poll login; when the browser shows a logged-in Blackboard session, imports cookies and registers an HTTP session.
 */
export async function checkBlackboardSsoLogin(sessionId) {
  const entry = ssoSessions.get(sessionId)
  if (!entry) return null

  if (entry.finalizePromise) {
    try {
      await entry.finalizePromise
    } catch (e) {
      const ep = ssoSessions.get(sessionId)
      return {
        loggedIn: false,
        currentUrl: ep?.page?.url?.() ?? '',
        error: e.message,
        mode: 'sso_pending',
      }
    }
    return { loggedIn: true, currentUrl: null, mode: 'http' }
  }

  let loggedIn = false
  let currentUrl = ''
  try {
    loggedIn = await pageLooksLoggedIn(entry.page)
    currentUrl = entry.page.url()
  } catch (e) {
    return {
      loggedIn: false,
      currentUrl: '',
      error: e.message,
      mode: 'sso_pending',
    }
  }

  if (!loggedIn) {
    return { loggedIn: false, currentUrl, mode: 'sso_pending' }
  }

  entry.status = 'finalizing'
  entry.finalizePromise = runFinalize(sessionId, entry).catch((err) => {
    entry.status = 'pending'
    entry.finalizePromise = null
    throw err
  })

  try {
    await entry.finalizePromise
  } catch (e) {
    return {
      loggedIn: false,
      currentUrl,
      error: e.message,
      mode: 'sso_pending',
    }
  }

  return { loggedIn: true, currentUrl, mode: 'http' }
}

export async function closeBlackboardSsoSession(sessionId) {
  const entry = ssoSessions.get(sessionId)
  if (!entry) return
  try {
    if (entry.attachedToExistingBrowser) {
      await entry.page?.close({ runBeforeUnload: false }).catch(() => {})
      await entry.browser?.close().catch(() => {})
    } else {
      await entry.context?.close().catch(() => {})
      await entry.browser?.close().catch(() => {})
    }
  } finally {
    ssoSessions.delete(sessionId)
  }
}

export function closeSsoIfAny(sessionId) {
  if (ssoSessions.has(sessionId)) {
    void closeBlackboardSsoSession(sessionId)
  }
}
