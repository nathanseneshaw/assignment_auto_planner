import { onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useIcsFeedsStore } from '../stores/icsFeeds'
import { isSupabaseConfigured } from '../lib/supabase'

const INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Mount once in App.vue. Fetches the user's ICS feeds and syncs them
 * on app launch + every 15 minutes while the app is open.
 *
 * Safe to call when Supabase is not configured (no-ops).
 */
export function useIcsAutoSync() {
  if (!isSupabaseConfigured) return

  const authStore = useAuthStore()
  const feedsStore = useIcsFeedsStore()

  let intervalId = null
  let stopWatchUser = null

  async function syncIfPossible() {
    if (!authStore.user) return
    if (feedsStore.syncing) return
    try {
      await feedsStore.fetchFeeds()
      if (feedsStore.feeds.length === 0) return
      await feedsStore.syncAll()
    } catch (e) {
      // Errors are surfaced via feedsStore.lastError; keep the interval alive.
      console.warn('[ICS auto-sync]', e?.message || e)
    }
  }

  function startInterval() {
    if (intervalId) return
    intervalId = setInterval(syncIfPossible, INTERVAL_MS)
  }

  function stopInterval() {
    if (!intervalId) return
    clearInterval(intervalId)
    intervalId = null
  }

  onMounted(() => {
    if (authStore.user) {
      void syncIfPossible()
      startInterval()
    }
    stopWatchUser = watch(
      () => authStore.user,
      (u) => {
        if (u) {
          void syncIfPossible()
          startInterval()
        } else {
          stopInterval()
          feedsStore.reset()
        }
      }
    )
  })

  onUnmounted(() => {
    stopInterval()
    if (stopWatchUser) stopWatchUser()
  })
}
