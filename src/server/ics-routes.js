import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { fetchIcsFeed } from './ics-fetcher.js'
import { parseAndExpand } from './ics-parser.js'
import { writeOccurrences } from './ics-supabase-writer.js'

const router = Router()

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

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
    // Realtime is not used server-side; disabling it prevents the
    // "Node.js 20 has no native WebSocket" warning from Supabase.
    realtime: { transport: null },
  })
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
    res.status(500).json({ success: false, error: e?.message || 'Auth check failed' })
  }
}

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

async function syncOneFeed(supabase, userId, feed) {
  const startedAt = new Date().toISOString()
  try {
    const text = await fetchIcsFeed(feed.url)
    const { occurrences } = parseAndExpand(text)
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

router.post('/api/ics/sync', requireUser, async (req, res) => {
  const feedId = req.body?.feedId || null
  try {
    let q = req.supabase.from('ics_feeds').select('id, url').eq('user_id', req.user.id)
    if (feedId) q = q.eq('id', feedId)
    const { data: feeds, error } = await q
    if (error) throw error
    if (!feeds || feeds.length === 0) {
      return res.json({ success: true, syncedFeeds: 0, results: [] })
    }

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
