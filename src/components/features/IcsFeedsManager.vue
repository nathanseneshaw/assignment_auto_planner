<script setup>
import { onMounted, ref } from 'vue'
import { Button, Input, ConfirmDialog } from '../ui'
import IntegrationRow from './IntegrationRow.vue'
import { useIcsFeedsStore } from '../../stores/icsFeeds'
import { useAuthStore } from '../../stores/auth'

const feedsStore = useIcsFeedsStore()
const authStore = useAuthStore()

// One calendar feed per account: the "Connect" affordance only appears while
// no feed exists, and once connected the row stays — clickable to re-sync.
const adding = ref(false)
const newUrl = ref('')
const formError = ref('')
const addInFlight = ref(false)

const showRemoveConfirm = ref(false)
const feedPendingRemoval = ref(null)

onMounted(async () => {
  if (authStore.user) await feedsStore.fetchFeeds()
})

/** Human "14 min ago" style stamp for the subtitle; null when never synced. */
function relativeTime(ts) {
  if (!ts) return null
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return null
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

function feedSubtitle(feed) {
  if (feed.last_sync_status === 'error') {
    return feed.last_sync_error || 'Last sync failed — click Retry'
  }
  const rel = relativeTime(feed.last_synced_at)
  if (!rel) return 'Subscribed via URL · not synced yet'
  return `Last synced ${rel} · subscribed via URL`
}

function openForm() {
  formError.value = ''
  adding.value = true
}

function cancelForm() {
  adding.value = false
  newUrl.value = ''
  formError.value = ''
}

async function handleAdd() {
  formError.value = ''
  const url = newUrl.value.trim()
  if (!url) {
    formError.value = 'Paste an ICS calendar URL.'
    return
  }
  addInFlight.value = true
  try {
    await feedsStore.addFeed(url, null)
    cancelForm()
    // Auto-trigger a first sync so the user sees assignments immediately.
    await feedsStore.syncAll()
  } catch (e) {
    adding.value = true
    formError.value = e?.message || 'Could not add feed.'
  } finally {
    addInFlight.value = false
  }
}

async function handleResync(feed) {
  if (feedsStore.syncing) return
  try {
    await feedsStore.syncOne(feed.id)
  } catch (e) {
    alert(e?.message || 'Sync failed.')
  }
}

function handleRemove(feed) {
  feedPendingRemoval.value = feed
  showRemoveConfirm.value = true
}

async function confirmRemoveFeed() {
  const feed = feedPendingRemoval.value
  feedPendingRemoval.value = null
  if (!feed) return
  try {
    await feedsStore.removeFeed(feed.id)
  } catch (e) {
    alert(e?.message || 'Could not remove feed.')
  }
}
</script>

<template>
  <!-- Connected feed(s). Single-feed accounts show exactly one row; the pill
       on the right re-syncs on every click. -->
  <IntegrationRow
    v-for="feed in feedsStore.feeds"
    :key="feed.id"
    icon="🎓"
    :title="feed.label || 'Calendar feed'"
  >
    <template #subtitle>
      <span :class="feed.last_sync_status === 'error' ? 'text-danger-600 dark:text-danger-400' : ''">
        {{ feedSubtitle(feed) }}
      </span>
    </template>

    <template #action>
      <button
        type="button"
        title="Remove feed"
        class="w-7 h-7 rounded-full inline-flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/30"
        @click="handleRemove(feed)"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2 4h10M5.5 4V2.5h3V4M5.5 6.5v4M8.5 6.5v4M3.5 4l.5 8h6l.5-8" />
        </svg>
      </button>

      <button
        type="button"
        :disabled="feedsStore.syncing"
        :title="feed.last_sync_status === 'error' ? 'Retry sync' : 'Sync now'"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed"
        :class="feed.last_sync_status === 'error'
          ? 'bg-danger-100 text-danger-700 hover:bg-danger-200 dark:bg-danger-900/40 dark:text-danger-300 dark:hover:bg-danger-900/60 focus-visible:ring-danger-500/30'
          : 'bg-primary-100/70 text-primary-800 hover:bg-primary-200/80 dark:bg-primary-900/40 dark:text-primary-300 dark:hover:bg-primary-900/60 focus-visible:ring-primary-500/30'"
        @click="handleResync(feed)"
      >
        <svg v-if="feedsStore.syncing" class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" />
        </svg>
        {{ feedsStore.syncing ? 'Syncing…' : (feed.last_sync_status === 'error' ? 'Retry' : 'Connected') }}
      </button>
    </template>
  </IntegrationRow>

  <!-- No feed yet → the "Connect" affordance. Hidden once one exists. -->
  <IntegrationRow
    v-if="feedsStore.feeds.length === 0"
    icon="🎓"
    title="Calendar feed (ICS)"
    subtitle="Canvas, Brightspace, Blackboard · subscribe via URL"
  >
    <template #action>
      <button
        v-if="!adding"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors border-gray-300 text-gray-700 hover:bg-white/70 hover:border-gray-400 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/30"
        @click="openForm"
      >
        Connect <span aria-hidden="true">→</span>
      </button>
    </template>
  </IntegrationRow>

  <!-- Inline URL form, aligned under the row title. -->
  <form
    v-if="adding && feedsStore.feeds.length === 0"
    class="pl-[3.375rem] pr-1 pb-4 -mt-1 space-y-2.5"
    @submit.prevent="handleAdd"
  >
    <Input
      v-model="newUrl"
      type="url"
      placeholder="https://canvas.instructure.com/feeds/calendars/user_xxx.ics"
      :error="formError"
    />
    <div class="flex items-center gap-2">
      <Button type="submit" size="sm" :loading="addInFlight">Add feed</Button>
      <Button type="button" size="sm" variant="ghost" :disabled="addInFlight" @click="cancelForm">Cancel</Button>
    </div>
  </form>

  <ConfirmDialog
    v-model="showRemoveConfirm"
    title="Remove this feed?"
    confirm-text="Remove"
    cancel-text="Cancel"
    variant="danger"
    @confirm="confirmRemoveFeed"
    @cancel="feedPendingRemoval = null"
  >
    <div class="space-y-3">
      <p class="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 rounded-lg px-3 py-2 break-all text-left">
        {{ feedPendingRemoval?.url }}
      </p>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        All courses and assignments imported from this feed will be permanently deleted.
      </p>
    </div>
  </ConfirmDialog>
</template>
