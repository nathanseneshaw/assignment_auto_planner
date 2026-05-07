import { randomUUID } from 'crypto'
import { BlackboardHttpSession } from './blackboard-http-session.js'

/** @type {Map<string, { client: BlackboardHttpSession, blackboardUrl: string, createdAt: number, status: string }>} */
const sessions = new Map()

/**
 * @param {object} body
 * @param {string} body.blackboardUrl
 * @param {string} [body.learnBaseUrl]
 * @param {string} body.username
 * @param {string} body.password
 */
export function createBlackboardBrowserSession(body) {
  const { blackboardUrl, learnBaseUrl, username, password } = body
  return new BlackboardHttpSession({
    entryUrl: blackboardUrl,
    learnBaseUrl: learnBaseUrl || undefined,
    username,
    password,
  })
}

/**
 * @param {object} opts
 * @param {string} opts.blackboardUrl
 * @param {string} [opts.learnBaseUrl]
 * @param {string} opts.username
 * @param {string} opts.password
 */
export async function openBlackboardHttpSession(opts) {
  const client = createBlackboardBrowserSession(opts)
  const loginResult = await client.login()
  if (!loginResult.success) {
    return {
      ok: false,
      error: loginResult.error || client.getResponse(),
      sessionId: null,
      needsSso: !!loginResult.needsSso,
    }
  }
  const sessionId = randomUUID()
  sessions.set(sessionId, {
    client,
    blackboardUrl: opts.blackboardUrl,
    createdAt: Date.now(),
    status: 'logged_in',
  })
  return { ok: true, sessionId, error: null }
}

export function getBlackboardHttpSessionEntry(sessionId) {
  return sessions.get(sessionId) || null
}

/**
 * Register an HTTP session (e.g. after SSO cookie import). Same sessionId as the SSO flow.
 * @param {string} sessionId
 * @param {import('./blackboard-http-session.js').BlackboardHttpSession} client
 * @param {string} blackboardUrl
 */
export function registerBlackboardHttpSession(sessionId, client, blackboardUrl) {
  sessions.set(sessionId, {
    client,
    blackboardUrl,
    createdAt: Date.now(),
    status: 'logged_in',
  })
}

/**
 * @param {string} sessionId
 * @param {(p: object) => void} [onProgress]
 */
export async function syncBlackboardHttpSession(sessionId, onProgress) {
  const entry = sessions.get(sessionId)
  if (!entry) throw new Error('Session not found')
  entry.status = 'syncing'
  try {
    const data = await entry.client.syncToAppResults(onProgress)
    entry.status = 'complete'
    return data
  } catch (e) {
    entry.status = 'error'
    throw e
  }
}

export function checkBlackboardHttpLogin(sessionId) {
  const entry = sessions.get(sessionId)
  if (!entry) return { loggedIn: false, error: 'Session not found' }
  return {
    loggedIn: entry.client.isLoggedIn,
    status: entry.status,
    currentUrl: null,
  }
}

export function closeBlackboardHttpSession(sessionId) {
  sessions.delete(sessionId)
}

export function getBlackboardHttpSessionStatus(sessionId) {
  const entry = sessions.get(sessionId)
  if (!entry) return { exists: false }
  return {
    exists: true,
    status: entry.status,
    createdAt: entry.createdAt,
    blackboardUrl: entry.blackboardUrl,
  }
}
