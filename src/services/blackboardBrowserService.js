// Blackboard sync — HTTP login plus optional Playwright SSO handoff (see /api/blackboard routes).

import { apiUrl } from './apiBase.js'
import { fetchApiJson } from './fetchApiJson.js'

const API_BASE = '/api/blackboard'

async function fetchJsonAlways(url, init) {
  const res = await fetch(apiUrl(url), init)
  const text = await res.text()
  const head = text.trimStart().slice(0, 64).toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<!')) {
    throw new Error(
      'The app got a web page instead of API data. Start the backend: cd src/server && npm start'
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      res.ok
        ? `Server returned non-JSON: ${text.slice(0, 160)}`
        : `HTTP ${res.status}: ${text.slice(0, 160)}`
    )
  }
}

/**
 * @param {string} blackboardUrl
 * @param {object} [options]
 * @param {string} options.username
 * @param {string} options.password
 * @param {string} [options.learnBaseUrl] Hosted Learn origin if different from vanity URL (e.g. https://school.blackboard.com)
 */
export async function startLoginSession(blackboardUrl, options = {}) {
  const { username, password, learnBaseUrl } = options
  return fetchJsonAlways(`${API_BASE}/start-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blackboardUrl,
      username,
      password,
      learnBaseUrl,
    }),
  })
}

/**
 * Open a headed browser for SSO / MFA; complete login there, then poll checkLoginStatus.
 * @param {string} blackboardUrl
 * @param {object} [options]
 * @param {string} [options.learnBaseUrl]
 * @param {boolean} [options.useSameBrowser]
 * @param {string} [options.cdpUrl]
 * @param {string} [options.browserChannel]
 * @param {boolean} [options.alsoOpenInDefaultBrowser]
 */
export async function startSsoSession(blackboardUrl, options = {}) {
  const {
    learnBaseUrl,
    useSameBrowser = false,
    cdpUrl,
    browserChannel,
    alsoOpenInDefaultBrowser = false,
  } = options
  // Current server exposes Playwright start at /start-session (no /sso prefix).
  const data = await fetchJsonAlways(`${API_BASE}/start-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blackboardUrl,
      learnBaseUrl,
      useSameBrowser,
      cdpUrl,
      browserChannel,
      alsoOpenInDefaultBrowser,
    }),
  })
  if (!data.success) {
    throw new Error(data.error || 'Failed to start SSO session')
  }
  return data
}

export async function checkLoginStatus(sessionId) {
  return fetchApiJson(`${API_BASE}/check-login/${sessionId}`)
}

export async function syncSession(sessionId) {
  return fetchApiJson(`${API_BASE}/sync-session/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function closeSession(sessionId) {
  return fetchApiJson(`${API_BASE}/close-session/${sessionId}`, {
    method: 'POST',
  })
}

export async function getSessionStatus(sessionId) {
  return fetchApiJson(`${API_BASE}/session-status/${sessionId}`)
}

export function pollLoginStatus(sessionId, onStatus, intervalMs = 1500) {
  let stopped = false

  const poll = async () => {
    if (stopped) return

    try {
      const status = await checkLoginStatus(sessionId)
      onStatus(status)

      if (!status.loggedIn && !stopped) {
        setTimeout(poll, intervalMs)
      }
    } catch (error) {
      onStatus({ loggedIn: false, error: error.message })
      if (!stopped) {
        setTimeout(poll, intervalMs)
      }
    }
  }

  poll()

  return () => {
    stopped = true
  }
}
