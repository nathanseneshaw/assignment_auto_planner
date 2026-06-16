import { apiUrl } from './apiBase.js'

/**
 * Parse JSON from a fetch response. If the server returns HTML (common when /api is not
 * proxied or the backend is down), throw a clear error instead of JSON.parse noise.
 *
 * Beyond the standard fetch `init`, two extra options are supported:
 *   - `timeoutMs`: abort the request after N ms and throw a friendly TimeoutError.
 *       Without this a slow/hung upstream (e.g. a cold course-catalog scrape) leaves
 *       the caller's promise pending forever, which locks any UI gated on a loading
 *       flag until a full page refresh.
 *   - `signal`: an external AbortSignal (e.g. to cancel a request that a newer one
 *       supersedes). Combined with `timeoutMs` — whichever fires first wins.
 */
export async function fetchApiJson(url, init = {}) {
  const { timeoutMs, signal: externalSignal, ...fetchInit } = init

  // Build a single controller that aborts on either the timeout or an external signal.
  let controller = null
  let timer = null
  let timedOut = false
  let signal = externalSignal

  if (timeoutMs || externalSignal) {
    controller = new AbortController()
    signal = controller.signal
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    }
  }

  let res
  let text
  try {
    res = await fetch(apiUrl(url), { ...fetchInit, signal })
    text = await res.text()
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (timedOut) {
        const e = new Error(
          `The request took too long (over ${Math.round(timeoutMs / 1000)}s) and was cancelled. ` +
            'The catalog server may be waking up — please try again in a moment.'
        )
        e.name = 'TimeoutError'
        throw e
      }
      // Superseded by a newer request — re-thrown as-is so callers can ignore it.
      throw err
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }

  const head = text.trimStart().slice(0, 64).toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<!')) {
    throw new Error(
      'The app got a web page instead of API data (usually index.html). ' +
        'Start the backend: cd src/server && npm start (port 3001). ' +
        'In development, API calls go to http://127.0.0.1:3001 automatically — if you still see this, ' +
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
