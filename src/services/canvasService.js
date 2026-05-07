/**
 * Canvas LMS integration via backend (OAuth + token proxy).
 */

import { apiUrl } from './apiBase.js'

const api = (path) => apiUrl(`/api${path}`)

export async function getCanvasConfig() {
  const res = await fetch(api('/canvas/config'))
  return res.json()
}

export async function startCanvasOAuth(canvasBaseUrl) {
  const res = await fetch(api('/canvas/oauth/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvasBaseUrl: canvasBaseUrl.trim() })
  })
  return res.json()
}

export async function syncCanvasOAuthSession(sessionId) {
  const res = await fetch(api('/canvas/sync'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  })
  return res.json()
}

export async function syncCanvasWithToken(canvasBaseUrl, accessToken) {
  const res = await fetch(api('/canvas/sync-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canvasBaseUrl: canvasBaseUrl.trim(),
      accessToken: accessToken.trim()
    })
  })
  return res.json()
}

export async function revokeCanvasServerSession(sessionId) {
  if (!sessionId) return { success: true }
  await fetch(api('/canvas/session/revoke'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  })
  return { success: true }
}
