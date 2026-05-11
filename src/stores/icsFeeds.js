import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as icsService from '../services/icsService'
import { hydrateLmsStoresFromSupabase } from '../services/lmsSupabaseHydration'

export const useIcsFeedsStore = defineStore('icsFeeds', () => {
  const feeds = ref([])
  const loading = ref(false)
  const syncing = ref(false)
  const lastSyncResult = ref(null)
  const lastError = ref(null)

  const hasFeeds = computed(() => feeds.value.length > 0)

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

  async function removeFeed(id) {
    lastError.value = null
    try {
      await icsService.removeFeed(id)
      feeds.value = feeds.value.filter((f) => f.id !== id)
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    }
  }

  async function syncAll() {
    if (syncing.value) return null
    syncing.value = true
    lastError.value = null
    try {
      const result = await icsService.syncAll()
      lastSyncResult.value = result
      // Refresh the feeds list to pick up last_synced_at and status changes.
      try {
        feeds.value = await icsService.listFeeds()
      } catch {
        // non-fatal — sync result already captured.
      }
      // Pull the upserted courses/assignments into the existing Pinia stores.
      await hydrateLmsStoresFromSupabase()
      return result
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    } finally {
      syncing.value = false
    }
  }

  async function syncOne(id) {
    if (syncing.value) return null
    syncing.value = true
    lastError.value = null
    try {
      const result = await icsService.syncOne(id)
      lastSyncResult.value = result
      try {
        feeds.value = await icsService.listFeeds()
      } catch {
        /* non-fatal */
      }
      await hydrateLmsStoresFromSupabase()
      return result
    } catch (e) {
      lastError.value = e?.message || String(e)
      throw e
    } finally {
      syncing.value = false
    }
  }

  function reset() {
    feeds.value = []
    lastSyncResult.value = null
    lastError.value = null
    syncing.value = false
    loading.value = false
  }

  return {
    feeds,
    loading,
    syncing,
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
