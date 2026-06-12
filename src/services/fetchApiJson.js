import { apiUrl } from './apiBase.js'

/**
 * Parse JSON from a fetch response. If the server returns HTML (common when /api is not
 * proxied or the backend is down), throw a clear error instead of JSON.parse noise.
 */
export async function fetchApiJson(url, init) {
  const res = await fetch(apiUrl(url), init)
  const text = await res.text()
  const head = text.trimStart().slice(0, 64).toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<!')) {
    throw new Error(
      'The app got a web page instead of API data (usually index.html). ' +
        'Start the backend: cd src/server && npm start (port 3001). ' +
        'In development, API calls go to http://127.0.0.1:3001 automatically  if you still see this, ' +
        'the server is not running or is on another port (set VITE_API_PORT or VITE_API_BASE in .env). ' +
        'For vite preview or production static hosting, configure /api proxy or VITE_API_BASE.'
    )
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      res.ok
        ? `Server returned non-JSON: ${text.slice(0, 160)}`
        : `HTTP ${res.status}: ${text.slice(0, 160)}`
    )
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${res.status})`)
  }
  return data
}
