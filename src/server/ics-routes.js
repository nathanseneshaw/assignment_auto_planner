/**
 * Express router for ICS feed CRUD and sync.
 *
 * All routes require the caller to send a Supabase JWT in `Authorization:
 * Bearer <token>`. The middleware {@link requireUser} verifies the token and
 * attaches a per-request, JWT-scoped Supabase client (`req.supabase`) — the
 * database's Row-Level Security policies then enforce that the user can only
 * see and modify their own rows. We never use the service-role key here.
 *
 * Routes:
 *   GET    /api/ics/feeds       — list the caller's feeds.
 *   POST   /api/ics/feeds       — subscribe to a feed (validates URL by fetching once).
 *   DELETE /api/ics/feeds/:id   — unsubscribe (DB row only; no Supabase storage purge).
 *   POST   /api/ics/sync        — fetch + parse + write for one feed (or all of the user's).
 */
import { Router } from 'express'
import { fetchIcsFeed } from './ics-fetcher.js'
import { parseAndExpand } from './ics-parser.js'
import { writeOccurrences } from './ics-supabase-writer.js'
import { requireUser } from './supabase-auth.js'

const router = Router()

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

router.get('/api/ics/feeds', requireUser, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('ics_feeds')
      .select('id, url, label, last_synced_at, last_sync_status, last_sync_error, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ success: true, feeds: data || [] })
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'List failed' })
  }
})

router.post('/api/ics/feeds', requireUser, async (req, res) => {
  const url = normalizeUrlInput(req.body?.url)
  const label = req.body?.label ? String(req.body.label).trim().slice(0, 200) : null
  if (!url) return res.status(400).json({ success: false, error: 'url is required' })

  try {
    // Validate the URL by fetching and parsing once before persisting.
    const text = await fetchIcsFeed(url)
    parseAndExpand(text) // throws on bad body
  } catch (e) {
    return res.status(400).json({ success: false, error: e?.message || 'Invalid ICS URL' })
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
    res.status(500).json({ success: false, error: e?.message || 'Insert failed' })
  }
})

router.delete('/api/ics/feeds/:id', requireUser, async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('ics_feeds')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'Delete failed' })
  }
})

/**
 * Run the full pipeline for one feed: fetch ICS text → parse → write to DB →
 * record the result on the `ics_feeds` row.
 *
 * - "Partial-success" semantics: per-row write errors are collected but the
 *   sync as a whole is still considered successful unless *every* occurrence
 *   failed to insert (i.e. the feed had events but nothing landed in the DB).
 * - Fetch / parse failures fall through to the catch block and mark the feed
 *   `error` with the message truncated to 500 chars.
 */
async function syncOneFeed(supabase, userId, feed) {
  const startedAt = new Date().toISOString()
  try {
    const text = await fetchIcsFeed(feed.url)
    const { occurrences } = parseAndExpand(text, {
      feedLabel: feed.label || null,
      feedId: feed.id,
    })
    const counts = await writeOccurrences({
      supabase,
      userId,
      feedId: feed.id,
      occurrences,
    })
    const writeErrors = counts.errors || []
    const syncError = writeErrors.length > 0
      ? `${writeErrors.length} item(s) failed to save: ${writeErrors[0].error}`
      : null
    await supabase
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
    await supabase
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
router.post('/api/ics/sync', requireUser, async (req, res) => {
  const feedId = req.body?.feedId || null
  try {
    let q = req.supabase.from('ics_feeds').select('id, url, label').eq('user_id', req.user.id)
    if (feedId) q = q.eq('id', feedId)
    const { data: feeds, error } = await q
    if (error) throw error
    if (!feeds || feeds.length === 0) {
      return res.json({ success: true, syncedFeeds: 0, results: [] })
    }

    // Serial loop on purpose — see route header comment.
    const results = []
    for (const f of feeds) {
      const r = await syncOneFeed(req.supabase, req.user.id, f)
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
    res.status(500).json({ success: false, error: e?.message || 'Sync failed' })
  }
})

export default router
