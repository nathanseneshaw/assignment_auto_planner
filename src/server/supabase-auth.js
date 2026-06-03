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

// Short-TTL cache of validated bearer tokens so repeated requests sharing one
// token don't each pay a network round-trip to GoTrue's /auth/v1/user. RLS is
// unaffected (enforced by PostgREST from the JWT on every query regardless).
const AUTH_CACHE_TTL_MS = 60_000
const AUTH_CACHE_MAX = 1000
const authCache = new Map() // token -> { user, expiresAt }

function authCacheGet(token) {
  const entry = authCache.get(token)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    authCache.delete(token)
    return null
  }
  return entry.user
}

/** Decode a JWT's `exp` (seconds) without verifying — used only to bound caching. */
function jwtExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function authCacheSet(token, user) {
  if (authCache.size >= AUTH_CACHE_MAX) {
    const oldest = authCache.keys().next().value
    if (oldest !== undefined) authCache.delete(oldest)
  }
  // Never let a cached entry outlive the token's own expiry.
  const exp = jwtExpMs(token)
  const expiresAt = exp != null
    ? Math.min(Date.now() + AUTH_CACHE_TTL_MS, exp)
    : Date.now() + AUTH_CACHE_TTL_MS
  authCache.set(token, { user, expiresAt })
}

function bearerToken(req) {
  const auth = req.headers.authorization || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  return auth.slice(auth.indexOf(' ') + 1).trim() || null
}

/** Validates the JWT (cached briefly) and attaches { user, supabase } to req. */
export async function requireUser(req, res, next) {
  try {
    const supabase = clientFor(req)
    if (!supabase) {
      return res.status(401).json({ success: false, error: 'Missing Authorization bearer token' })
    }
    const token = bearerToken(req)
    const cachedUser = token ? authCacheGet(token) : null
    if (cachedUser) {
      req.supabase = supabase
      req.user = cachedUser
      return next()
    }
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }
    if (token) authCacheSet(token, data.user)
    req.supabase = supabase
    req.user = data.user
    next()
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'Auth check failed' })
  }
}
