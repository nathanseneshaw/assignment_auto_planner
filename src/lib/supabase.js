/**
 * Supabase client singleton used by the browser-side app.
 *
 * Reads credentials from Vite-injected env vars (`VITE_*`). When either value is missing
 * or blank, `supabase` is `null` so callers can degrade gracefully (the app should still
 * boot in pure local-storage mode without a backend).
 *
 * Auth options:
 * - persistSession    : keep the session in localStorage between reloads.
 * - autoRefreshToken  : transparently refresh the access token before it expires.
 * - detectSessionInUrl: DISABLED on purpose — see captureAuthCallback below. Email
 *   confirmation / email-change links must NOT turn their own tab into a logged-in
 *   app instance; the only path to a session is an explicit signInWithPassword.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Snapshot the Supabase auth-callback parameters from the URL the app booted
 * with, synchronously at module load. Email links land here with implicit-flow
 * tokens in the hash (e.g. `#access_token=...&type=signup`), or an
 * `error_description` when the link is expired/invalid.
 *
 * Why we capture instead of letting the client consume the URL: with
 * `detectSessionInUrl` the client would parse that token and persist a session
 * into localStorage — which is SHARED across tabs in the same browser. That
 * would log BOTH the email-link tab AND the original signup tab into the app,
 * which is exactly what we don't want. Instead:
 *   - the email-link tab stays a pure "you're confirmed, close this tab" page and
 *     never holds a session (it reads this snapshot to decide what to render), and
 *   - the original signup tab signs ITSELF in by polling signInWithPassword once
 *     the email is confirmed, making it the single logged-in instance.
 *
 * Two consumers:
 *   - getAuthCallback()        non-consuming; the confirm / verify pages read it.
 *   - consumeAuthCallbackPin() one-shot; the router pins this tab to the right
 *     "close this tab" page even when Supabase fell back to the Site URL because
 *     the redirect was not allowlisted.
 */
function captureAuthCallback() {
  if (typeof window === 'undefined') {
    return { type: null, status: null, error: '' }
  }
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const read = (key) => hash.get(key) || query.get(key)
    const type = read('type')
    const rawError = read('error_description') || read('error') || ''
    const hasToken = Boolean(read('access_token') || read('code') || read('token_hash'))
    let status = null
    if (rawError) status = 'error'
    else if (hasToken || type) status = 'confirmed'
    return { type, status, error: rawError ? rawError.replace(/\+/g, ' ') : '' }
  } catch {
    return { type: null, status: null, error: '' }
  }
}

const _authCallback = captureAuthCallback()
let _pinConsumed = false

/** Non-consuming read of the boot-time auth-callback snapshot. */
export function getAuthCallback() {
  return _authCallback
}

/**
 * One-shot: the path this tab should be pinned to when it booted from an email
 * link ('/auth/verify-email' for an email change, '/auth/confirm' otherwise), or
 * null when this is an ordinary app load. One-shot so the user is not trapped on
 * the confirm page once they navigate away.
 */
export function consumeAuthCallbackPin() {
  if (_pinConsumed || !_authCallback.status) return null
  _pinConsumed = true
  return _authCallback.type === 'email_change' ? '/auth/verify-email' : '/auth/confirm'
}

/** True only when both URL and anon key are present and non-empty. */
export const isSupabaseConfigured = Boolean(
  url && anonKey && String(url).trim() && String(anonKey).trim()
)

/** Configured Supabase client, or `null` when env vars are missing. */
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Intentionally false: see captureAuthCallback. Email-link tabs never
        // establish a session of their own.
        detectSessionInUrl: false,
      },
    })
  : null
