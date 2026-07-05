/**
 * ICS feeds Pinia store.
 *
 * Manages the user's saved iCalendar subscriptions and orchestrates server-side
 * sync. After every sync we re-hydrate the courses + assignments stores from
 * Supabase so the UI reflects what the server just upserted.
 *
 * State flags:
 * - `loading`     : list fetch is in flight.
 * - `syncingAll`  : a bulk (all-feeds) sync POST is in flight.
 * - `syncingIds`  : the set of individual feed ids currently syncing. A single
 *                   feed's Sync button reflects only its own id, so clicking one
 *                   row never shows the others as syncing.
 * - `syncing`     : derived — true when anything (bulk or any single feed) is in
 *                   flight. Kept for the auto-sync guard and legacy callers.
 * - `lastSyncResult` / `lastError` : surfaced to the UI for status badges.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as icsService from '../services/icsService'
import { hydrateLmsStoresFromSupabase } from '../services/lmsSupabaseHydration'

export const useIcsFeedsStore = defineStore('icsFeeds', () => {
  const feeds = ref([])
  const loading = ref(false)
  const syncingAll = ref(false)
  const syncingIds = ref(new Set())
  const lastSyncResult = ref(null)
  const lastError = ref(null)

  const hasFeeds = computed(() => feeds.value.length > 0)

  // True when any sync is in flight — a bulk sync or at least one single feed.
  const syncing = computed(() => syncingAll.value || syncingIds.value.size > 0)

  /**
   * Whether a specific feed row should show its syncing state. True during a
   * bulk sync (every feed is being refreshed) or when that feed is being synced
   * on its own. Drives the per-row spinner so one click never spins the others.
   */
  function isSyncing(id) {
    return syncingAll.value || syncingIds.value.has(id)
  }

  /** Reload the saved feed list from the server. On failure clears local state. */
  async function fetchFeeds() {
    loading.value = true
    lastError.value = null
    try {
      feeds.value = await icsService.listFeeds()
    } catch (e) {
      lastError.value = e?.message || String(e)
      feeds.value = []
    } finally {
      loading.value = false
    }
  }

  /** Subscribe to a new feed and optimistically append it to the local list. */
  async function addFeed(url, label) {
    lastError.value = null
    try {
      const created = await icsService.addFeed(url, label)
      if (created) feeds.value = [...feeds.value, created]
      return created
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    }
  }

  /** Unsubscribe and remove from local cache, along with all associated courses and assignments. */
  async function removeFeed(id) {
    lastError.value = null
    try {
      await icsService.removeFeed(id)
      feeds.value = feeds.value.filter((f) => f.id !== id)
      await hydrateLmsStoresFromSupabase()
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    }
  }

  /**
   * Apply the refreshed feed rows the sync endpoint returns (so we avoid a
   * second `GET /api/ics/feeds`). Falls back to a fetch only when an older
   * server omits `feeds` from the response.
   */
  async function applySyncedFeeds(result) {
    if (Array.isArray(result?.feeds)) {
      feeds.value = result.feeds
      return
    }
    try {
      feeds.value = await icsService.listFeeds()
    } catch {
      // non-fatal — sync result already captured.
    }
  }

  /**
   * Sync every feed, apply the refreshed feed rows the server returns, and
   * re-hydrate the LMS stores only when the DB actually changed. Guarded by
   * `syncing` so the user can't double-trigger.
   */
  async function syncAll() {
    if (syncingAll.value) return null
    syncingAll.value = true
    lastError.value = null
    try {
      const result = await icsService.syncAll()
      lastSyncResult.value = result
      await applySyncedFeeds(result)
      // Only re-hydrate Pinia when the DB actually changed. `changed === false`
      // (new server, nothing new) skips a getUser + 3 table selects; a missing
      // flag (older server) defaults to hydrating so behavior stays correct.
      if (result?.changed !== false) {
        await hydrateLmsStoresFromSupabase()
      }
      return result
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    } finally {
      syncingAll.value = false
    }
  }

  /**
   * Same as {@link syncAll} but scoped to a single feed id. Only that feed's row
   * enters the syncing state; other feeds are untouched and can be synced
   * concurrently. Guarded per-feed so the same row can't be double-triggered,
   * and skipped entirely while a bulk sync is already refreshing everything.
   */
  async function syncOne(id) {
    if (syncingAll.value || syncingIds.value.has(id)) return null
    syncingIds.value.add(id)
    lastError.value = null
    try {
      const result = await icsService.syncOne(id)
      lastSyncResult.value = result
      await applySyncedFeeds(result)
      if (result?.changed !== false) {
        await hydrateLmsStoresFromSupabase()
      }
      return result
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    } finally {
      syncingIds.value.delete(id)
    }
  }

  /** Clear in-memory state — called on sign-out so the next user starts clean. */
  function reset() {
    feeds.value = []
    lastSyncResult.value = null
    lastError.value = null
    syncingAll.value = false
    syncingIds.value = new Set()
    loading.value = false
  }

  return {
    feeds,
    loading,
    syncing,
    syncingAll,
    syncingIds,
    isSyncing,
    lastSyncResult,
    lastError,
    hasFeeds,
    fetchFeeds,
    addFeed,
    removeFeed,
    syncAll,
    syncOne,
    reset,
  }
})
