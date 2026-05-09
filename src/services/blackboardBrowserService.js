// Blackboard sync — extension-imported cookie sessions (see /api/blackboard routes).

import { apiUrl } from './apiBase.js'
import { fetchApiJson } from './fetchApiJson.js'

const API_BASE = '/api/blackboard'

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

export { apiUrl }
