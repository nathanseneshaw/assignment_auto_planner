/**
 * Express router for ICS feed CRUD and sync.
 *
 * All routes require the caller to send a Supabase JWT in `Authorization:
 * Bearer <token>`. The middleware {@link requireUser} verifies the token and
 * attaches a per-request, JWT-scoped Supabase client (`req.supabase`) — the
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
 *   GET    /api/ics/feeds       — list the caller's feeds.
 *   POST   /api/ics/feeds       — subscribe to a feed (validates URL by fetching once).
 *   DELETE /api/ics/feeds/:id   — unsubscribe (DB row only; no Supabase storage purge).
 *   POST   /api/ics/sync        — fetch + parse + write for one feed (or all of the user's).
 */
import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from 'express-rate-limit'
import WebSocket from 'ws'
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
    // realtime, but supabase-js still probes for a transport — provide `ws`
    // so it doesn't warn on every client construction.
    realtime: { transport: WebSocket },
  })
}

// Lazily created — only used when SUPABASE_SERVICE_ROLE_KEY is present.
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

/** Validates the JWT by calling getUser() and attaches { user, supabase } to req. */
async function requireUser(req, res, next) {
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
    console.error('[requireUser]', e)
    res.status(500).json({ success: false, error: 'Authentication error' })
  }
}

/**
 * Per-user rate limiter — applied after requireUser so req.user.id is
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
      res.status(429).json({ success: false, error: 'Too many requests — please slow down.' })
    },
  })
}

// 60 CRUD requests per 15 min per user.
const crudLimiter = makeIcsLimiter(60, 15 * 60 * 1000)
// 20 sync requests per 5 min per user — syncs hit Supabase heavily.
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
async function syncOneFeed(userSupabase, writeClient, userId, feed) {
  const startedAt = new Date().toISOString()
  try {
    const text = await fetchIcsFeed(feed.url)
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
    await writeClient
      .from('ics_feeds')
      .update({
        last_synced_at: startedAt,
        // Only mark `error` when there were events but none landed. Otherwise
        // we'd flap to red on transient single-row failures.
        last_sync_status: writeErrors.length > 0 && occurrences.length > 0 && counts.assignmentsInserted + counts.assignmentsUpdated === 0 ? 'error' : 'success',
        last_sync_error: syncError,
      })
      .eq('id', feed.id)
      .eq('user_id', userId)
    return {
      feedId: feed.id,
      success: true,
      ...counts,
      occurrenceCount: occurrences.length,
      writeErrors: counts.errors || [],
    }
  } catch (e) {
    const msg = e?.message || String(e)
    await writeClient
      .from('ics_feeds')
      .update({
        last_synced_at: startedAt,
        last_sync_status: 'error',
        last_sync_error: msg.slice(0, 500),
      })
      .eq('id', feed.id)
      .eq('user_id', userId)
    return { feedId: feed.id, success: false, error: msg }
  }
}

/**
 * Sync one feed (when `feedId` is supplied) or every feed the user owns.
 *
 * Feeds are processed serially — the Supabase free tier limits concurrent
 * inserts and we'd rather take a few extra seconds than have one feed's
 * burst starve the others. Per-feed results are aggregated into `totals`.
 */
router.post('/api/ics/sync', requireUser, syncLimiter, async (req, res) => {
  const feedId = req.body?.feedId || null
  try {
    let q = req.supabase.from('ics_feeds').select('id, url, label').eq('user_id', req.user.id)
    if (feedId) q = q.eq('id', feedId)
    const { data: feeds, error } = await q
    if (error) throw error
    if (!feeds || feeds.length === 0) {
      return res.json({ success: true, syncedFeeds: 0, results: [] })
    }

    // Use the service-role client for writes when available; fall back to
    // the user-scoped client so Electron builds (no service key) still work.
    const writeClient = getServiceClient() || req.supabase

    // Serial loop on purpose — see route header comment.
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
      { coursesInserted: 0, coursesUpdated: 0, assignmentsInserted: 0, assignmentsUpdated: 0 }
    )

    res.json({
      success: true,
      syncedFeeds: results.length,
      totals,
      results,
    })
  } catch (e) {
    console.error('[POST /api/ics/sync]', e)
    res.status(500).json({ success: false, error: 'Sync failed' })
  }
})

export default router
