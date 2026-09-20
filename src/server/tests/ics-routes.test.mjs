/**
 * Tests for src/server/ics-routes.js — the ICS feed CRUD + sync router.
 *
 * ICS feeds are the app's only assignment-ingest path, so this file aims to pin
 * the whole pipeline: URL normalization, the content-hash short-circuit, the
 * "live schema lags the migrations" degradation paths, the auth cache, and the
 * four routes end to end.
 *
 * Hermetic by construction:
 *  - `globalThis.fetch` is stubbed for every test that can reach the network.
 *    supabase-js resolves `fetch` late (`(...args) => fetch(...args)`), so the
 *    stub also intercepts every Supabase round-trip; a small PostgREST/GoTrue
 *    emulator answers those.
 *  - Feed URLs use IP literals (93.184.216.34). `dns.lookup` short-circuits on
 *    numeric addresses, so the SSRF guard in ics-fetcher runs for real without
 *    ever emitting a DNS query.
 *  - The test's own HTTP client is `node:http`, not `fetch`, so it never races
 *    with the stub it installs.
 *
 * Module-level state in ics-routes.js (the auth cache and the `content_hash`
 * capability flag) is reset in beforeEach via `_internal` so tests don't bleed.
 */
import assert from 'node:assert'
import http from 'node:http'
import { describe, it, before, after, beforeEach } from 'node:test'
import express from 'express'

// Must be set before the module under test is imported: it snapshots the
// SUPABASE_* env into module-level consts at load time.
process.env.SUPABASE_URL = 'https://fake.supabase.co'
process.env.SUPABASE_ANON_KEY = 'anon-key-for-tests'
delete process.env.SUPABASE_SERVICE_ROLE_KEY

const { default: icsRouter, _internal } = await import('../ics-routes.js')
const {
  normalizeUrlInput, feedContentHash, isUndefinedColumnErr,
  selectSyncFeeds, updateFeedStatus, syncOneFeed,
  getEnv, clientFor, getServiceClient, makeIcsLimiter,
  authCache, authCacheGet, authCacheSet, jwtExpMs, bearerToken,
  AUTH_CACHE_TTL_MS, AUTH_CACHE_MAX, getFeedHashColumn, setFeedHashColumn,
} = _internal

const REAL_FETCH = globalThis.fetch

// ── ICS fixtures ──────────────────────────────────────────────────────────────

const CRLF = '\r\n'
const icsFeed = (...events) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Test Feed', ...events, 'END:VCALENDAR'].join(CRLF) + CRLF
const vevent = (fields) =>
  ['BEGIN:VEVENT', ...Object.entries(fields).map(([k, v]) => `${k}:${v}`), 'END:VEVENT'].join(CRLF)

const HW = (n, day) => vevent({
  UID: `hw${n}@test`,
  SUMMARY: `Homework ${n}`,
  DTSTART: `2026090${day}T120000Z`,
  DTEND: `2026090${day}T235900Z`,
})

const ONE_EVENT_ICS = icsFeed(HW(1, 1))
const TWO_EVENT_ICS = icsFeed(HW(1, 1), HW(2, 2))
const HTML_LOGIN_PAGE = '<html><body>Please sign in to continue</body></html>'

// ── Chainable fake Supabase client ────────────────────────────────────────────
// Same shape as the fake in ics-supabase-writer.test.mjs, extended with delete /
// order / column capture / injectable errors so the sync internals can be driven
// without going through HTTP.

function makeFakeClient(seed = {}, opts = {}) {
  let idSeq = 1
  const db = {
    ics_feeds: (seed.ics_feeds || []).map((r) => ({ ...r })),
    courses: (seed.courses || []).map((r) => ({ ...r })),
    assignments: (seed.assignments || []).map((r) => ({ ...r })),
    tasks: (seed.tasks || []).map((r) => ({ ...r })),
  }
  const log = [] // { op, table, cols, payload, eqs, in, single }
  const fail = opts.fail || (() => null)

  function applyFilters(rows, eqs, inFilter) {
    let out = rows
    for (const [col, val] of eqs) out = out.filter((r) => String(r[col]) === String(val))
    if (inFilter) {
      const set = new Set(inFilter.values.map(String))
      out = out.filter((r) => set.has(String(r[inFilter.col])))
    }
    return out
  }

  function builder(table) {
    const state = { op: null, cols: null, payload: null, eqs: [], in: null, single: false, order: null }
    const exec = () => {
      const t = db[table] || (db[table] = [])
      const ctx = { table, ...state }
      log.push(ctx)
      const injected = fail(ctx)
      if (injected) return { data: null, error: injected }

      if (state.op === 'select') {
        let rows = applyFilters(t, state.eqs, state.in).map((r) => ({ ...r }))
        if (state.order) {
          const { col, asc } = state.order
          rows = rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
        }
        return { data: state.single ? rows[0] || null : rows, error: null }
      }
      if (state.op === 'insert') {
        const arr = Array.isArray(state.payload) ? state.payload : [state.payload]
        const inserted = arr.map((row) => {
          const withId = { id: `id-${idSeq++}`, ...row }
          t.push(withId)
          return { ...withId }
        })
        return { data: state.single ? inserted[0] || null : inserted, error: null }
      }
      if (state.op === 'update') {
        const rows = applyFilters(t, state.eqs, state.in)
        for (const r of rows) Object.assign(r, state.payload)
        return { data: null, error: null }
      }
      if (state.op === 'delete') {
        const doomed = new Set(applyFilters(t, state.eqs, state.in))
        db[table] = t.filter((r) => !doomed.has(r))
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }
    const api = {
      select(cols) { if (!state.op) state.op = 'select'; state.cols = cols ?? state.cols; return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      delete() { state.op = 'delete'; return api },
      eq(col, val) { state.eqs.push([col, val]); return api },
      in(col, values) { state.in = { col, values }; return api },
      order(col, o) { state.order = { col, asc: o?.ascending !== false }; return api },
      single() { state.single = true; return api },
      maybeSingle() { state.single = true; return api },
      then(resolve, reject) {
        try { resolve(exec()) } catch (e) { reject ? reject(e) : (() => { throw e })() }
      },
    }
    return api
  }

  const calls = (op, table) => log.filter((c) => c.op === op && (!table || c.table === table))
  return { client: { from: builder }, db, log, calls }
}

// PostgREST-ish error objects.
const undefinedColumnError = { code: '42703', message: 'column ics_feeds.content_hash does not exist' }
const schemaCacheError = { code: 'PGRST204', message: "Could not find the 'content_hash' column of 'ics_feeds' in the schema cache" }
const unrelatedError = { code: '08006', message: 'connection failure' }

// ── normalizeUrlInput ─────────────────────────────────────────────────────────

describe('normalizeUrlInput', () => {
  it('rewrites webcal:// to https://', () => {
    assert.equal(normalizeUrlInput('webcal://example.edu/feed.ics'), 'https://example.edu/feed.ics')
  })

  it('trims surrounding whitespace before rewriting webcal://', () => {
    assert.equal(normalizeUrlInput('  \t webcal://example.edu/feed.ics \n '), 'https://example.edu/feed.ics')
  })

  it('assumes https:// when the scheme is missing', () => {
    assert.equal(normalizeUrlInput('example.edu/feed.ics'), 'https://example.edu/feed.ics')
  })

  it('leaves an existing https:// URL untouched', () => {
    assert.equal(normalizeUrlInput('https://example.edu/feed.ics'), 'https://example.edu/feed.ics')
  })

  it('leaves an existing http:// URL untouched (does not force TLS)', () => {
    assert.equal(normalizeUrlInput('http://example.edu/feed.ics'), 'http://example.edu/feed.ics')
  })

  it('recognises an upper-case scheme without double-prefixing', () => {
    assert.equal(normalizeUrlInput('HTTPS://EXAMPLE.EDU/f.ics'), 'HTTPS://EXAMPLE.EDU/f.ics')
    assert.equal(normalizeUrlInput('HTTP://example.edu/f.ics'), 'HTTP://example.edu/f.ics')
  })

  it('only strips the webcal:// prefix, not a webcal substring elsewhere', () => {
    assert.equal(normalizeUrlInput('example.edu/webcal://x.ics'), 'https://example.edu/webcal://x.ics')
  })

  it('returns "" for empty, whitespace-only, null and undefined input', () => {
    assert.equal(normalizeUrlInput(''), '')
    assert.equal(normalizeUrlInput('   '), '')
    assert.equal(normalizeUrlInput(null), '')
    assert.equal(normalizeUrlInput(undefined), '')
    assert.equal(normalizeUrlInput(0), '')     // String(0 || '') === ''
    assert.equal(normalizeUrlInput(false), '')
  })

  /*
   * Behaviour pin, not an endorsement: normalizeUrlInput does NOT reject
   * dangerous schemes — it blindly prefixes anything that isn't http(s)/webcal
   * with "https://". The rejection happens one layer down in
   * fetchIcsFeed -> assertPublicUrl, which is what the POST route relies on
   * (see the route test asserting a 400 for `javascript:`). Both of these
   * produce a URL that either fails to parse or fails to resolve.
   */
  it('does not itself reject file:// — it prefixes it into an unresolvable https URL', () => {
    assert.equal(normalizeUrlInput('file:///etc/passwd'), 'https://file:///etc/passwd')
  })

  it('does not itself reject javascript: — it prefixes it into an unparseable URL', () => {
    const out = normalizeUrlInput('javascript:alert(1)')
    assert.equal(out, 'https://javascript:alert(1)')
    assert.throws(() => new URL(out), /Invalid URL/)
  })

  it('does not reject data: either (also becomes unparseable/unresolvable)', () => {
    assert.equal(normalizeUrlInput('data:text/calendar,BEGIN'), 'https://data:text/calendar,BEGIN')
  })
})

// ── feedContentHash ───────────────────────────────────────────────────────────

describe('feedContentHash', () => {
  it('is stable for identical text', () => {
    assert.equal(feedContentHash(ONE_EVENT_ICS), feedContentHash(ONE_EVENT_ICS))
    assert.equal(feedContentHash('abc'), feedContentHash('abc'))
  })

  it('differs when a single character changes', () => {
    assert.notEqual(feedContentHash(ONE_EVENT_ICS), feedContentHash(ONE_EVENT_ICS + ' '))
    assert.notEqual(feedContentHash('abc'), feedContentHash('abd'))
  })

  it('returns the well-known sha256 of the empty string', () => {
    assert.equal(
      feedContentHash(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  it('always returns 64 lower-case hex characters', () => {
    for (const s of ['', 'x', ONE_EVENT_ICS, '☃ unicode é']) {
      assert.match(feedContentHash(s), /^[0-9a-f]{64}$/)
    }
  })

  it('hashes as UTF-8 (multi-byte input is not mangled or truncated)', () => {
    assert.notEqual(feedContentHash('é'), feedContentHash('e'))
    assert.equal(feedContentHash('café'), feedContentHash('café'))
  })

  it('handles a very large body (2MB, the fetcher cap) deterministically', () => {
    const big = 'a'.repeat(2 * 1024 * 1024)
    const h = feedContentHash(big)
    assert.match(h, /^[0-9a-f]{64}$/)
    assert.equal(h, feedContentHash(big))
    assert.notEqual(h, feedContentHash(big + 'a'))
  })
})

// ── isUndefinedColumnErr ──────────────────────────────────────────────────────
// Guards the graceful-degradation path used when the live Supabase schema is
// missing a column the migrations define. Both branches matter: a false negative
// breaks sync outright, a false positive silently disables the content_hash
// fast path forever.

describe('isUndefinedColumnErr — true branch', () => {
  it('matches Postgres undefined_column (42703)', () => {
    assert.equal(isUndefinedColumnErr(undefinedColumnError), true)
    assert.equal(isUndefinedColumnErr({ code: '42703' }), true)
  })

  it('matches PostgREST schema-cache miss (PGRST204)', () => {
    assert.equal(isUndefinedColumnErr(schemaCacheError), true)
    assert.equal(isUndefinedColumnErr({ code: 'PGRST204' }), true)
  })

  it('matches a numeric 42703 code (coerced to string)', () => {
    assert.equal(isUndefinedColumnErr({ code: 42703 }), true)
  })

  it('matches on the message alone when the code is absent', () => {
    assert.equal(isUndefinedColumnErr({ message: 'column ics_feeds.content_hash does not exist' }), true)
    assert.equal(isUndefinedColumnErr({ message: "Could not find the 'content_hash' column in the schema cache" }), true)
    assert.equal(isUndefinedColumnErr({ message: 'CONTENT_HASH column does not exist' }), true) // case-insensitive
  })
})

describe('isUndefinedColumnErr — false branch (no false positives)', () => {
  it('returns false for null / undefined / empty', () => {
    assert.equal(isUndefinedColumnErr(null), false)
    assert.equal(isUndefinedColumnErr(undefined), false)
    assert.equal(isUndefinedColumnErr({}), false)
  })

  it('returns false for a unique violation', () => {
    assert.equal(isUndefinedColumnErr({ code: '23505', message: 'duplicate key value violates unique constraint' }), false)
  })

  it('returns false for a connection / auth failure', () => {
    assert.equal(isUndefinedColumnErr(unrelatedError), false)
    assert.equal(isUndefinedColumnErr({ code: 'PGRST301', message: 'JWT expired' }), false)
  })

  it('returns false for a missing column that is NOT content_hash', () => {
    assert.equal(isUndefinedColumnErr({ message: 'column ics_feeds.last_sync_error does not exist' }), false)
  })

  it('returns false when content_hash appears but nothing says the column is missing', () => {
    assert.equal(isUndefinedColumnErr({ message: 'content_hash mismatch detected' }), false)
  })

  it('returns false for a row-level-security denial', () => {
    assert.equal(isUndefinedColumnErr({ code: '42501', message: 'new row violates row-level security policy' }), false)
  })
})

// ── selectSyncFeeds ───────────────────────────────────────────────────────────

const FEED_ROWS = [
  { id: 'f1', user_id: 'u1', url: 'https://93.184.216.34/one.ics', label: 'One', content_hash: 'hash-one' },
  { id: 'f2', user_id: 'u1', url: 'https://93.184.216.34/two.ics', label: null, content_hash: null },
  { id: 'f3', user_id: 'u2', url: 'https://93.184.216.34/three.ics', label: 'Other user', content_hash: null },
]

/** Fails only the richer select that asks for content_hash. */
const failHashProbe = (err) => (ctx) =>
  ctx.op === 'select' && /content_hash/.test(String(ctx.cols || '')) ? err : null

describe('selectSyncFeeds', () => {
  beforeEach(() => { setFeedHashColumn(null) })

  it('probes with content_hash, latches the capability flag, and scopes to the user', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS })
    const { data, error } = await selectSyncFeeds(client, 'u1', null)

    assert.equal(error, null)
    assert.deepEqual(data.map((r) => r.id), ['f1', 'f2'])   // u2's feed excluded
    assert.equal(getFeedHashColumn(), true)

    const sel = calls('select', 'ics_feeds')
    assert.equal(sel.length, 1)
    assert.equal(sel[0].cols, 'id, url, label, content_hash')
    assert.deepEqual(sel[0].eqs, [['user_id', 'u1']])       // no id filter for an all-feeds sync
  })

  it('adds an id filter when a single feedId is requested', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS })
    const { data } = await selectSyncFeeds(client, 'u1', 'f1')

    assert.equal(data.length, 1)
    assert.equal(data[0].id, 'f1')
    assert.deepEqual(calls('select', 'ics_feeds')[0].eqs, [['user_id', 'u1'], ['id', 'f1']])
  })

  it('never returns another user\'s feed, even when that feed id is requested', async () => {
    const { client } = makeFakeClient({ ics_feeds: FEED_ROWS })
    const { data } = await selectSyncFeeds(client, 'u1', 'f3')
    assert.deepEqual(data, [])
  })

  it('falls back to the base columns when content_hash is undefined (42703)', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS }, { fail: failHashProbe(undefinedColumnError) })
    const { data, error } = await selectSyncFeeds(client, 'u1', null)

    assert.equal(error, null)
    assert.equal(data.length, 2)                            // sync still works
    assert.equal(getFeedHashColumn(), false)

    const sel = calls('select', 'ics_feeds')
    assert.equal(sel.length, 2)                             // probe + retry
    assert.equal(sel[1].cols, 'id, url, label')             // reduced column set
  })

  it('falls back the same way on a PostgREST schema-cache miss (PGRST204)', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS }, { fail: failHashProbe(schemaCacheError) })
    const { data, error } = await selectSyncFeeds(client, 'u1', null)
    assert.equal(error, null)
    assert.equal(data.length, 2)
    assert.equal(getFeedHashColumn(), false)
    assert.equal(calls('select', 'ics_feeds').length, 2)
  })

  it('keeps the id filter on the fallback query', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS }, { fail: failHashProbe(undefinedColumnError) })
    const { data } = await selectSyncFeeds(client, 'u1', 'f2')
    assert.deepEqual(data.map((r) => r.id), ['f2'])
    assert.deepEqual(calls('select', 'ics_feeds')[1].eqs, [['user_id', 'u1'], ['id', 'f2']])
  })

  it('skips the probe entirely once the column is known to be absent', async () => {
    setFeedHashColumn(false)
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS })
    const { data, error } = await selectSyncFeeds(client, 'u1', null)

    assert.equal(error, null)
    assert.equal(data.length, 2)
    const sel = calls('select', 'ics_feeds')
    assert.equal(sel.length, 1)                             // one round-trip, not two
    assert.equal(sel[0].cols, 'id, url, label')
    assert.equal(getFeedHashColumn(), false)                // unchanged
  })

  it('propagates an unrelated error instead of silently disabling the hash column', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: FEED_ROWS }, { fail: () => unrelatedError })
    const { data, error } = await selectSyncFeeds(client, 'u1', null)

    assert.equal(error, unrelatedError)
    assert.equal(data, null)
    assert.equal(calls('select', 'ics_feeds').length, 1)    // no pointless retry
    assert.equal(getFeedHashColumn(), null)                 // capability still unprobed
  })
})

// ── updateFeedStatus ──────────────────────────────────────────────────────────

const OK_PATCH = { last_synced_at: '2026-09-02T00:00:00.000Z', last_sync_status: 'success', last_sync_error: null }

describe('updateFeedStatus', () => {
  beforeEach(() => { setFeedHashColumn(null) })

  it('writes the patch plus content_hash and scopes by feed id + user id', async () => {
    const { client, calls, db } = makeFakeClient({ ics_feeds: [{ id: 'f1', user_id: 'u1' }] })
    await updateFeedStatus(client, 'u1', 'f1', OK_PATCH, 'deadbeef')

    const ups = calls('update', 'ics_feeds')
    assert.equal(ups.length, 1)
    assert.deepEqual(ups[0].payload, { ...OK_PATCH, content_hash: 'deadbeef' })
    assert.deepEqual(ups[0].eqs, [['id', 'f1'], ['user_id', 'u1']])
    assert.equal(db.ics_feeds[0].last_sync_status, 'success')
    assert.equal(db.ics_feeds[0].content_hash, 'deadbeef')
  })

  it('omits content_hash when no hash is supplied (a failed/partial sync)', async () => {
    const { client, calls } = makeFakeClient({ ics_feeds: [{ id: 'f1', user_id: 'u1' }] })
    await updateFeedStatus(client, 'u1', 'f1', { last_sync_status: 'error' }, null)

    const ups = calls('update', 'ics_feeds')
    assert.equal(ups.length, 1)
    assert.deepEqual(ups[0].payload, { last_sync_status: 'error' })
    assert.ok(!('content_hash' in ups[0].payload))
  })

  it('omits content_hash when the column is known to be absent', async () => {
    setFeedHashColumn(false)
    const { client, calls } = makeFakeClient({ ics_feeds: [{ id: 'f1', user_id: 'u1' }] })
    await updateFeedStatus(client, 'u1', 'f1', OK_PATCH, 'deadbeef')

    const ups = calls('update', 'ics_feeds')
    assert.equal(ups.length, 1)
    assert.ok(!('content_hash' in ups[0].payload))
  })

  it('degrades and retries without content_hash when the column turns out to be missing', async () => {
    const { client, calls, db } = makeFakeClient(
      { ics_feeds: [{ id: 'f1', user_id: 'u1' }] },
      { fail: (ctx) => (ctx.op === 'update' && ctx.payload?.content_hash ? undefinedColumnError : null) }
    )
    await updateFeedStatus(client, 'u1', 'f1', OK_PATCH, 'deadbeef')

    const ups = calls('update', 'ics_feeds')
    assert.equal(ups.length, 2)
    assert.ok('content_hash' in ups[0].payload)
    assert.deepEqual(ups[1].payload, OK_PATCH)               // retried without the column
    assert.deepEqual(ups[1].eqs, [['id', 'f1'], ['user_id', 'u1']])
    assert.equal(getFeedHashColumn(), false)                 // flag flipped for the rest of the process
    assert.equal(db.ics_feeds[0].last_sync_status, 'success') // status still landed
  })

  it('does not retry (and does not throw) on an unrelated update error', async () => {
    const { client, calls } = makeFakeClient(
      { ics_feeds: [{ id: 'f1', user_id: 'u1' }] },
      { fail: () => unrelatedError }
    )
    await assert.doesNotReject(() => updateFeedStatus(client, 'u1', 'f1', OK_PATCH, 'deadbeef'))
    assert.equal(calls('update', 'ics_feeds').length, 1)
    assert.equal(getFeedHashColumn(), null)
  })

  it('does not retry when the failing write never carried content_hash', async () => {
    const { client, calls } = makeFakeClient(
      { ics_feeds: [{ id: 'f1', user_id: 'u1' }] },
      { fail: () => undefinedColumnError }
    )
    await updateFeedStatus(client, 'u1', 'f1', OK_PATCH, null)
    assert.equal(calls('update', 'ics_feeds').length, 1)
    assert.equal(getFeedHashColumn(), null)
  })
})

// ── syncOneFeed ───────────────────────────────────────────────────────────────

const FEED_HOST = 'https://93.184.216.34'   // IP literal: dns.lookup short-circuits, so no DNS query
const FEED_URL = `${FEED_HOST}/one.ics`

/**
 * Stub globalThis.fetch with a pathname -> body map.
 * A value may be a string (200 + that body), `{ status }` (that HTTP status),
 * or an Error instance (the fetch itself rejects).
 */
function installIcsFetch(map) {
  globalThis.fetch = async (input) => {
    const u = new URL(typeof input === 'string' ? input : input.url)
    const entry = map[u.pathname]
    if (entry === undefined) throw new Error(`unexpected fetch for ${u.pathname}`)
    if (entry instanceof Error) throw entry
    if (typeof entry === 'object') return new Response(entry.body ?? '', { status: entry.status })
    return new Response(entry, { status: 200, headers: { 'Content-Type': 'text/calendar' } })
  }
}

const feedRow = (over = {}) => ({ id: 'f1', user_id: 'u1', url: FEED_URL, label: 'Course One', ...over })
const lastFeedUpdate = (calls) => calls('update', 'ics_feeds').at(-1)?.payload

describe('syncOneFeed — happy path', () => {
  beforeEach(() => { setFeedHashColumn(null); globalThis.fetch = REAL_FETCH })

  it('fetches, parses, writes and records success with the content hash', async () => {
    installIcsFetch({ '/one.ics': TWO_EVENT_ICS })
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(client, client, 'u1', feedRow())

    assert.equal(r.success, true)
    assert.equal(r.feedId, 'f1')
    assert.equal(r.skipped, undefined)
    assert.equal(r.occurrenceCount, 2)
    assert.equal(r.coursesInserted, 1)
    assert.equal(r.assignmentsInserted, 2)
    assert.deepEqual(r.writeErrors, [])
    assert.equal(db.assignments.length, 2)
    assert.deepEqual(
      db.assignments.map((a) => a.external_assignment_id).sort(),
      ['hw1@test', 'hw2@test']
    )
    assert.equal(db.assignments[0].feed_id, 'f1')

    const patch = lastFeedUpdate(calls)
    assert.equal(patch.last_sync_status, 'success')
    assert.equal(patch.last_sync_error, null)
    assert.equal(patch.content_hash, feedContentHash(TWO_EVENT_ICS))
    assert.match(patch.last_synced_at, /^\d{4}-\d{2}-\d{2}T/)
  })

  it('writes through writeClient, never through the user-scoped client', async () => {
    installIcsFetch({ '/one.ics': ONE_EVENT_ICS })
    const user = makeFakeClient({ ics_feeds: [feedRow()] })
    const service = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(user.client, service.client, 'u1', feedRow())

    assert.equal(r.success, true)
    assert.equal(user.log.length, 0, 'user-scoped client must not be used for writes')
    assert.ok(service.log.length > 0)
    assert.equal(service.db.assignments.length, 1)
  })

  it('handles a feed that parses to zero occurrences without erroring', async () => {
    installIcsFetch({ '/one.ics': icsFeed() })
    const { client, calls } = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(client, client, 'u1', feedRow())

    assert.equal(r.success, true)
    assert.equal(r.occurrenceCount, 0)
    assert.equal(r.assignmentsInserted, 0)
    assert.equal(lastFeedUpdate(calls).last_sync_status, 'success')
  })
})

describe('syncOneFeed — failure handling', () => {
  beforeEach(() => { setFeedHashColumn(null); globalThis.fetch = REAL_FETCH })

  it('marks the feed errored (and does not throw) when the fetch rejects', async () => {
    installIcsFetch({ '/one.ics': new Error('socket hang up') })
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(client, client, 'u1', feedRow())

    assert.equal(r.success, false)
    assert.match(r.error, /Feed fetch failed: socket hang up/)
    const patch = lastFeedUpdate(calls)
    assert.equal(patch.last_sync_status, 'error')
    assert.match(patch.last_sync_error, /socket hang up/)
    assert.ok(!('content_hash' in patch), 'a failed sync must not cache a hash')
    assert.equal(db.assignments.length, 0)
    assert.equal(calls('insert').length, 0)
  })

  it('marks the feed errored on a non-2xx HTTP status', async () => {
    installIcsFetch({ '/one.ics': { status: 404 } })
    const { client, calls } = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(client, client, 'u1', feedRow())
    assert.equal(r.success, false)
    assert.match(r.error, /Feed returned HTTP 404/)
    assert.equal(lastFeedUpdate(calls).last_sync_status, 'error')
  })

  it('marks the feed errored on an unparseable body (LMS login page)', async () => {
    installIcsFetch({ '/one.ics': HTML_LOGIN_PAGE })
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(client, client, 'u1', feedRow())

    assert.equal(r.success, false)
    assert.match(r.error, /BEGIN:VCALENDAR/)
    assert.equal(lastFeedUpdate(calls).last_sync_status, 'error')
    assert.equal(db.assignments.length, 0, 'a login page must never wipe or write assignments')
  })

  it('truncates a monstrous error message to 500 chars before storing it', async () => {
    installIcsFetch({ '/one.ics': new Error('x'.repeat(2000)) })
    const { client, calls } = makeFakeClient({ ics_feeds: [feedRow()] })

    const r = await syncOneFeed(client, client, 'u1', feedRow())
    assert.equal(r.success, false)
    assert.equal(lastFeedUpdate(calls).last_sync_error.length, 500)
    assert.ok(r.error.length > 500, 'the returned result keeps the full message')
  })

  it('reports partial write failures as success but withholds the hash', async () => {
    installIcsFetch({ '/one.ics': TWO_EVENT_ICS })
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow()] }, {
      fail: (ctx) => {
        if (ctx.op !== 'insert' || ctx.table !== 'assignments') return null
        const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload]
        return rows.some((r) => r.external_assignment_id === 'hw2@test')
          ? { message: 'row rejected' }
          : null
      },
    })

    const r = await syncOneFeed(client, client, 'u1', feedRow())

    assert.equal(r.success, true)
    assert.equal(r.assignmentsInserted, 1)
    assert.equal(r.writeErrors.length, 1)
    assert.equal(db.assignments.length, 1)

    const patch = lastFeedUpdate(calls)
    assert.equal(patch.last_sync_status, 'success', 'one bad row must not flap the feed to red')
    assert.match(patch.last_sync_error, /1 item\(s\) failed to save/)
    assert.ok(!('content_hash' in patch), 'a partial write must stay retryable next sync')
  })

  /*
   * Pinning the partial-success contract: when the feed had events and *nothing*
   * landed, the feed row goes red — but syncOneFeed still returns success:true
   * (only a thrown fetch/parse error produces success:false). The route's totals
   * therefore see zeroes rather than a failed feed.
   */
  it('flags the feed row red when events existed but nothing landed (result stays success:true)', async () => {
    installIcsFetch({ '/one.ics': TWO_EVENT_ICS })
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow()] }, {
      fail: (ctx) => (ctx.op === 'insert' && ctx.table === 'assignments' ? { message: 'all rejected' } : null),
    })

    const r = await syncOneFeed(client, client, 'u1', feedRow())

    assert.equal(r.success, true)
    assert.equal(r.assignmentsInserted, 0)
    assert.equal(r.writeErrors.length, 2)
    assert.equal(db.assignments.length, 0)

    const patch = lastFeedUpdate(calls)
    assert.equal(patch.last_sync_status, 'error')
    assert.match(patch.last_sync_error, /2 item\(s\) failed to save/)
  })

  it('one failing feed does not abort the feeds synced after it', async () => {
    // Distinct UIDs per feed so the two healthy feeds insert rather than
    // collide on (user_id, external_assignment_id).
    const OTHER_ICS = icsFeed(
      vevent({ UID: 'hw3@test', SUMMARY: 'Homework 3', DTSTART: '20260903T120000Z', DTEND: '20260903T235900Z' }),
      vevent({ UID: 'hw4@test', SUMMARY: 'Homework 4', DTSTART: '20260904T120000Z', DTEND: '20260904T235900Z' })
    )
    installIcsFetch({
      '/one.ics': ONE_EVENT_ICS,
      '/bad.ics': new Error('DNS meltdown'),
      '/two.ics': OTHER_ICS,
    })
    const feeds = [
      feedRow({ id: 'f1', url: `${FEED_HOST}/one.ics`, label: 'A' }),
      feedRow({ id: 'fbad', url: `${FEED_HOST}/bad.ics`, label: 'B' }),
      feedRow({ id: 'f2', url: `${FEED_HOST}/two.ics`, label: 'C' }),
    ]
    const { client, db } = makeFakeClient({ ics_feeds: feeds })

    const results = []
    for (const f of feeds) results.push(await syncOneFeed(client, client, 'u1', f))

    assert.deepEqual(results.map((r) => r.success), [true, false, true])
    assert.equal(results[1].error.match(/DNS meltdown/) !== null, true)
    assert.equal(db.assignments.length, 3)                 // 1 from f1 + 2 from f2
    assert.equal(db.ics_feeds.find((f) => f.id === 'fbad').last_sync_status, 'error')
    assert.equal(db.ics_feeds.find((f) => f.id === 'f2').last_sync_status, 'success')
  })
})

describe('syncOneFeed — content-hash short-circuit', () => {
  beforeEach(() => { setFeedHashColumn(null); globalThis.fetch = REAL_FETCH })

  it('skips parse + write entirely when the body hash is unchanged', async () => {
    installIcsFetch({ '/one.ics': TWO_EVENT_ICS })
    setFeedHashColumn(true)
    const hash = feedContentHash(TWO_EVENT_ICS)
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow({ content_hash: hash })] })

    const r = await syncOneFeed(client, client, 'u1', feedRow({ content_hash: hash }))

    assert.equal(r.success, true)
    assert.equal(r.skipped, true)
    assert.equal(r.occurrenceCount, 0)
    assert.equal(r.assignmentsInserted, 0)
    assert.deepEqual(r.writeErrors, [])

    // The expensive part is genuinely skipped: no course/assignment traffic at all.
    assert.equal(calls('select', 'courses').length, 0)
    assert.equal(calls('select', 'assignments').length, 0)
    assert.equal(calls('insert').length, 0)
    assert.equal(calls('update', 'assignments').length, 0)
    assert.equal(db.assignments.length, 0)

    // Only the timestamp/status stamp is written.
    const ups = calls('update', 'ics_feeds')
    assert.equal(ups.length, 1)
    assert.equal(ups[0].payload.last_sync_status, 'success')
    assert.equal(ups[0].payload.content_hash, hash)
  })

  it('does a full write when the body changed', async () => {
    installIcsFetch({ '/one.ics': TWO_EVENT_ICS })
    setFeedHashColumn(true)
    const { client, calls, db } = makeFakeClient({ ics_feeds: [feedRow({ content_hash: 'stale' })] })

    const r = await syncOneFeed(client, client, 'u1', feedRow({ content_hash: 'stale' }))

    assert.equal(r.skipped, undefined)
    assert.equal(r.assignmentsInserted, 2)
    assert.equal(db.assignments.length, 2)
    assert.ok(calls('select', 'assignments').length > 0)
  })

  it('does a full write when the feed has no stored hash yet', async () => {
    installIcsFetch({ '/one.ics': ONE_EVENT_ICS })
    setFeedHashColumn(true)
    const { client, db } = makeFakeClient({ ics_feeds: [feedRow({ content_hash: null })] })

    const r = await syncOneFeed(client, client, 'u1', feedRow({ content_hash: null }))
    assert.equal(r.skipped, undefined)
    assert.equal(db.assignments.length, 1)
  })

  /*
   * Degradation pin: when the live schema has no content_hash column the flag is
   * false, and the fast path must not fire even if a stale hash value is somehow
   * present on the row — otherwise a pre-migration deploy would stop syncing.
   */
  it('never short-circuits while the content_hash column is known to be absent', async () => {
    installIcsFetch({ '/one.ics': ONE_EVENT_ICS })
    setFeedHashColumn(false)
    const hash = feedContentHash(ONE_EVENT_ICS)
    const { client, db } = makeFakeClient({ ics_feeds: [feedRow({ content_hash: hash })] })

    const r = await syncOneFeed(client, client, 'u1', feedRow({ content_hash: hash }))

    assert.equal(r.skipped, undefined)
    assert.equal(r.assignmentsInserted, 1)
    assert.equal(db.assignments.length, 1)
  })

  it('never short-circuits while the column capability is still unprobed (null)', async () => {
    installIcsFetch({ '/one.ics': ONE_EVENT_ICS })
    setFeedHashColumn(null)
    const hash = feedContentHash(ONE_EVENT_ICS)
    const { client, db } = makeFakeClient({ ics_feeds: [feedRow({ content_hash: hash })] })

    const r = await syncOneFeed(client, client, 'u1', feedRow({ content_hash: hash }))
    assert.equal(r.skipped, undefined)
    assert.equal(db.assignments.length, 1)
  })
})

// ── JWT / auth-cache helpers ──────────────────────────────────────────────────

const b64url = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
/** A structurally-valid (unsigned) JWT — jwtExpMs only base64-decodes the payload. */
const makeJwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.sig`

describe('jwtExpMs', () => {
  it('decodes a numeric exp into milliseconds', () => {
    assert.equal(jwtExpMs(makeJwt({ sub: 'u1', exp: 1893456000 })), 1893456000000)
  })

  it('returns null when the payload has no exp', () => {
    assert.equal(jwtExpMs(makeJwt({ sub: 'u1' })), null)
  })

  it('returns null when exp is not a number', () => {
    assert.equal(jwtExpMs(makeJwt({ exp: '1893456000' })), null)
    assert.equal(jwtExpMs(makeJwt({ exp: null })), null)
  })

  it('returns null instead of throwing on malformed tokens', () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a..c', 'a.@@@not-base64@@@.c', 'onlyonesegment']) {
      assert.equal(jwtExpMs(bad), null, `expected null for ${JSON.stringify(bad)}`)
    }
  })

  it('returns null instead of throwing on null / undefined / non-strings', () => {
    assert.equal(jwtExpMs(null), null)
    assert.equal(jwtExpMs(undefined), null)
    assert.equal(jwtExpMs(12345), null)
    assert.equal(jwtExpMs({}), null)
  })
})

describe('auth cache', () => {
  beforeEach(() => { authCache.clear() })

  it('uses the documented TTL and cap', () => {
    assert.equal(AUTH_CACHE_TTL_MS, 60_000)
    assert.equal(AUTH_CACHE_MAX, 1000)
  })

  it('returns null for an unknown token', () => {
    assert.equal(authCacheGet('never-seen'), null)
  })

  it('round-trips a validated user', () => {
    const user = { id: 'u1', email: 'a@b.c' }
    authCacheSet('tok', user)
    assert.deepEqual(authCacheGet('tok'), user)
  })

  it('evicts (not just hides) an expired entry on read', () => {
    authCacheSet('tok', { id: 'u1' })
    authCache.get('tok').expiresAt = Date.now() - 1
    assert.equal(authCacheGet('tok'), null)
    assert.equal(authCache.has('tok'), false, 'expired entry must be deleted, not left to leak')
  })

  it('never lets a cached entry outlive the token\'s own exp', () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 5      // token dies in 5s, TTL is 60s
    const token = makeJwt({ exp: expSeconds })
    authCacheSet(token, { id: 'u1' })
    const { expiresAt } = authCache.get(token)
    assert.equal(expiresAt, expSeconds * 1000)
    assert.ok(expiresAt < Date.now() + AUTH_CACHE_TTL_MS)
  })

  it('uses the full TTL when the token outlives it', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    authCacheSet(token, { id: 'u1' })
    const { expiresAt } = authCache.get(token)
    assert.ok(Math.abs(expiresAt - (Date.now() + AUTH_CACHE_TTL_MS)) < 1000)
  })

  it('falls back to the TTL when exp cannot be read', () => {
    authCacheSet('opaque-token', { id: 'u1' })
    const { expiresAt } = authCache.get('opaque-token')
    assert.ok(Math.abs(expiresAt - (Date.now() + AUTH_CACHE_TTL_MS)) < 1000)
  })

  it('an already-expired token is cached but never served', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 })
    authCacheSet(token, { id: 'u1' })
    assert.equal(authCacheGet(token), null)
  })

  it('caps at AUTH_CACHE_MAX entries, evicting the oldest first', () => {
    for (let i = 0; i < AUTH_CACHE_MAX; i++) authCacheSet(`t${i}`, { id: `u${i}` })
    assert.equal(authCache.size, AUTH_CACHE_MAX)

    authCacheSet('overflow', { id: 'u-overflow' })
    assert.equal(authCache.size, AUTH_CACHE_MAX, 'cache must stay bounded')
    assert.equal(authCache.has('t0'), false, 'oldest insertion evicted')
    assert.equal(authCache.has('t1'), true)
    assert.deepEqual(authCacheGet('overflow'), { id: 'u-overflow' })
  })
})

describe('bearerToken', () => {
  const req = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } })

  it('extracts the token from a well-formed header', () => {
    assert.equal(bearerToken(req('Bearer abc.def.ghi')), 'abc.def.ghi')
  })

  it('is case-insensitive on the scheme', () => {
    assert.equal(bearerToken(req('bearer abc')), 'abc')
    assert.equal(bearerToken(req('BEARER abc')), 'abc')
  })

  it('trims surrounding whitespace in the token', () => {
    assert.equal(bearerToken(req('Bearer   abc  ')), 'abc')
  })

  it('returns null for a missing, empty or non-bearer header', () => {
    assert.equal(bearerToken(req()), null)
    assert.equal(bearerToken(req('')), null)
    assert.equal(bearerToken(req('Basic dXNlcjpwYXNz')), null)
    assert.equal(bearerToken(req('Token abc')), null)
    assert.equal(bearerToken(req('Bearer')), null)   // no space -> not a bearer header
  })

  it('returns null for "Bearer " with no token', () => {
    assert.equal(bearerToken(req('Bearer ')), null)
    assert.equal(bearerToken(req('Bearer    ')), null)
  })
})

// ── env / client construction ─────────────────────────────────────────────────

describe('getEnv / clientFor / getServiceClient', () => {
  it('getEnv returns the configured url + anon key', () => {
    assert.deepEqual(getEnv(), { url: 'https://fake.supabase.co', anon: 'anon-key-for-tests' })
  })

  it('clientFor returns null without a bearer Authorization header', () => {
    assert.equal(clientFor({ headers: {} }), null)
    assert.equal(clientFor({ headers: { authorization: '' } }), null)
    assert.equal(clientFor({ headers: { authorization: 'Basic xyz' } }), null)
  })

  it('clientFor builds a JWT-scoped client (case-insensitive scheme)', () => {
    for (const header of ['Bearer tok', 'bearer tok']) {
      const c = clientFor({ headers: { authorization: header } })
      assert.ok(c, `expected a client for ${header}`)
      assert.equal(typeof c.from, 'function')
      assert.equal(typeof c.auth.getUser, 'function')
    }
  })

  it('getServiceClient returns null when no service-role key is configured (Electron build)', () => {
    assert.equal(getServiceClient(), null)
  })

  it('getServiceClient memoizes a client when the service-role key IS configured', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    try {
      // Fresh module instance: the SUPABASE_* consts are snapshotted at import.
      const mod = await import('../ics-routes.js?withServiceKey=1')
      const a = mod._internal.getServiceClient()
      const b = mod._internal.getServiceClient()
      assert.ok(a)
      assert.equal(a, b, 'the service client must be created once and reused')
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  })

  it('getEnv throws a configuration error when Supabase env is missing', async () => {
    const savedUrl = process.env.SUPABASE_URL
    const savedAnon = process.env.SUPABASE_ANON_KEY
    const savedViteUrl = process.env.VITE_SUPABASE_URL
    const savedViteAnon = process.env.VITE_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    delete process.env.VITE_SUPABASE_URL
    delete process.env.VITE_SUPABASE_ANON_KEY
    try {
      const mod = await import('../ics-routes.js?noEnv=1')
      assert.throws(() => mod._internal.getEnv(), /Supabase env not configured/)
      // clientFor surfaces the same error once a bearer header is present.
      assert.throws(
        () => mod._internal.clientFor({ headers: { authorization: 'Bearer t' } }),
        /Supabase env not configured/
      )
      // ...but still short-circuits to null before touching env when there is none.
      assert.equal(mod._internal.clientFor({ headers: {} }), null)
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl
      if (savedAnon !== undefined) process.env.SUPABASE_ANON_KEY = savedAnon
      if (savedViteUrl !== undefined) process.env.VITE_SUPABASE_URL = savedViteUrl
      if (savedViteAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = savedViteAnon
    }
  })
})

// ── HTTP test client (node:http, so it never touches the stubbed fetch) ────────

function httpJson(port, method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          let parsed = null
          try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const close = (server) => new Promise((resolve) => server.close(resolve))

// ── makeIcsLimiter ────────────────────────────────────────────────────────────

describe('makeIcsLimiter', () => {
  let server
  let port

  before(async () => {
    const app = express()
    app.use((req, _res, next) => { req.user = { id: req.headers['x-test-user'] }; next() })
    app.get('/limited', makeIcsLimiter(2, 60_000), (_req, res) => res.json({ success: true }))
    server = await listen(app)
    port = server.address().port
  })

  after(async () => { await close(server) })

  it('allows up to `max` requests then answers 429 with the JSON error shape', async () => {
    const as = (u) => httpJson(port, 'GET', '/limited', { headers: { 'x-test-user': u } })

    assert.equal((await as('lim-a')).status, 200)
    assert.equal((await as('lim-a')).status, 200)

    const third = await as('lim-a')
    assert.equal(third.status, 429)
    assert.equal(third.body.success, false)
    assert.match(third.body.error, /Too many requests/)
  })

  it('keys the bucket per user, so one user cannot exhaust another', async () => {
    const other = await httpJson(port, 'GET', '/limited', { headers: { 'x-test-user': 'lim-b' } })
    assert.equal(other.status, 200)
  })

  it('emits standard RateLimit headers and no legacy X-RateLimit ones', async () => {
    const res = await httpJson(port, 'GET', '/limited', { headers: { 'x-test-user': 'lim-c' } })
    assert.equal(res.headers['ratelimit-limit'], '2')
    assert.equal(res.headers['ratelimit-remaining'], '1')
    assert.ok(res.headers['ratelimit-reset'])
    assert.equal(res.headers['x-ratelimit-limit'], undefined)
  })
})

// ── Fake Supabase backend (GoTrue + PostgREST over the stubbed fetch) ──────────
//
// Routes are exercised through the *real* router and the *real* supabase-js
// client; only the transport is faked. supabase-js resolves fetch late, so
// swapping globalThis.fetch is enough to intercept every round-trip.

const SUPABASE_HOST = 'fake.supabase.co'
const NON_FILTER_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])

function headerOf(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name)
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return hit ? headers[hit] : null
}

/** Parse a PostgREST `in.(a,"b c")` list into plain values. */
function parseInList(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '')
  if (!inner) return []
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quoted) {
      if (c === '\\') { cur += inner[++i]; continue }
      if (c === '"') { quoted = false; continue }
      cur += c
    } else if (c === '"') { quoted = true } else if (c === ',') { out.push(cur); cur = '' } else { cur += c }
  }
  out.push(cur)
  return out
}

const unquote = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)

function makeSupabaseBackend() {
  const backend = {
    users: new Map(),   // bearer token -> user row
    db: { ics_feeds: [], courses: [], assignments: [], tasks: [] },
    ics: {},            // pathname -> ICS body | Error | { status }
    authCalls: 0,
    rest: [],           // { method, table, params, body }
    restHook: null,     // (ctx) => { status, body } | undefined
    idSeq: 1,
  }

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  function matches(row, filters) {
    return filters.every(({ col, op, value }) => {
      if (op === 'eq') return String(row[col]) === String(value)
      if (op === 'in') return value.some((v) => String(row[col]) === String(v))
      return true
    })
  }

  backend.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url
    const url = new URL(raw)
    const method = (init.method || 'GET').toUpperCase()

    // ── the ICS feed origin ──
    if (url.host !== SUPABASE_HOST) {
      const entry = backend.ics[url.pathname]
      if (entry === undefined) throw new Error(`unexpected feed fetch: ${url.pathname}`)
      if (entry instanceof Error) throw entry
      if (typeof entry === 'object') return new Response(entry.body ?? '', { status: entry.status, headers: entry.headers })
      return new Response(entry, { status: 200, headers: { 'Content-Type': 'text/calendar' } })
    }

    // ── GoTrue ──
    if (url.pathname === '/auth/v1/user') {
      backend.authCalls++
      const auth = headerOf(init.headers, 'Authorization') || ''
      const token = auth.replace(/^Bearer\s+/i, '')
      const user = backend.users.get(token)
      if (!user) return json({ code: 401, message: 'invalid claim: missing sub claim' }, 401)
      return json(user)
    }

    // ── PostgREST ──
    const table = url.pathname.replace(/^\/rest\/v1\//, '')
    const filters = []
    const params = {}
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value
      if (NON_FILTER_PARAMS.has(key)) continue
      if (value.startsWith('eq.')) filters.push({ col: key, op: 'eq', value: unquote(value.slice(3)) })
      else if (value.startsWith('in.')) filters.push({ col: key, op: 'in', value: parseInList(value.slice(3)) })
    }
    const body = init.body ? JSON.parse(init.body) : null
    const ctx = { method, table, params, filters, body }
    backend.rest.push(ctx)

    const forced = backend.restHook?.(ctx)
    if (forced) return json(forced.body ?? { message: 'forced failure' }, forced.status ?? 500)

    const rows = backend.db[table] || (backend.db[table] = [])
    const wantsObject = /vnd\.pgrst\.object/.test(headerOf(init.headers, 'Accept') || '')
    const shape = (arr) => (wantsObject ? json(arr[0] ?? null) : json(arr))

    if (method === 'GET') {
      let hits = rows.filter((r) => matches(r, filters)).map((r) => ({ ...r }))
      const order = params.order
      if (order) {
        const [col, dir] = order.split('.')
        hits.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1))
      }
      return shape(hits)
    }
    if (method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body]
      const created = incoming.map((r) => {
        const row = { id: `srv-${backend.idSeq++}`, ...r }
        rows.push(row)
        return { ...row }
      })
      return shape(created)
    }
    if (method === 'PATCH') {
      const hits = rows.filter((r) => matches(r, filters))
      for (const r of hits) Object.assign(r, body)
      return shape(hits.map((r) => ({ ...r })))
    }
    if (method === 'DELETE') {
      const doomed = new Set(rows.filter((r) => matches(r, filters)))
      backend.db[table] = rows.filter((r) => !doomed.has(r))
      return shape([...doomed].map((r) => ({ ...r })))
    }
    return json([])
  }

  return backend
}

// ── Route tests ───────────────────────────────────────────────────────────────

describe('ics routes (mounted router)', () => {
  let server
  let port
  let backend
  let seq = 0

  before(async () => {
    const app = express()
    app.use(express.json())
    app.use(icsRouter)
    server = await listen(app)
    port = server.address().port
  })

  after(async () => {
    await close(server)
    globalThis.fetch = REAL_FETCH
  })

  beforeEach(() => {
    authCache.clear()          // module-level cache must not bleed between tests
    setFeedHashColumn(null)
    backend = makeSupabaseBackend()
    globalThis.fetch = backend.fetch
  })

  /** A fresh user + token per test, so each gets its own rate-limit bucket. */
  function signIn() {
    seq++
    const id = `route-u${seq}`
    const token = makeJwt({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })
    const user = { id, email: `${id}@test.invalid`, aud: 'authenticated' }
    backend.users.set(token, user)
    return { id, token, headers: { Authorization: `Bearer ${token}` } }
  }

  const call = (method, path, opts) => httpJson(port, method, path, opts)

  const PROTECTED = [
    ['GET', '/api/ics/feeds'],
    ['POST', '/api/ics/feeds'],
    ['DELETE', '/api/ics/feeds/some-id'],
    ['POST', '/api/ics/sync'],
  ]

  // ── auth gate ──────────────────────────────────────────────────────────────

  describe('authentication', () => {
    for (const [method, path] of PROTECTED) {
      it(`${method} ${path} answers 401 with no Authorization header`, async () => {
        const res = await call(method, path, { body: {} })
        assert.equal(res.status, 401)
        assert.equal(res.body.success, false)
        assert.match(res.body.error, /Missing Authorization bearer token/)
        assert.equal(backend.authCalls, 0, 'must not burn a GoTrue round-trip on an obvious 401')
      })

      it(`${method} ${path} answers 401 for a malformed Authorization header`, async () => {
        for (const header of ['Basic dXNlcjpwYXNz', 'Bearer', 'token abc', '']) {
          const res = await call(method, path, { body: {}, headers: { Authorization: header } })
          assert.equal(res.status, 401, `header ${JSON.stringify(header)} should be rejected`)
          assert.equal(res.body.success, false)
        }
      })
    }

    it('answers 401 when GoTrue rejects the token', async () => {
      const res = await call('GET', '/api/ics/feeds', { headers: { Authorization: 'Bearer not-a-known-token' } })
      assert.equal(res.status, 401)
      assert.match(res.body.error, /Invalid or expired token/)
      assert.equal(backend.authCalls, 1)
    })

    it('caches a validated token so a second request skips auth.getUser()', async () => {
      const me = signIn()
      assert.equal((await call('GET', '/api/ics/feeds', { headers: me.headers })).status, 200)
      assert.equal(backend.authCalls, 1)
      assert.equal((await call('GET', '/api/ics/feeds', { headers: me.headers })).status, 200)
      assert.equal(backend.authCalls, 1, 'second request must be served from the auth cache')
    })

    it('re-validates once the cached entry has expired', async () => {
      const me = signIn()
      await call('GET', '/api/ics/feeds', { headers: me.headers })
      assert.equal(backend.authCalls, 1)

      authCache.get(me.token).expiresAt = Date.now() - 1
      await call('GET', '/api/ics/feeds', { headers: me.headers })
      assert.equal(backend.authCalls, 2)
    })

    it('does not share a cache entry between two different tokens', async () => {
      const a = signIn()
      const b = signIn()
      await call('GET', '/api/ics/feeds', { headers: a.headers })
      await call('GET', '/api/ics/feeds', { headers: b.headers })
      assert.equal(backend.authCalls, 2)
    })
  })

  // ── GET /api/ics/feeds ─────────────────────────────────────────────────────

  describe('GET /api/ics/feeds', () => {
    it('returns only the caller\'s feeds, user-scoped and ordered by created_at', async () => {
      const me = signIn()
      backend.db.ics_feeds = [
        { id: 'f1', user_id: me.id, url: 'https://a/1.ics', label: 'A', created_at: '2026-01-01' },
        { id: 'f2', user_id: me.id, url: 'https://a/2.ics', label: 'B', created_at: '2026-02-01' },
        { id: 'f9', user_id: 'someone-else', url: 'https://a/9.ics', label: 'Nope', created_at: '2026-01-15' },
      ]

      const res = await call('GET', '/api/ics/feeds', { headers: me.headers })

      assert.equal(res.status, 200)
      assert.equal(res.body.success, true)
      assert.deepEqual(res.body.feeds.map((f) => f.id), ['f1', 'f2'])

      const q = backend.rest.find((c) => c.table === 'ics_feeds' && c.method === 'GET')
      assert.equal(q.params['user_id'], `eq.${me.id}`)
      assert.equal(q.params['order'], 'created_at.asc')
      assert.equal(
        q.params['select'],
        'id,url,label,last_synced_at,last_sync_status,last_sync_error,created_at'  // postgrest-js strips spaces
      )
    })

    it('returns an empty array (not null) when the user has no feeds', async () => {
      const me = signIn()
      const res = await call('GET', '/api/ics/feeds', { headers: me.headers })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { success: true, feeds: [] })
    })

    it('answers 500 with a generic message when the select fails', async () => {
      const me = signIn()
      backend.restHook = (ctx) =>
        ctx.table === 'ics_feeds' && ctx.method === 'GET'
          ? { status: 500, body: { code: 'XX000', message: 'internal database error' } }
          : undefined

      const res = await call('GET', '/api/ics/feeds', { headers: me.headers })
      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { success: false, error: 'Failed to retrieve feeds' })
      assert.ok(!/internal database error/.test(res.raw), 'DB internals must not leak to the client')
    })

    it('mounts the CRUD rate limiter (60 per 15 min) with standard headers', async () => {
      const me = signIn()
      const res = await call('GET', '/api/ics/feeds', { headers: me.headers })
      assert.equal(res.headers['ratelimit-limit'], '60')
      assert.equal(res.headers['ratelimit-remaining'], '59')
      assert.equal(res.headers['x-ratelimit-limit'], undefined)
    })
  })

  // ── POST /api/ics/feeds ────────────────────────────────────────────────────

  describe('POST /api/ics/feeds', () => {
    it('rejects a missing / empty / whitespace url with 400', async () => {
      const me = signIn()
      for (const body of [{}, { url: '' }, { url: '   ' }, { url: null }]) {
        const res = await call('POST', '/api/ics/feeds', { headers: me.headers, body })
        assert.equal(res.status, 400)
        assert.deepEqual(res.body, { success: false, error: 'url is required' })
      }
      assert.equal(backend.db.ics_feeds.length, 0)
    })

    it('validates the feed, normalizes webcal:// to https:// and persists it as pending', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS

      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'webcal://93.184.216.34/one.ics', label: '  Intro to Testing  ' },
      })

      assert.equal(res.status, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.feed.url, 'https://93.184.216.34/one.ics')

      const insert = backend.rest.find((c) => c.table === 'ics_feeds' && c.method === 'POST')
      assert.deepEqual(insert.body, {
        user_id: me.id,
        url: 'https://93.184.216.34/one.ics',
        label: 'Intro to Testing',              // trimmed
        last_sync_status: 'pending',
      })
    })

    it('stores label as null when none is supplied and caps a long one at 200 chars', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS

      await call('POST', '/api/ics/feeds', { headers: me.headers, body: { url: 'https://93.184.216.34/one.ics' } })
      assert.equal(backend.db.ics_feeds.at(-1).label, null)

      await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'https://93.184.216.34/one.ics', label: 'L'.repeat(500) },
      })
      assert.equal(backend.db.ics_feeds.at(-1).label.length, 200)
    })

    it('rejects a feed that cannot be fetched, without writing a row', async () => {
      const me = signIn()
      backend.ics['/dead.ics'] = new Error('connection refused')

      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'https://93.184.216.34/dead.ics' },
      })

      assert.equal(res.status, 400)
      assert.deepEqual(res.body, { success: false, error: 'The feed URL could not be fetched or parsed.' })
      assert.equal(backend.db.ics_feeds.length, 0)
    })

    it('rejects a feed that returns an HTML login page', async () => {
      const me = signIn()
      backend.ics['/login.ics'] = HTML_LOGIN_PAGE

      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'https://93.184.216.34/login.ics' },
      })
      assert.equal(res.status, 400)
      assert.equal(backend.db.ics_feeds.length, 0)
    })

    it('rejects a feed that answers a non-2xx status', async () => {
      const me = signIn()
      backend.ics['/gone.ics'] = { status: 403 }
      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'https://93.184.216.34/gone.ics' },
      })
      assert.equal(res.status, 400)
      assert.equal(backend.db.ics_feeds.length, 0)
    })

    // normalizeUrlInput does not filter schemes itself; the SSRF guard inside
    // fetchIcsFeed is what actually stops these, and the route turns that into
    // a 400. This is the test that proves the combination holds.
    it('rejects a javascript: url at the fetch layer (400, nothing persisted)', async () => {
      const me = signIn()
      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'javascript:alert(1)' },
      })
      assert.equal(res.status, 400)
      assert.equal(backend.db.ics_feeds.length, 0)
    })

    it('rejects a feed URL that resolves to a private address (SSRF guard)', async () => {
      const me = signIn()
      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'http://169.254.169.254/latest/meta-data/' },
      })
      assert.equal(res.status, 400)
      assert.equal(backend.db.ics_feeds.length, 0)
    })

    it('maps a unique violation to 409', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS
      backend.restHook = (ctx) =>
        ctx.table === 'ics_feeds' && ctx.method === 'POST'
          ? { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          : undefined

      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'https://93.184.216.34/one.ics' },
      })
      assert.equal(res.status, 409)
      assert.deepEqual(res.body, { success: false, error: 'You already have this feed URL.' })
    })

    it('maps any other insert failure to 500', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS
      backend.restHook = (ctx) =>
        ctx.table === 'ics_feeds' && ctx.method === 'POST'
          ? { status: 500, body: { code: 'XX000', message: 'disk on fire' } }
          : undefined

      const res = await call('POST', '/api/ics/feeds', {
        headers: me.headers,
        body: { url: 'https://93.184.216.34/one.ics' },
      })
      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { success: false, error: 'Failed to save feed' })
    })
  })

  // ── DELETE /api/ics/feeds/:id ──────────────────────────────────────────────

  describe('DELETE /api/ics/feeds/:id', () => {
    function seedForDelete(uid) {
      backend.db.ics_feeds = [
        { id: 'f1', user_id: uid, url: 'https://a/1.ics' },
        { id: 'f2', user_id: uid, url: 'https://a/2.ics' },
      ]
      backend.db.courses = [
        { id: 'c1', user_id: uid, feed_id: 'f1' },
        { id: 'c2', user_id: uid, feed_id: 'f2' },
      ]
      backend.db.assignments = [
        { id: 'a1', user_id: uid, feed_id: 'f1', course_id: 'c1' },
        { id: 'a2', user_id: uid, feed_id: 'f2', course_id: 'c2' },
        { id: 'a-other', user_id: 'someone-else', feed_id: 'f1', course_id: 'c1' },
      ]
      backend.db.tasks = [
        { id: 't-assign', user_id: uid, assignment_id: 'a1' },
        { id: 't-course', user_id: uid, course_id: 'c1' },
        { id: 't-keep', user_id: uid, assignment_id: 'a2' },
      ]
    }

    /*
     * BEHAVIOUR PIN — the two doc comments in ics-routes.js disagree:
     * the file header says "unsubscribe (DB row only)" while the route's own
     * JSDoc says "cascade-delete everything imported from this feed". The code
     * implements the cascade, so that is what this asserts. If the intent is
     * really "keep the assignments", this test is the one that should fail.
     */
    it('cascade-deletes tasks, assignments, courses and the feed row', async () => {
      const me = signIn()
      seedForDelete(me.id)

      const res = await call('DELETE', '/api/ics/feeds/f1', { headers: me.headers })

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { success: true })
      assert.deepEqual(backend.db.ics_feeds.map((r) => r.id), ['f2'])
      assert.deepEqual(backend.db.courses.map((r) => r.id), ['c2'])
      assert.equal(backend.db.assignments.find((r) => r.id === 'a1'), undefined)
      assert.deepEqual(backend.db.tasks.map((r) => r.id), ['t-keep'])
    })

    it('never touches another user\'s rows or another feed\'s rows', async () => {
      const me = signIn()
      seedForDelete(me.id)

      await call('DELETE', '/api/ics/feeds/f1', { headers: me.headers })

      assert.ok(backend.db.assignments.find((r) => r.id === 'a-other'), 'other user\'s row survived')
      assert.ok(backend.db.assignments.find((r) => r.id === 'a2'), 'other feed\'s row survived')

      // Defence in depth: every delete carries an explicit user_id filter.
      const deletes = backend.rest.filter((c) => c.method === 'DELETE')
      assert.ok(deletes.length >= 4)
      for (const d of deletes) {
        assert.equal(d.params['user_id'], `eq.${me.id}`, `${d.table} delete must be user-scoped`)
      }
    })

    it('is a no-op that still answers 200 for an unknown feed id', async () => {
      const me = signIn()
      seedForDelete(me.id)
      const res = await call('DELETE', '/api/ics/feeds/does-not-exist', { headers: me.headers })
      assert.equal(res.status, 200)
      assert.equal(backend.db.ics_feeds.length, 2)
      assert.equal(backend.db.assignments.length, 3)
    })

    it('answers 500 when a cascade step fails', async () => {
      const me = signIn()
      seedForDelete(me.id)
      backend.restHook = (ctx) =>
        ctx.method === 'DELETE' && ctx.table === 'assignments'
          ? { status: 500, body: { code: 'XX000', message: 'nope' } }
          : undefined

      const res = await call('DELETE', '/api/ics/feeds/f1', { headers: me.headers })
      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { success: false, error: 'Failed to delete feed' })
      assert.ok(backend.db.ics_feeds.find((r) => r.id === 'f1'), 'feed row kept when the cascade aborts')
    })
  })

  // ── POST /api/ics/sync ─────────────────────────────────────────────────────

  describe('POST /api/ics/sync', () => {
    const ZERO_TOTALS = {
      coursesInserted: 0,
      coursesUpdated: 0,
      assignmentsInserted: 0,
      assignmentsUpdated: 0,
      assignmentsArchived: 0,
    }

    it('returns the ZERO_TOTALS shape when the user has no feeds', async () => {
      const me = signIn()
      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })

      assert.equal(res.status, 200)
      assert.deepEqual(res.body, {
        success: true,
        syncedFeeds: 0,
        changed: false,
        totals: ZERO_TOTALS,
        results: [],
        feeds: [],
      })
    })

    it('returns ZERO_TOTALS when the requested feedId belongs to someone else', async () => {
      const me = signIn()
      backend.db.ics_feeds = [{ id: 'not-mine', user_id: 'someone-else', url: 'https://93.184.216.34/one.ics' }]
      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: { feedId: 'not-mine' } })
      assert.equal(res.body.syncedFeeds, 0)
      assert.deepEqual(res.body.totals, ZERO_TOTALS)
    })

    it('syncs a single feed and reports totals plus refreshed feed rows', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = TWO_EVENT_ICS
      backend.db.ics_feeds = [
        { id: 'f1', user_id: me.id, url: 'https://93.184.216.34/one.ics', label: 'One', content_hash: null, created_at: '2026-01-01' },
      ]

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })

      assert.equal(res.status, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.syncedFeeds, 1)
      assert.equal(res.body.changed, true)
      assert.equal(res.body.totals.coursesInserted, 1)
      assert.equal(res.body.totals.assignmentsInserted, 2)
      assert.equal(res.body.results.length, 1)
      assert.equal(res.body.results[0].feedId, 'f1')
      assert.equal(res.body.results[0].success, true)

      // The refreshed rows spare the client a follow-up GET.
      assert.equal(res.body.feeds.length, 1)
      assert.equal(res.body.feeds[0].last_sync_status, 'success')
      assert.equal(backend.db.assignments.length, 2)
    })

    it('syncs only the requested feed when feedId is supplied', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS
      backend.ics['/two.ics'] = TWO_EVENT_ICS
      backend.db.ics_feeds = [
        { id: 'f1', user_id: me.id, url: 'https://93.184.216.34/one.ics', label: 'One' },
        { id: 'f2', user_id: me.id, url: 'https://93.184.216.34/two.ics', label: 'Two' },
      ]

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: { feedId: 'f2' } })

      assert.equal(res.body.syncedFeeds, 1)
      assert.equal(res.body.results[0].feedId, 'f2')
      assert.equal(backend.db.assignments.length, 2)
    })

    it('aggregates totals across multiple feeds', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS
      backend.ics['/two.ics'] = icsFeed(
        vevent({ UID: 'hw3@test', SUMMARY: 'Homework 3', DTSTART: '20260903T120000Z', DTEND: '20260903T235900Z' }),
        vevent({ UID: 'hw4@test', SUMMARY: 'Homework 4', DTSTART: '20260904T120000Z', DTEND: '20260904T235900Z' })
      )
      backend.db.ics_feeds = [
        { id: 'f1', user_id: me.id, url: 'https://93.184.216.34/one.ics', label: 'One', created_at: '2026-01-01' },
        { id: 'f2', user_id: me.id, url: 'https://93.184.216.34/two.ics', label: 'Two', created_at: '2026-02-01' },
      ]

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })

      assert.equal(res.body.syncedFeeds, 2)
      assert.equal(res.body.totals.coursesInserted, 2)        // one course per labelled feed
      assert.equal(res.body.totals.assignmentsInserted, 3)    // 1 + 2
      assert.equal(res.body.changed, true)
      assert.deepEqual(res.body.results.map((r) => r.feedId), ['f1', 'f2'])
      assert.equal(backend.db.assignments.length, 3)
    })

    it('keeps syncing the remaining feeds when one of them fails', async () => {
      const me = signIn()
      backend.ics['/bad.ics'] = new Error('feed host unreachable')
      backend.ics['/two.ics'] = TWO_EVENT_ICS
      backend.db.ics_feeds = [
        { id: 'fbad', user_id: me.id, url: 'https://93.184.216.34/bad.ics', label: 'Bad', created_at: '2026-01-01' },
        { id: 'f2', user_id: me.id, url: 'https://93.184.216.34/two.ics', label: 'Good', created_at: '2026-02-01' },
      ]

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })

      assert.equal(res.status, 200)
      assert.equal(res.body.syncedFeeds, 2)
      assert.equal(res.body.results[0].success, false)
      assert.match(res.body.results[0].error, /feed host unreachable/)
      assert.equal(res.body.results[1].success, true)
      assert.equal(res.body.totals.assignmentsInserted, 2, 'failed feed contributes nothing to totals')
      assert.equal(backend.db.assignments.length, 2)
      assert.equal(backend.db.ics_feeds.find((f) => f.id === 'fbad').last_sync_status, 'error')
      assert.equal(backend.db.ics_feeds.find((f) => f.id === 'f2').last_sync_status, 'success')
    })

    it('reports changed:false and skips the write when the content hash matches', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = TWO_EVENT_ICS
      backend.db.ics_feeds = [{
        id: 'f1',
        user_id: me.id,
        url: 'https://93.184.216.34/one.ics',
        label: 'One',
        content_hash: feedContentHash(TWO_EVENT_ICS),
        created_at: '2026-01-01',
      }]

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })

      assert.equal(res.body.syncedFeeds, 1)
      assert.equal(res.body.changed, false)
      assert.deepEqual(res.body.totals, ZERO_TOTALS)
      assert.equal(res.body.results[0].skipped, true)
      assert.equal(backend.db.assignments.length, 0)
      assert.equal(
        backend.rest.filter((c) => c.table === 'assignments').length,
        0,
        'the unchanged fast path must not touch the assignments table at all'
      )
    })

    it('answers 500 when the feed select fails outright', async () => {
      const me = signIn()
      backend.restHook = (ctx) =>
        ctx.table === 'ics_feeds' && ctx.method === 'GET'
          ? { status: 500, body: { code: 'XX000', message: 'db unavailable' } }
          : undefined

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })
      assert.equal(res.status, 500)
      assert.deepEqual(res.body, { success: false, error: 'Sync failed' })
    })

    it('still answers 200 when the trailing feed-refresh select fails', async () => {
      const me = signIn()
      backend.ics['/one.ics'] = ONE_EVENT_ICS
      backend.db.ics_feeds = [{ id: 'f1', user_id: me.id, url: 'https://93.184.216.34/one.ics', label: 'One' }]

      let feedSelects = 0
      backend.restHook = (ctx) => {
        if (ctx.table !== 'ics_feeds' || ctx.method !== 'GET') return undefined
        feedSelects++
        // The first select is selectSyncFeeds; the last one is the refresh.
        return feedSelects > 1 ? { status: 500, body: { code: 'XX000', message: 'flaky' } } : undefined
      }

      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })
      assert.equal(res.status, 200)
      assert.equal(res.body.success, true)
      assert.deepEqual(res.body.feeds, [], 'refresh failure is non-fatal; the client keeps its cache')
    })

    it('mounts the tighter sync rate limiter (20 per 5 min)', async () => {
      const me = signIn()
      const res = await call('POST', '/api/ics/sync', { headers: me.headers, body: {} })
      assert.equal(res.headers['ratelimit-limit'], '20')
      assert.equal(res.headers['ratelimit-remaining'], '19')
    })
  })
})
