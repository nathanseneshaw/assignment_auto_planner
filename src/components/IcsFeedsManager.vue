<script setup>
import { onMounted, ref, computed } from 'vue'
import { Button, Card, Input, Badge, EmptyState } from './ui'
import { useIcsFeedsStore } from '../stores/icsFeeds'
import { useAuthStore } from '../stores/auth'

const feedsStore = useIcsFeedsStore()
const authStore = useAuthStore()

const newUrl = ref('')
const newLabel = ref('')
const formError = ref('')
const addInFlight = ref(false)

onMounted(async () => {
  if (authStore.user) await feedsStore.fetchFeeds()
})

const lastSyncTotals = computed(() => feedsStore.lastSyncResult?.totals || null)

function statusVariant(status) {
  if (status === 'success') return 'success'
  if (status === 'error') return 'danger'
  return 'default'
}

function statusLabel(status) {
  if (status === 'success') return 'Synced'
  if (status === 'error') return 'Error'
  return 'Pending'
}

function formatTimestamp(ts) {
  if (!ts) return 'never'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString()
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
    await feedsStore.addFeed(url, newLabel.value.trim() || null)
    newUrl.value = ''
    newLabel.value = ''
    // Auto-trigger a first sync so the user sees assignments immediately.
    await feedsStore.syncAll()
  } catch (e) {
    formError.value = e?.message || 'Could not add feed.'
  } finally {
    addInFlight.value = false
  }
}

async function handleRemove(feed) {
  if (!confirm(`Remove this feed?\n\n${feed.url}\n\nAssignments imported from this feed will stay in your archive.`)) return
  try {
    await feedsStore.removeFeed(feed.id)
  } catch (e) {
    alert(e?.message || 'Could not remove feed.')
  }
}

async function handleSyncOne(feed) {
  try {
    await feedsStore.syncOne(feed.id)
  } catch (e) {
    alert(e?.message || 'Sync failed.')
  }
}

async function handleSyncAll() {
  try {
    await feedsStore.syncAll()
  } catch (e) {
    alert(e?.message || 'Sync failed.')
  }
}
</script>

<template>
  <Card padding="md">
    <div class="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 class="text-lg font-semibold text-gray-900">Calendar feeds (ICS)</h3>
        <p class="text-sm text-gray-500 mt-1">
          Paste the ICS subscription URL from Canvas, Brightspace, Blackboard, or any tool that exports an iCalendar feed.
          Imported assignments are stored in your account and stay visible even if your instructor removes them later.
        </p>
      </div>
      <Button
        v-if="feedsStore.feeds.length > 0"
        size="sm"
        variant="secondary"
        :loading="feedsStore.syncing"
        @click="handleSyncAll"
      >
        Sync all
      </Button>
    </div>

    <div class="space-y-3 mb-6">
      <Input
        v-model="newUrl"
        label="Calendar URL"
        placeholder="https://canvas.instructure.com/feeds/calendars/user_xxx.ics"
        :error="formError"
      />
      <Input
        v-model="newLabel"
        label="Course name (recommended for Blackboard / D2L)"
        placeholder="e.g. CS 3340 — Computer Architecture"
        hint="Used as the course name when the feed itself doesn't identify one. Leave blank for multi-course feeds like Canvas."
      />
      <div>
        <Button :loading="addInFlight" @click="handleAdd">Add feed</Button>
      </div>
    </div>

    <div v-if="feedsStore.lastError" class="mb-4 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-xl p-3">
      {{ feedsStore.lastError }}
    </div>

    <div v-if="lastSyncTotals" class="mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-3">
      Last sync: +{{ lastSyncTotals.assignmentsInserted }} new assignment(s),
      {{ lastSyncTotals.assignmentsUpdated }} updated,
      +{{ lastSyncTotals.coursesInserted }} new course(s).
    </div>

    <div v-if="feedsStore.loading" class="text-sm text-gray-500">Loading feeds…</div>

    <EmptyState
      v-else-if="feedsStore.feeds.length === 0"
      title="No calendar feeds yet"
      description="Add a feed above to start importing assignments."
    />

    <ul v-else class="space-y-3">
      <li
        v-for="feed in feedsStore.feeds"
        :key="feed.id"
        class="flex items-start justify-between gap-4 border border-gray-200 rounded-xl p-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <div class="font-medium text-gray-900 truncate">
              {{ feed.label || feed.url }}
            </div>
            <Badge :variant="statusVariant(feed.last_sync_status)" size="sm" dot>
              {{ statusLabel(feed.last_sync_status) }}
            </Badge>
          </div>
          <div v-if="feed.label" class="text-xs text-gray-500 truncate">{{ feed.url }}</div>
          <div class="text-xs text-gray-500 mt-1">
            Last synced: {{ formatTimestamp(feed.last_synced_at) }}
          </div>
          <div v-if="feed.last_sync_error" class="text-xs text-danger-600 mt-1 break-words">
            {{ feed.last_sync_error }}
          </div>
        </div>
        <div class="flex flex-col gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            :loading="feedsStore.syncing"
            @click="handleSyncOne(feed)"
          >
            Sync
          </Button>
          <Button size="sm" variant="ghost" @click="handleRemove(feed)">Remove</Button>
        </div>
      </li>
    </ul>
  </Card>
</template>
