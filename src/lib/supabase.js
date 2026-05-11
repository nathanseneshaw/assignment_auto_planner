/**
 * Supabase client singleton used by the browser-side app.
 *
 * Reads credentials from Vite-injected env vars (`VITE_*`). When either value is missing
 * or blank, `supabase` is `null` so callers can degrade gracefully (the app should still
 * boot in pure local-storage mode without a backend).
 *
 * Auth options:
 * - persistSession   : keep the session in localStorage between reloads.
 * - autoRefreshToken : transparently refresh the access token before it expires.
 * - detectSessionInUrl: parse the magic-link / OAuth callback hash on first load.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

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
        detectSessionInUrl: true,
      },
    })
  : null
