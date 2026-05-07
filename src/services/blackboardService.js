import { apiUrl } from './apiBase.js'

const API_BASE = '/api/blackboard'

export async function testBlackboardLogin(baseUrl, username, password) {
  const response = await fetch(apiUrl(`${API_BASE}/login`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ baseUrl, username, password })
  })
  
  return response.json()
}

export async function getBlackboardCourses(baseUrl, username, password) {
  // server endpoint is singular: /course
  const response = await fetch(apiUrl(`${API_BASE}/course`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ baseUrl, username, password })
  })
  
  return response.json()
}

export async function syncBlackboard(baseUrl, username, password, courseIds = []) {
  const response = await fetch(apiUrl(`${API_BASE}/sync`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ baseUrl, username, password, courseIds })
  })
  
  return response.json()
}

export async function checkServerHealth() {
  try {
    const response = await fetch(apiUrl('/api/health'))
    const data = await response.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}
