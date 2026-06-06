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

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
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
