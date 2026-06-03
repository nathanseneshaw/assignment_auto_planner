import { onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useIcsFeedsStore } from '../stores/icsFeeds'
import { isSupabaseConfigured } from '../lib/supabase'

const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const FOCUS_REFRESH_MIN_GAP_MS = 60 * 1000 // don't re-sync within 60s of the last sync

/**
 * Mount once in App.vue. Syncs the user's ICS feeds on app launch and then
 * periodically — but only while the window is actually in the foreground.
 *
 * Why visibility-gated: a desktop window left minimized (or a background
 * browser tab) used to keep firing a full sync every 15 minutes forever, which
 * was the dominant source of Supabase requests "when nobody is on the app".
 * We now skip the network entirely while hidden and do one catch-up sync when
 * the window returns to the foreground.
 *
 * Safe to call when Supabase is not configured (no-ops).
 */
export function useIcsAutoSync() {
  if (!isSupabaseConfigured) return

  const authStore = useAuthStore()
  const feedsStore = useIcsFeedsStore()

  let intervalId = null
  let stopWatchUser = null
  let visibilityHandler = null
  let lastSyncAt = 0

  function isVisible() {
    return typeof document === 'undefined' || document.visibilityState === 'visible'
  }

  async function syncIfPossible() {
    if (!authStore.user) return
    if (feedsStore.syncing) return
    // If we believe there are no feeds, refresh the list first — a feed added
    // on another device would otherwise never be discovered until a restart.
    // Cheap: zero-feed users generate no sync traffic otherwise, and this only
    // runs on the 30-min tick / foreground catch-up, not continuously.
    if (feedsStore.feeds.length === 0) {
      try {
        await feedsStore.fetchFeeds()
      } catch {
        // Surfaced via feedsStore.lastError.
      }
      if (feedsStore.feeds.length === 0) return
    }
    try {
      // syncAll() now returns the refreshed feed list and only re-hydrates
      // Pinia when the DB actually changed — so an unchanged tick is cheap.
      await feedsStore.syncAll()
    } catch (e) {
      // Errors are surfaced via feedsStore.lastError; keep the interval alive.
      console.warn('[ICS auto-sync]', e?.message || e)
    } finally {
      // Measure the focus-debounce window from completion, not start, so a slow
      // or early-failing sync doesn't wrongly suppress the next catch-up.
      lastSyncAt = Date.now()
    }
  }

  /**
   * Load the feed list once (per sign-in) so we know whether there's anything
   * to sync, then run an initial sync. The list is NOT re-fetched every tick —
   * subsequent syncs reuse the feed rows returned by syncAll().
   */
  async function primeAndSync() {
    if (!authStore.user) return
    try {
      await feedsStore.fetchFeeds()
    } catch {
      // Surfaced via feedsStore.lastError.
    }
    await syncIfPossible()
  }

  function startInterval() {
    if (intervalId) return
    intervalId = setInterval(() => {
      // Skip the network while the window is hidden/backgrounded.
      if (!isVisible()) return
      void syncIfPossible()
    }, INTERVAL_MS)
  }

  function stopInterval() {
    if (!intervalId) return
    clearInterval(intervalId)
    intervalId = null
  }

  function onVisibility() {
    if (!isVisible()) return
    if (!authStore.user) return
    // Catch up on return to foreground, but debounce rapid focus/blur toggling.
    if (Date.now() - lastSyncAt < FOCUS_REFRESH_MIN_GAP_MS) return
    void syncIfPossible()
  }

  onMounted(() => {
    if (authStore.user) {
      void primeAndSync()
      startInterval()
    }
    stopWatchUser = watch(
      () => authStore.user,
      (u) => {
        if (u) {
          void primeAndSync()
          startInterval()
        } else {
          stopInterval()
          feedsStore.reset()
        }
      }
    )
    if (typeof document !== 'undefined') {
      visibilityHandler = onVisibility
      document.addEventListener('visibilitychange', visibilityHandler)
    }
  })

  onUnmounted(() => {
    stopInterval()
    if (stopWatchUser) stopWatchUser()
    if (visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  })
}
