/**
 * Thin client wrapper around the backend `/api/ics/*` routes.
 *
 * All calls are authenticated using the current Supabase session's access token,
 * which the backend verifies against the user's row in the `ics_feeds` table.
 * Callers should catch errors; the underlying `fetchApiJson` throws on non-2xx
 * responses with a friendly message.
 */
import { fetchApiJson } from './fetchApiJson'
import { supabase } from '../lib/supabase'

/**
 * Build the `Authorization: Bearer <jwt>` header for an ICS API call.
 * Throws if Supabase is not configured or there is no active session, so the UI
 * can surface a clear "please sign in" message instead of a generic 401.
 */
async function authHeaders() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data?.session?.access_token
  if (!token) throw new Error('You must be signed in to manage ICS feeds.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/** GET the user's saved ICS feed subscriptions. Returns `[]` when none exist. */
export async function listFeeds() {
  const headers = await authHeaders()
  const res = await fetchApiJson('/api/ics/feeds', { headers })
  return res.feeds || []
}

/**
 * Subscribe to a new ICS feed.
 * @param {string} url   Public ICS URL (webcal://, http(s)://).
 * @param {string} [label] Optional human-friendly name shown in the UI.
 * @returns {Promise<object>} The newly created feed row.
 */
export async function addFeed(url, label) {
  const headers = await authHeaders()
  const res = await fetchApiJson('/api/ics/feeds', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, label: label || null }),
  })
  return res.feed
}

/** Delete a single feed by its row id. Resolves to `true` on success. */
export async function removeFeed(id) {
  const headers = await authHeaders()
  await fetchApiJson(`/api/ics/feeds/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  })
  return true
}

/** Trigger a server-side fetch+parse for all of the user's feeds. */
export async function syncAll() {
  const headers = await authHeaders()
  return fetchApiJson('/api/ics/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
}

/** Same as {@link syncAll} but restricted to a single feed. */
export async function syncOne(feedId) {
  const headers = await authHeaders()
  return fetchApiJson('/api/ics/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ feedId }),
  })
}
