/**
 * Express router for ICS feed CRUD and sync.
 *
 * All routes require the caller to send a Supabase JWT in `Authorization:
 * Bearer <token>`. The middleware {@link requireUser} verifies the token and
 * attaches a per-request, JWT-scoped Supabase client (`req.supabase`)  the
 * database's Row-Level Security policies then enforce that the user can only
 * see and modify their own rows.
 *
 * Write operations (upsert courses/assignments, update feed status) use a
 * service-role client when SUPABASE_SERVICE_ROLE_KEY is set, providing
 * defense-in-depth on top of RLS. If the key is absent the user-scoped client
 * is used as a fallback (maintains compatibility with Electron builds where
 * embedding a service-role key would be unsafe).
 *
 * Routes:
 *   GET    /api/ics/feeds        list the caller's feeds.
 *   POST   /api/ics/feeds        subscribe to a feed (validates URL by fetching once).
 *   DELETE /api/ics/feeds/:id    unsubscribe (DB row only; no Supabase storage purge).
 *   POST   /api/ics/sync         fetch + parse + write for one feed (or all of the user's).
 */
import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from 'express-rate-limit'
import WebSocket from 'ws'
import { createHash } from 'node:crypto'
import { fetchIcsFeed } from './ics-fetcher.js'
import { parseAndExpand } from './ics-parser.js'
import { writeOccurrences } from './ics-supabase-writer.js'

const router = Router()

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function getEnv() {
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
function clientFor(req) {
  const auth = req.headers.authorization || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const { url, anon } = getEnv()
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
    // Electron 34 bundles Node 20, which lacks native WebSocket. We don't use
    // realtime, but supabase-js still probes for a transport  provide `ws`
    // so it doesn't warn on every client construction.
    realtime: { transport: WebSocket },
  })
}

// Lazily created  only used when SUPABASE_SERVICE_ROLE_KEY is present.
let _serviceClient = null
function getServiceClient() {
  if (_serviceClient) return _serviceClient
  if (!SUPABASE_SERVICE_ROLE_KEY) return null
  const { url } = getEnv()
  _serviceClient = createClient(url, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  })
  return _serviceClient
}

// Short-TTL cache of validated bearer tokens. Every API hit otherwise costs a
// network round-trip to GoTrue's /auth/v1/user just to gate the 401; a burst of
// requests sharing one token (or repeated auto-sync ticks) would each re-pay it.
// Keyed by the exact token; entries expire after AUTH_CACHE_TTL_MS. RLS is
// unaffected — it's enforced by PostgREST from the JWT on every query regardless
// of whether we revalidated the token here.
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
    // Cheap bound: evict the oldest inserted entry.
    const oldest = authCache.keys().next().value
    if (oldest !== undefined) authCache.delete(oldest)
  }
  // Never let a cached entry outlive the token's own expiry — otherwise a token
  // that expires within the TTL window would keep passing the 401 gate.
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
async function requireUser(req, res, next) {
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
    console.error('[requireUser]', e)
    res.status(500).json({ success: false, error: 'Authentication error' })
  }
}

/**
 * Per-user rate limiter  applied after requireUser so req.user.id is
 * available. Sync gets a tighter window; CRUD uses the generous default.
 */
function makeIcsLimiter(max, windowMs) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => req.user?.id || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: 'Too many requests  please slow down.' })
    },
  })
}

// 60 CRUD requests per 15 min per user.
const crudLimiter = makeIcsLimiter(60, 15 * 60 * 1000)
// 20 sync requests per 5 min per user  syncs hit Supabase heavily.
const syncLimiter = makeIcsLimiter(20, 5 * 60 * 1000)

/**
 * Coerce user input into a fetchable URL: rewrite `webcal://` (the iCalendar
 * scheme handler) to `https://`, and assume `https://` when no scheme is given.
 * Returns `''` for empty input so callers can reject with a 400.
 */
function normalizeUrlInput(input) {
  let s = String(input || '').trim()
  if (!s) return ''
  if (s.startsWith('webcal://')) s = 'https://' + s.slice('webcal://'.length)
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s
}

router.get('/api/ics/feeds', requireUser, crudLimiter, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('ics_feeds')
      .select('id, url, label, last_synced_at, last_sync_status, last_sync_error, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ success: true, feeds: data || [] })
  } catch (e) {
    console.error('[GET /api/ics/feeds]', e)
    res.status(500).json({ success: false, error: 'Failed to retrieve feeds' })
  }
})

router.post('/api/ics/feeds', requireUser, crudLimiter, async (req, res) => {
  const url = normalizeUrlInput(req.body?.url)
  const label = req.body?.label ? String(req.body.label).trim().slice(0, 200) : null
  if (!url) return res.status(400).json({ success: false, error: 'url is required' })

  try {
    // Validate the URL by fetching and parsing once before persisting.
    const text = await fetchIcsFeed(url)
    parseAndExpand(text) // throws on bad body
  } catch (e) {
    console.error('[POST /api/ics/feeds] validation:', e)
    return res.status(400).json({ success: false, error: 'The feed URL could not be fetched or parsed.' })
  }

  try {
    const { data, error } = await req.supabase
      .from('ics_feeds')
      .insert({ user_id: req.user.id, url, label, last_sync_status: 'pending' })
      .select('id, url, label, last_synced_at, last_sync_status, last_sync_error, created_at')
      .single()
    if (error) {
      // Surface unique-violation as 409 for clarity
      if (String(error.code) === '23505') {
        return res.status(409).json({ success: false, error: 'You already have this feed URL.' })
      }
      throw error
    }
    res.json({ success: true, feed: data })
  } catch (e) {
    console.error('[POST /api/ics/feeds] insert:', e)
    res.status(500).json({ success: false, error: 'Failed to save feed' })
  }
})

/**
 * Unsubscribe and cascade-delete everything imported from this feed:
 * linked tasks → assignments → courses → the feed row itself. All filters
 * include user_id as a defence-in-depth check on top of RLS.
 */
router.delete('/api/ics/feeds/:id', requireUser, crudLimiter, async (req, res) => {
  try {
    const feedId = req.params.id
    const userId = req.user.id

    const [assignmentsRes, coursesRes] = await Promise.all([
      req.supabase
        .from('assignments')
        .select('id')
        .eq('feed_id', feedId)
        .eq('user_id', userId),
      req.supabase
        .from('courses')
        .select('id')
        .eq('feed_id', feedId)
        .eq('user_id', userId),
    ])
    if (assignmentsRes.error) throw assignmentsRes.error
    if (coursesRes.error) throw coursesRes.error

    const assignmentIds = (assignmentsRes.data || []).map(r => r.id)
    const courseIds = (coursesRes.data || []).map(r => r.id)

    // Clear tasks first so FK references don't block the cascade.
    if (assignmentIds.length > 0) {
      const { error } = await req.supabase
        .from('tasks')
        .delete()
        .in('assignment_id', assignmentIds)
        .eq('user_id', userId)
      if (error) throw error
    }
    if (courseIds.length > 0) {
      const { error } = await req.supabase
        .from('tasks')
        .delete()
        .in('course_id', courseIds)
        .eq('user_id', userId)
      if (error) throw error
    }

    const { error: assignErr } = await req.supabase
      .from('assignments')
      .delete()
      .eq('feed_id', feedId)
      .eq('user_id', userId)
    if (assignErr) throw assignErr

    const { error: courseErr } = await req.supabase
      .from('courses')
      .delete()
      .eq('feed_id', feedId)
      .eq('user_id', userId)
    if (courseErr) throw courseErr

    const { error: feedErr } = await req.supabase
      .from('ics_feeds')
      .delete()
      .eq('id', feedId)
      .eq('user_id', userId)
    if (feedErr) throw feedErr

    res.json({ success: true })
  } catch (e) {
    console.error('[DELETE /api/ics/feeds/:id]', e)
    res.status(500).json({ success: false, error: 'Failed to delete feed' })
  }
})

/**
 * Run the full pipeline for one feed: fetch ICS text → parse → write to DB →
 * record the result on the `ics_feeds` row.
 *
 * writeClient is the service-role client when available; it bypasses RLS so
 * all writes must carry an explicit user_id filter (they do). Falls back to
 * the user-scoped client when the service-role key is not configured.
 *
 * - "Partial-success" semantics: per-row write errors are collected but the
 *   sync as a whole is still considered successful unless *every* occurrence
 *   failed to insert (i.e. the feed had events but nothing landed in the DB).
 * - Fetch / parse failures fall through to the catch block and mark the feed
 *   `error` with the message truncated to 500 chars.
 */
/** sha256 of the raw feed body — used to skip writes when nothing changed. */
function feedContentHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// Capability flag for the optional `ics_feeds.content_hash` column:
// null = not probed yet, true = present, false = absent (degrade to always-sync).
let feedHashColumn = null

/** True when a PostgREST error means the column simply doesn't exist. */
function isUndefinedColumnErr(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42703' || code === 'PGRST204') return true
  return /content_hash/i.test(error.message || '') && /column|schema cache|does not exist/i.test(error.message || '')
}

/**
 * Select the feeds to sync, including `content_hash` when the column exists.
 * Feature-detects once: if the richer select errors with an undefined column,
 * remember that and fall back to the base columns for the rest of the process.
 */
async function selectSyncFeeds(supabase, userId, feedId) {
  const base = 'id, url, label'
  const run = (cols) => {
    let q = supabase.from('ics_feeds').select(cols).eq('user_id', userId)
    if (feedId) q = q.eq('id', feedId)
    return q
  }
  if (feedHashColumn === false) return run(base)

  const { data, error } = await run(`${base}, content_hash`)
  if (!error) {
    feedHashColumn = true
    return { data, error: null }
  }
  if (isUndefinedColumnErr(error)) {
    feedHashColumn = false
    return run(base)
  }
  return { data, error }
}

/**
 * Update a feed's sync-status row, storing `content_hash` when supported.
 * If the write fails purely because the column is absent, flip the capability
 * flag and retry without it so a missing migration never breaks sync.
 */
async function updateFeedStatus(writeClient, userId, feedId, patch, newHash) {
  const includeHash = feedHashColumn !== false && newHash != null
  const body = includeHash ? { ...patch, content_hash: newHash } : { ...patch }
  const { error } = await writeClient
    .from('ics_feeds')
    .update(body)
    .eq('id', feedId)
    .eq('user_id', userId)
  if (error && includeHash && isUndefinedColumnErr(error)) {
    feedHashColumn = false
    await writeClient
      .from('ics_feeds')
      .update(patch)
      .eq('id', feedId)
      .eq('user_id', userId)
  }
}

async function syncOneFeed(userSupabase, writeClient, userId, feed) {
  const startedAt = new Date().toISOString()
  try {
    const text = await fetchIcsFeed(feed.url)
    const newHash = feedContentHash(text)

    // Fast path: the feed body is byte-identical to the last successful sync,
    // so there is nothing to parse or write. Just stamp the timestamp.
    if (feedHashColumn === true && feed.content_hash && feed.content_hash === newHash) {
      await updateFeedStatus(
        writeClient,
        userId,
        feed.id,
        { last_synced_at: startedAt, last_sync_status: 'success', last_sync_error: null },
        newHash
      )
      return {
        feedId: feed.id,
        success: true,
        skipped: true,
        coursesInserted: 0,
        coursesUpdated: 0,
        assignmentsInserted: 0,
        assignmentsUpdated: 0,
        assignmentsUnchanged: 0,
        occurrenceCount: 0,
        writeErrors: [],
      }
    }

    const { occurrences } = parseAndExpand(text, {
      feedLabel: feed.label || null,
      feedId: feed.id,
    })
    const counts = await writeOccurrences({
      supabase: writeClient,
      userId,
      feedId: feed.id,
      occurrences,
    })
    const writeErrors = counts.errors || []
    const syncError = writeErrors.length > 0
      ? `${writeErrors.length} item(s) failed to save: ${writeErrors[0].error}`
      : null
    await updateFeedStatus(
      writeClient,
      userId,
      feed.id,
      {
        last_synced_at: startedAt,
        // Only mark `error` when there were events but none landed. Otherwise
        // we'd flap to red on transient single-row failures.
        last_sync_status: writeErrors.length > 0 && occurrences.length > 0 && counts.assignmentsInserted + counts.assignmentsUpdated === 0 ? 'error' : 'success',
        last_sync_error: syncError,
      },
      // Only cache the hash on a clean write — otherwise a partial failure would
      // be treated as "unchanged" next time and never retried.
      writeErrors.length === 0 ? newHash : null
    )
    return {
      feedId: feed.id,
      success: true,
      ...counts,
      occurrenceCount: occurrences.length,
      writeErrors: counts.errors || [],
    }
  } catch (e) {
    const msg = e?.message || String(e)
    await updateFeedStatus(
      writeClient,
      userId,
      feed.id,
      { last_synced_at: startedAt, last_sync_status: 'error', last_sync_error: msg.slice(0, 500) },
      null
    )
    return { feedId: feed.id, success: false, error: msg }
  }
}

/**
 * Sync one feed (when `feedId` is supplied) or every feed the user owns.
 *
 * Feeds are processed serially  the Supabase free tier limits concurrent
 * inserts and we'd rather take a few extra seconds than have one feed's
 * burst starve the others. Per-feed results are aggregated into `totals`.
 */
const ZERO_TOTALS = { coursesInserted: 0, coursesUpdated: 0, assignmentsInserted: 0, assignmentsUpdated: 0 }

router.post('/api/ics/sync', requireUser, syncLimiter, async (req, res) => {
  const feedId = req.body?.feedId || null
  try {
    const { data: feeds, error } = await selectSyncFeeds(req.supabase, req.user.id, feedId)
    if (error) throw error
    if (!feeds || feeds.length === 0) {
      return res.json({ success: true, syncedFeeds: 0, changed: false, totals: { ...ZERO_TOTALS }, results: [], feeds: [] })
    }

    // Use the service-role client for writes when available; fall back to
    // the user-scoped client so Electron builds (no service key) still work.
    const writeClient = getServiceClient() || req.supabase

    // Serial loop on purpose  see route header comment.
    const results = []
    for (const f of feeds) {
      const r = await syncOneFeed(req.supabase, writeClient, req.user.id, f)
      results.push(r)
    }

    const totals = results.reduce(
      (acc, r) => {
        if (r.success) {
          acc.coursesInserted += r.coursesInserted || 0
          acc.coursesUpdated += r.coursesUpdated || 0
          acc.assignmentsInserted += r.assignmentsInserted || 0
          acc.assignmentsUpdated += r.assignmentsUpdated || 0
        }
        return acc
      },
      { ...ZERO_TOTALS }
    )

    // True when the DB actually changed — lets the client skip a re-hydration
    // round-trip (getUser + 3 table selects) on the common no-op sync.
    const changed =
      totals.coursesInserted + totals.coursesUpdated + totals.assignmentsInserted + totals.assignmentsUpdated > 0

    // Return refreshed feed rows so the client doesn't need a follow-up GET
    // /api/ics/feeds (which would re-validate the token and re-select).
    let feedRows = []
    try {
      const { data, error: feedsErr } = await req.supabase
        .from('ics_feeds')
        .select('id, url, label, last_synced_at, last_sync_status, last_sync_error, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: true })
      if (!feedsErr) feedRows = data || []
    } catch {
      // Non-fatal — the client keeps its cached feed list.
    }

    res.json({
      success: true,
      syncedFeeds: results.length,
      changed,
      totals,
      results,
      feeds: feedRows,
    })
  } catch (e) {
    console.error('[POST /api/ics/sync]', e)
    res.status(500).json({ success: false, error: 'Sync failed' })
  }
})

export default router
