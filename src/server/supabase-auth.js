/**
 * Shared Supabase JWT auth middleware for API routes.
 *
 * Builds a per-request Supabase client scoped to the caller's access token,
 * then attaches it to `req.supabase` so RLS policies enforce per-user
 * isolation. We never use the service-role key from these routes.
 *
 * Extracted from ics-routes.js so multiple routers can reuse it.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

export function getSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase env not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.'
    )
  }
  return { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY }
}

/**
 * Build a per-request Supabase client tied to the caller's JWT.
 * RLS then ensures the caller can only read/write their own rows.
 */
export function clientFor(req) {
  const auth = req.headers.authorization || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const { url, anon } = getSupabaseEnv()
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
    // Realtime is not used server-side; disabling it prevents the
    // "Node.js 20 has no native WebSocket" warning from Supabase.
    realtime: { transport: null },
  })
}

/** Validates the JWT by calling getUser() and attaches { user, supabase } to req. */
export async function requireUser(req, res, next) {
  try {
    const supabase = clientFor(req)
    if (!supabase) {
      return res.status(401).json({ success: false, error: 'Missing Authorization bearer token' })
    }
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }
    req.supabase = supabase
    req.user = data.user
    next()
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'Auth check failed' })
  }
}
