import { setActivePinia, createPinia } from 'pinia'
import { useIcsFeedsStore } from '../icsFeeds.js'

vi.mock('../../services/icsService', () => ({
  listFeeds: vi.fn().mockResolvedValue([]),
  addFeed: vi.fn().mockResolvedValue({ id: 'feed-1', url: 'https://example.com/feed.ics', label: 'CS 3340' }),
  removeFeed: vi.fn().mockResolvedValue(undefined),
  syncAll: vi.fn().mockResolvedValue({ changed: true, feeds: [] }),
  syncOne: vi.fn().mockResolvedValue({ changed: true, feeds: [] }),
}))

vi.mock('../../services/lmsSupabaseHydration', () => ({
  hydrateLmsStoresFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

import * as icsService from '../../services/icsService'
import { hydrateLmsStoresFromSupabase } from '../../services/lmsSupabaseHydration'

/** A server feed row, shaped like what `/api/ics/feeds` returns. */
function makeFeed(overrides = {}) {
  return {
    id: 'f1',
    url: 'https://example.com/feed.ics',
    label: 'CS 3340',
    last_synced_at: null,
    ...overrides,
  }
}

/** Externally-resolvable promise, used to hold a request in flight. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Drain the microtask + timer queues. */
const settleBackgroundWork = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // Re-arm the happy-path defaults. vi.clearAllMocks() only wipes call history,
  // so a test that installs a persistent implementation (e.g. a request that
  // never resolves) would otherwise hang every test that follows it.
  icsService.listFeeds.mockResolvedValue([])
  icsService.addFeed.mockResolvedValue(makeFeed({ id: 'feed-1' }))
  icsService.removeFeed.mockResolvedValue(undefined)
  icsService.syncAll.mockResolvedValue({ changed: true, feeds: [] })
  icsService.syncOne.mockResolvedValue({ changed: true, feeds: [] })
  hydrateLmsStoresFromSupabase.mockResolvedValue(undefined)
})

// ── hasFeeds ──────────────────────────────────────────────────────────────────

describe('hasFeeds', () => {
  it('is false when the feeds list is empty', () => {
    const store = useIcsFeedsStore()
    expect(store.hasFeeds).toBe(false)
  })

  it('is true once a feed is in the list', () => {
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1', url: 'https://example.com/feed.ics' })
    expect(store.hasFeeds).toBe(true)
  })
})

// ── fetchFeeds ────────────────────────────────────────────────────────────────

describe('fetchFeeds', () => {
  it('populates feeds on success', async () => {
    icsService.listFeeds.mockResolvedValueOnce([{ id: 'f1', url: 'https://a.com/feed.ics' }])
    const store = useIcsFeedsStore()
    await store.fetchFeeds()
    expect(store.feeds).toHaveLength(1)
    expect(store.feeds[0].id).toBe('f1')
    expect(store.loading).toBe(false)
  })

  it('clears feeds and sets lastError on failure', async () => {
    icsService.listFeeds.mockRejectedValueOnce(new Error('Network error'))
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'old', url: 'https://old.com' }) // pre-existing
    await store.fetchFeeds()
    expect(store.feeds).toHaveLength(0)
    expect(store.lastError).toBe('Network error')
    expect(store.loading).toBe(false)
  })

  it('sets loading=true during the request and false afterwards', async () => {
    let resolveFeeds
    icsService.listFeeds.mockImplementationOnce(() => new Promise(r => { resolveFeeds = r }))
    const store = useIcsFeedsStore()
    const fetchPromise = store.fetchFeeds()
    expect(store.loading).toBe(true)
    resolveFeeds([])
    await fetchPromise
    expect(store.loading).toBe(false)
  })
})

// ── addFeed ───────────────────────────────────────────────────────────────────

describe('addFeed', () => {
  it('appends the new feed to the list', async () => {
    const store = useIcsFeedsStore()
    await store.addFeed('https://example.com/feed.ics', 'CS 3340')
    expect(store.feeds).toHaveLength(1)
    expect(store.feeds[0].id).toBe('feed-1')
  })

  it('calls icsService.addFeed with url and label', async () => {
    const store = useIcsFeedsStore()
    await store.addFeed('https://canvas.example.edu/feed.ics', 'My Course')
    expect(icsService.addFeed).toHaveBeenCalledWith('https://canvas.example.edu/feed.ics', 'My Course')
  })

  it('sets lastError and rethrows on failure', async () => {
    icsService.addFeed.mockRejectedValueOnce(new Error('Invalid ICS URL'))
    const store = useIcsFeedsStore()
    await expect(store.addFeed('https://bad.url', '')).rejects.toThrow('Invalid ICS URL')
    expect(store.lastError).toBe('Invalid ICS URL')
  })

  it('does not modify feeds list on failure', async () => {
    icsService.addFeed.mockRejectedValueOnce(new Error('Bad'))
    const store = useIcsFeedsStore()
    try { await store.addFeed('https://bad', '') } catch {}
    expect(store.feeds).toHaveLength(0)
  })
})

// ── removeFeed ────────────────────────────────────────────────────────────────

describe('removeFeed', () => {
  it('removes the feed from the local list', async () => {
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1', url: 'https://a.com' }, { id: 'f2', url: 'https://b.com' })
    await store.removeFeed('f1')
    expect(store.feeds).toHaveLength(1)
    expect(store.feeds[0].id).toBe('f2')
  })

  it('calls icsService.removeFeed with the given id', async () => {
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1', url: 'https://a.com' })
    await store.removeFeed('f1')
    expect(icsService.removeFeed).toHaveBeenCalledWith('f1')
  })

  it('triggers a hydration to refresh courses/assignments', async () => {
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1', url: 'https://a.com' })
    await store.removeFeed('f1')
    expect(hydrateLmsStoresFromSupabase).toHaveBeenCalledOnce()
  })

  it('sets lastError and rethrows on failure', async () => {
    icsService.removeFeed.mockRejectedValueOnce(new Error('Server error'))
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1', url: 'https://a.com' })
    await expect(store.removeFeed('f1')).rejects.toThrow('Server error')
    expect(store.lastError).toBe('Server error')
  })
})

// ── syncAll ───────────────────────────────────────────────────────────────────

describe('syncAll', () => {
  it('stores the sync result in lastSyncResult', async () => {
    icsService.syncAll.mockResolvedValueOnce({ changed: true, assignmentsInserted: 3, feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(store.lastSyncResult?.assignmentsInserted).toBe(3)
  })

  it('hydrates stores when result.changed is true', async () => {
    icsService.syncAll.mockResolvedValueOnce({ changed: true, feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(hydrateLmsStoresFromSupabase).toHaveBeenCalledOnce()
  })

  it('skips hydration when result.changed is false', async () => {
    icsService.syncAll.mockResolvedValueOnce({ changed: false, feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(hydrateLmsStoresFromSupabase).not.toHaveBeenCalled()
  })

  it('returns null and does nothing when already syncing', async () => {
    let resolveSync
    icsService.syncAll.mockImplementationOnce(() => new Promise(r => { resolveSync = r }))
    const store = useIcsFeedsStore()
    const first = store.syncAll() // starts sync, syncing=true
    const second = store.syncAll() // should be blocked
    expect(await second).toBeNull()
    resolveSync({ changed: false, feeds: [] })
    await first
  })

  it('clears syncing flag even when the request fails', async () => {
    icsService.syncAll.mockRejectedValueOnce(new Error('Timeout'))
    const store = useIcsFeedsStore()
    try { await store.syncAll() } catch {}
    expect(store.syncing).toBe(false)
    expect(store.lastError).toBe('Timeout')
  })

  it('updates feeds from the response feeds array', async () => {
    const updatedFeeds = [{ id: 'f1', url: 'https://a.com', last_synced_at: '2026-09-01' }]
    icsService.syncAll.mockResolvedValueOnce({ changed: true, feeds: updatedFeeds })
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(store.feeds).toEqual(updatedFeeds)
  })
})

// ── syncOne (per-feed scoping) ────────────────────────────────────────────────

describe('syncOne', () => {
  it('marks only the clicked feed as syncing, not the others', async () => {
    let resolveSync
    icsService.syncOne.mockImplementationOnce(() => new Promise(r => { resolveSync = r }))
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1', url: 'https://a.com' }, { id: 'f2', url: 'https://b.com' })

    const p = store.syncOne('f1')
    expect(store.isSyncing('f1')).toBe(true)
    expect(store.isSyncing('f2')).toBe(false) // the other feed stays idle
    expect(store.syncing).toBe(true)

    resolveSync({ changed: false, feeds: [] })
    await p
    expect(store.isSyncing('f1')).toBe(false)
    expect(store.syncing).toBe(false)
  })

  it('blocks a second sync of the same feed but allows a different feed concurrently', async () => {
    icsService.syncOne.mockImplementation(() => new Promise(() => {})) // never resolves
    const store = useIcsFeedsStore()

    store.syncOne('f1')
    const dup = store.syncOne('f1') // same feed → blocked
    expect(await dup).toBeNull()
    expect(icsService.syncOne).toHaveBeenCalledTimes(1)

    store.syncOne('f2') // different feed → proceeds
    expect(icsService.syncOne).toHaveBeenCalledTimes(2)
    expect(store.isSyncing('f1')).toBe(true)
    expect(store.isSyncing('f2')).toBe(true)
  })

  it('clears the feed from the syncing set even when the request fails', async () => {
    icsService.syncOne.mockRejectedValueOnce(new Error('Timeout'))
    const store = useIcsFeedsStore()
    try { await store.syncOne('f1') } catch {}
    expect(store.isSyncing('f1')).toBe(false)
    expect(store.syncing).toBe(false)
    expect(store.lastError).toBe('Timeout')
  })

  it('reports every feed as syncing during a bulk syncAll', async () => {
    let resolveSync
    icsService.syncAll.mockImplementationOnce(() => new Promise(r => { resolveSync = r }))
    const store = useIcsFeedsStore()
    const p = store.syncAll()
    expect(store.isSyncing('anything')).toBe(true) // bulk sync spins all rows
    resolveSync({ changed: false, feeds: [] })
    await p
    expect(store.isSyncing('anything')).toBe(false)
  })
})

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all store state', () => {
    const store = useIcsFeedsStore()
    store.feeds.push({ id: 'f1' })
    store.lastSyncResult = { changed: true }
    store.lastError = 'Some error'
    store.reset()
    expect(store.feeds).toHaveLength(0)
    expect(store.lastSyncResult).toBeNull()
    expect(store.lastError).toBeNull()
    expect(store.syncing).toBe(false)
    expect(store.loading).toBe(false)
  })
})

// ── syncing / isSyncing derivation ────────────────────────────────────────────
//
// `syncing` is the "anything in flight" guard used by the auto-sync; `isSyncing`
// is the per-row spinner. They read from two different sources of truth.

describe('syncing and isSyncing', () => {
  it('is idle with no bulk sync and an empty id set', () => {
    const store = useIcsFeedsStore()
    expect(store.syncing).toBe(false)
    expect(store.isSyncing('f1')).toBe(false)
  })

  it('is true while a bulk sync is flagged', () => {
    const store = useIcsFeedsStore()
    store.syncingAll = true
    expect(store.syncing).toBe(true)
    expect(store.isSyncing('any-feed')).toBe(true)
  })

  it('is true while a single feed is in the id set, and scoped to that feed', () => {
    const store = useIcsFeedsStore()
    store.syncingIds = new Set(['f1'])
    expect(store.syncing).toBe(true)
    expect(store.isSyncing('f1')).toBe(true)
    expect(store.isSyncing('f2')).toBe(false)
  })
})

// ── applySyncedFeeds (via syncAll/syncOne) ────────────────────────────────────
//
// The sync response normally carries the refreshed rows so the UI does not need
// a second GET; only an older server omits them.

describe('applySyncedFeeds', () => {
  it('uses the rows from the response without re-listing', async () => {
    const rows = [makeFeed({ last_synced_at: '2026-09-01T00:00:00Z' })]
    icsService.syncAll.mockResolvedValueOnce({ changed: true, feeds: rows })
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(store.feeds).toEqual(rows)
    expect(icsService.listFeeds).not.toHaveBeenCalled()
  })

  it('falls back to a list fetch when the response omits feeds', async () => {
    const rows = [makeFeed({ id: 'from-list' })]
    icsService.syncAll.mockResolvedValueOnce({ changed: true })
    icsService.listFeeds.mockResolvedValueOnce(rows)
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(icsService.listFeeds).toHaveBeenCalledOnce()
    expect(store.feeds).toEqual(rows)
  })

  it('keeps the sync result when the fallback list fetch fails', async () => {
    icsService.syncAll.mockResolvedValueOnce({ changed: true, assignmentsInserted: 2 })
    icsService.listFeeds.mockRejectedValueOnce(new Error('offline'))
    const store = useIcsFeedsStore()
    const existing = makeFeed()
    store.feeds.push(existing)

    await expect(store.syncAll()).resolves.toMatchObject({ assignmentsInserted: 2 })

    expect(store.feeds).toEqual([existing]) // untouched, not wiped
    expect(store.lastError).toBeNull() // the fallback failure is non-fatal
  })

  it('applies the refreshed rows before hydrating the LMS stores', async () => {
    const rows = [makeFeed({ last_synced_at: '2026-09-01T00:00:00Z' })]
    icsService.syncAll.mockResolvedValueOnce({ changed: true, feeds: rows })
    const store = useIcsFeedsStore()
    let feedsSeenByHydration = null
    hydrateLmsStoresFromSupabase.mockImplementationOnce(async () => {
      feedsSeenByHydration = [...store.feeds]
    })

    await store.syncAll()

    expect(feedsSeenByHydration).toEqual(rows)
  })
})

// ── syncOne (result handling) ─────────────────────────────────────────────────

describe('syncOne result handling', () => {
  it('passes the feed id through to the service', async () => {
    const store = useIcsFeedsStore()
    await store.syncOne('f7')
    expect(icsService.syncOne).toHaveBeenCalledWith('f7')
  })

  it('stores the result and returns it', async () => {
    icsService.syncOne.mockResolvedValueOnce({ changed: true, assignmentsInserted: 5, feeds: [] })
    const store = useIcsFeedsStore()
    const result = await store.syncOne('f1')
    expect(result.assignmentsInserted).toBe(5)
    expect(store.lastSyncResult).toEqual(result)
  })

  it('hydrates when the feed changed', async () => {
    icsService.syncOne.mockResolvedValueOnce({ changed: true, feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncOne('f1')
    expect(hydrateLmsStoresFromSupabase).toHaveBeenCalledOnce()
  })

  it('skips hydration when the server reports nothing changed', async () => {
    icsService.syncOne.mockResolvedValueOnce({ changed: false, feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncOne('f1')
    expect(hydrateLmsStoresFromSupabase).not.toHaveBeenCalled()
  })

  it('hydrates when an older server omits the changed flag', async () => {
    icsService.syncOne.mockResolvedValueOnce({ feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncOne('f1')
    expect(hydrateLmsStoresFromSupabase).toHaveBeenCalledOnce()
  })

  it('adopts the refreshed rows the response carries', async () => {
    const rows = [makeFeed({ last_synced_at: '2026-09-01T12:00:00Z' })]
    icsService.syncOne.mockResolvedValueOnce({ changed: true, feeds: rows })
    const store = useIcsFeedsStore()
    store.feeds.push(makeFeed())
    await store.syncOne('f1')
    expect(store.feeds).toEqual(rows)
  })

  it('is skipped entirely while a bulk sync is already running', async () => {
    const bulk = deferred()
    icsService.syncAll.mockReturnValueOnce(bulk.promise)
    const store = useIcsFeedsStore()
    const all = store.syncAll()

    await expect(store.syncOne('f1')).resolves.toBeNull()
    expect(icsService.syncOne).not.toHaveBeenCalled()

    bulk.resolve({ changed: false, feeds: [] })
    await all
  })
})

// ── syncAll (hydration timing and older servers) ──────────────────────────────

describe('syncAll hydration', () => {
  it('hydrates when an older server omits the changed flag', async () => {
    icsService.syncAll.mockResolvedValueOnce({ feeds: [] })
    const store = useIcsFeedsStore()
    await store.syncAll()
    expect(hydrateLmsStoresFromSupabase).toHaveBeenCalledOnce()
  })

  it('stays in the syncing state until the hydration finishes', async () => {
    const hydration = deferred()
    hydrateLmsStoresFromSupabase.mockReturnValueOnce(hydration.promise)
    icsService.syncAll.mockResolvedValueOnce({ changed: true, feeds: [] })
    const store = useIcsFeedsStore()

    let resolved = false
    const p = store.syncAll().then(() => { resolved = true })
    await settleBackgroundWork()

    // Refreshing courses/assignments is part of the sync, so the spinner must
    // not stop before that lands.
    expect(resolved).toBe(false)
    expect(store.syncing).toBe(true)

    hydration.resolve()
    await p
    expect(resolved).toBe(true)
    expect(store.syncing).toBe(false)
  })

  it('rethrows and clears the flag when the hydration itself fails', async () => {
    icsService.syncAll.mockResolvedValueOnce({ changed: true, feeds: [] })
    hydrateLmsStoresFromSupabase.mockRejectedValueOnce(new Error('hydration failed'))
    const store = useIcsFeedsStore()
    await expect(store.syncAll()).rejects.toThrow('hydration failed')
    expect(store.lastError).toBe('hydration failed')
    expect(store.syncing).toBe(false)
  })
})

// ── lastError bookkeeping ─────────────────────────────────────────────────────

describe('lastError', () => {
  it('is cleared by the next successful fetch', async () => {
    icsService.listFeeds.mockRejectedValueOnce(new Error('Network error'))
    const store = useIcsFeedsStore()
    await store.fetchFeeds()
    expect(store.lastError).toBe('Network error')

    icsService.listFeeds.mockResolvedValueOnce([makeFeed()])
    await store.fetchFeeds()
    expect(store.lastError).toBeNull()
  })

  it('stringifies a rejection that is not an Error', async () => {
    icsService.syncAll.mockRejectedValueOnce('server exploded')
    const store = useIcsFeedsStore()
    await expect(store.syncAll()).rejects.toBe('server exploded')
    expect(store.lastError).toBe('server exploded')
  })

  it('is cleared when a new sync starts', async () => {
    const store = useIcsFeedsStore()
    store.lastError = 'stale message'
    await store.syncOne('f1')
    expect(store.lastError).toBeNull()
  })
})

// ── addFeed / removeFeed edge cases ───────────────────────────────────────────

describe('addFeed edge cases', () => {
  it('leaves the list alone when the server returns no row', async () => {
    icsService.addFeed.mockResolvedValueOnce(undefined)
    const store = useIcsFeedsStore()
    const created = await store.addFeed('https://example.com/feed.ics', 'CS 3340')
    expect(created).toBeUndefined()
    expect(store.feeds).toHaveLength(0)
  })

  it('appends without disturbing the feeds already listed', async () => {
    const existing = makeFeed({ id: 'existing' })
    icsService.addFeed.mockResolvedValueOnce(makeFeed({ id: 'brand-new' }))
    const store = useIcsFeedsStore()
    store.feeds.push(existing)
    await store.addFeed('https://example.com/other.ics', 'Other')
    expect(store.feeds.map((f) => f.id)).toEqual(['existing', 'brand-new'])
  })

  it('clears a previous error before trying again', async () => {
    const store = useIcsFeedsStore()
    store.lastError = 'stale message'
    await store.addFeed('https://example.com/feed.ics', 'CS 3340')
    expect(store.lastError).toBeNull()
  })
})

describe('removeFeed edge cases', () => {
  it('keeps the feed locally when the delete fails', async () => {
    icsService.removeFeed.mockRejectedValueOnce(new Error('Server error'))
    const store = useIcsFeedsStore()
    store.feeds.push(makeFeed({ id: 'f1' }))
    await expect(store.removeFeed('f1')).rejects.toThrow('Server error')
    expect(store.feeds).toHaveLength(1)
    expect(hydrateLmsStoresFromSupabase).not.toHaveBeenCalled()
  })

  it('surfaces a hydration failure after the local removal', async () => {
    hydrateLmsStoresFromSupabase.mockRejectedValueOnce(new Error('hydration failed'))
    const store = useIcsFeedsStore()
    store.feeds.push(makeFeed({ id: 'f1' }))
    await expect(store.removeFeed('f1')).rejects.toThrow('hydration failed')
    expect(store.feeds).toHaveLength(0) // the local removal already happened
    expect(store.lastError).toBe('hydration failed')
  })

  it('leaves the list unchanged when the id is not present', async () => {
    const store = useIcsFeedsStore()
    store.feeds.push(makeFeed({ id: 'f1' }))
    await store.removeFeed('not-here')
    expect(store.feeds.map((f) => f.id)).toEqual(['f1'])
  })
})

// ── reset while work is in flight ─────────────────────────────────────────────

describe('reset while syncing', () => {
  it('drops the syncing flags so a stuck sync cannot freeze the UI', () => {
    const store = useIcsFeedsStore()
    store.syncingAll = true
    store.syncingIds = new Set(['f1', 'f2'])
    store.loading = true
    store.reset()
    expect(store.syncingAll).toBe(false)
    expect(store.syncingIds.size).toBe(0)
    expect(store.loading).toBe(false)
    expect(store.isSyncing('f1')).toBe(false)
  })
})
