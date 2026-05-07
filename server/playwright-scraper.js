import {
  startBlackboardSsoSession,
  checkBlackboardSsoLogin,
  closeBlackboardSsoSession,
  getSsoSessionStatus,
  closeAllBlackboardSsoSessions,
} from './blackboard-sso-bridge.js'
import {
  syncBlackboardHttpSession,
  closeBlackboardHttpSession,
  getBlackboardHttpSessionStatus,
  checkBlackboardHttpLogin,
} from './blackboard-http-manager.js'
import {
  startCanvasBrowserSession,
  checkCanvasBrowserLogin,
  syncCanvasBrowserCookieSession,
  closeCanvasBrowserSession,
  getCanvasBrowserSessionStatus,
  closeAllCanvasBrowserSessions,
} from './canvas-browser-bridge.js'

export async function createPlaywrightLoginSession(blackboardUrl, opts = {}) {
  return startBlackboardSsoSession({ blackboardUrl, ...opts })
}

export async function checkPlaywrightBlackboardLogin(sessionId) {
  const ssoResult = await checkBlackboardSsoLogin(sessionId)
  if (ssoResult) return ssoResult
  return checkBlackboardHttpLogin(sessionId)
}

export async function syncPlaywrightBlackboardAfterLogin(sessionId, onProgress) {
  return syncBlackboardHttpSession(sessionId, onProgress)
}

export async function closePlaywrightBlackboardSession(sessionId) {
  await closeBlackboardSsoSession(sessionId).catch(() => {})
  closeBlackboardHttpSession(sessionId)
}

export function getPlaywrightBlackboardSessionStatus(sessionId) {
  const sso = getSsoSessionStatus(sessionId)
  if (sso?.exists) return sso
  return getBlackboardHttpSessionStatus(sessionId)
}

export async function createPlaywrightCanvasLoginSession(canvasUrl, opts = {}) {
  return startCanvasBrowserSession({ canvasUrl, ...opts })
}

export async function checkPlaywrightCanvasLogin(sessionId) {
  return checkCanvasBrowserLogin(sessionId)
}

export async function syncPlaywrightCanvasAfterLogin(sessionId, onProgress) {
  return syncCanvasBrowserCookieSession(sessionId, onProgress)
}

export async function closePlaywrightCanvasSession(sessionId) {
  return closeCanvasBrowserSession(sessionId)
}

export function getPlaywrightCanvasSessionStatus(sessionId) {
  return getCanvasBrowserSessionStatus(sessionId)
}

export async function closeAllPlaywrightSessions() {
  await Promise.all([closeAllBlackboardSsoSessions(), closeAllCanvasBrowserSessions()])
}
