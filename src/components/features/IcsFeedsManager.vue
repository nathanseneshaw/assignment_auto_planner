<script setup>
import { onMounted, nextTick, ref } from 'vue'
import { Button, Input, ConfirmDialog } from '../ui'
import IntegrationRow from './IntegrationRow.vue'
import { useIcsFeedsStore } from '../../stores/icsFeeds'
import { useAuthStore } from '../../stores/auth'

const feedsStore = useIcsFeedsStore()
const authStore = useAuthStore()

// Users can subscribe to any number of calendar feeds. Each connected feed is
// listed with its URL so the active links are always visible; the "Add feed"
// affordance stays available no matter how many are already connected.
const adding = ref(false)
const newUrl = ref('')
const newLabel = ref('')
const formError = ref('')
const addInFlight = ref(false)

const showRemoveConfirm = ref(false)
const feedPendingRemoval = ref(null)

// Ref to the inline add-feed panel so we can focus the URL field the moment it
// expands open.
const formRef = ref(null)

onMounted(async () => {
  if (authStore.user) await feedsStore.fetchFeeds()
})

/** Human "14 min ago" style stamp for the status line; null when never synced. */
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

/** Row title: the user's label, else the feed host so rows stay distinguishable. */
function feedDisplayName(feed) {
  if (feed.label) return feed.label
  try {
    return new URL(feed.url).hostname.replace(/^www\./, '')
  } catch {
    return 'Calendar feed'
  }
}

/** Muted status line under the URL. */
function feedStatus(feed) {
  if (feed.last_sync_status === 'error') {
    return feed.last_sync_error || 'Last sync failed - click Retry'
  }
  const rel = relativeTime(feed.last_synced_at)
  if (!rel) return 'Not synced yet'
  return `Last synced ${rel}`
}

function openForm() {
  formError.value = ''
  adding.value = true
  // Focus the URL field once the panel has expanded into the DOM.
  nextTick(() => {
    formRef.value?.querySelector('input')?.focus()
  })
}

function cancelForm() {
  adding.value = false
  newUrl.value = ''
  newLabel.value = ''
  formError.value = ''
}

// ── Add-feed panel open/close animation ──────────────────────────────────────
// Driven in JS via the Web Animations API rather than CSS. Animating layout
// properties like grid-template-rows / max-height can't be GPU-accelerated and
// visibly janks; instead we clip-reveal the container with a height animation
// while the card itself fades and slides in on transform + opacity, which the
// compositor handles smoothly. The two run over the same window so it reads as
// one fluid motion.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)' // easeOutExpo — graceful settle
const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)' // smooth both ends for collapse

function onFormEnter(el, done) {
  const content = el.firstElementChild
  const target = content.offsetHeight
  if (prefersReducedMotion) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 }).onfinish = () => done()
    return
  }
  // Set the collapsed state inline first so the very first painted frame is at
  // height 0 (no flash of the full panel before the animation takes over).
  el.style.height = '0px'
  el.style.overflow = 'hidden'
  const heightAnim = el.animate([{ height: '0px' }, { height: `${target}px` }], {
    duration: 440,
    easing: EASE_OUT,
  })
  content.animate(
    [
      { opacity: 0, transform: 'translateY(-10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 440, easing: EASE_OUT }
  )
  el._anim = heightAnim
  heightAnim.onfinish = () => {
    el.style.height = ''
    el.style.overflow = ''
    el._anim = null
    done()
  }
}

function onFormLeave(el, done) {
  const content = el.firstElementChild
  // Measure the live rendered height so an interrupted open collapses from where
  // it currently is instead of snapping to full height first.
  const start = el.getBoundingClientRect().height || content.offsetHeight
  if (prefersReducedMotion) {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100 }).onfinish = () => done()
    return
  }
  el.style.overflow = 'hidden'
  const heightAnim = el.animate([{ height: `${start}px` }, { height: '0px' }], {
    duration: 300,
    easing: EASE_IN_OUT,
  })
  content.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-6px)' },
    ],
    { duration: 240, easing: EASE_IN_OUT }
  )
  el._anim = heightAnim
  heightAnim.onfinish = () => {
    el._anim = null
    done()
  }
}

// Rapid open/close can interrupt a transition mid-flight; stop the in-flight
// animation so the opposite direction takes over cleanly.
function onFormAnimCancel(el) {
  el._anim?.cancel()
  el._anim = null
  el.style.overflow = ''
  el.style.height = ''
}

async function handleAdd() {
  formError.value = ''
  const url = newUrl.value.trim()
  const label = newLabel.value.trim()
  if (!url) {
    formError.value = 'Paste an ICS calendar URL.'
    return
  }
  addInFlight.value = true
  try {
    const created = await feedsStore.addFeed(url, label || null)
    cancelForm()
    // Sync just the feed we added so the user sees its assignments immediately,
    // without re-fetching feeds that are already up to date.
    if (created?.id) await feedsStore.syncOne(created.id)
    else await feedsStore.syncAll()
  } catch (e) {
    adding.value = true
    formError.value = e?.message || 'Could not add feed.'
  } finally {
    addInFlight.value = false
  }
}

async function handleResync(feed) {
  // Guard only this feed — a different row can still be synced independently.
  if (feedsStore.isSyncing(feed.id)) return
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
  <!-- Connected feeds. Each row shows the feed's active URL so users always know
       exactly which links are subscribed. -->
  <div
    v-for="feed in feedsStore.feeds"
    :key="feed.id"
    class="group flex items-center gap-3.5 py-4 border-t border-paper-line dark:border-gray-700/50"
  >
    <!-- Icon tile -->
    <div
      class="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg leading-none select-none bg-surface/70 dark:bg-gray-800/70 border border-paper-line dark:border-gray-700/60"
      aria-hidden="true"
    >
      🎓
    </div>

    <!-- Name + active URL + status -->
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug">
        {{ feedDisplayName(feed) }}
      </p>
      <p
        class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5"
        :title="feed.url"
      >
        {{ feed.url }}
      </p>
      <p
        class="text-[11px] truncate mt-0.5"
        :class="feed.last_sync_status === 'error' ? 'text-danger-600 dark:text-danger-400' : 'text-gray-400 dark:text-gray-500'"
      >
        {{ feedStatus(feed) }}
      </p>
    </div>

    <!-- Actions -->
    <div class="shrink-0 flex items-center gap-1.5">
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
        :disabled="feedsStore.isSyncing(feed.id)"
        :title="feed.last_sync_status === 'error' ? 'Retry sync' : 'Sync now'"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed"
        :class="feed.last_sync_status === 'error'
          ? 'bg-danger-100 text-danger-700 hover:bg-danger-200 dark:bg-danger-900/40 dark:text-danger-300 dark:hover:bg-danger-900/60 focus-visible:ring-danger-500/30'
          : 'bg-primary-100/70 text-primary-800 hover:bg-primary-200/80 dark:bg-primary-900/40 dark:text-primary-300 dark:hover:bg-primary-900/60 focus-visible:ring-primary-500/30'"
        @click="handleResync(feed)"
      >
        <svg v-if="feedsStore.isSyncing(feed.id)" class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" />
        </svg>
        {{ feedsStore.isSyncing(feed.id) ? 'Syncing…' : (feed.last_sync_status === 'error' ? 'Retry' : 'Connected') }}
      </button>
    </div>
  </div>

  <!-- No feed yet → the "Connect" onboarding affordance. -->
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
        class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors border-gray-300 text-gray-700 hover:bg-surface/70 hover:border-gray-400 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/30"
        @click="openForm"
      >
        Connect <span aria-hidden="true">→</span>
      </button>
    </template>
  </IntegrationRow>

  <!-- Already have feeds → an always-available "add another" affordance. The whole
       row is the click target (not a peer integration with its own button), with a
       dashed "add" tile and muted action-weight text, so it reads as part of the
       list flow rather than another connected source. -->
  <button
    v-if="feedsStore.feeds.length > 0 && !adding"
    type="button"
    class="group/add w-full flex items-center gap-3.5 py-4 text-left border-t border-paper-line dark:border-gray-700/50 rounded-b-lg transition-colors hover:bg-surface/50 dark:hover:bg-gray-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/30"
    @click="openForm"
  >
    <!-- Dashed "add slot" tile -->
    <div
      class="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 transition-colors group-hover/add:border-gray-400 group-hover/add:text-gray-600 dark:group-hover/add:border-gray-500 dark:group-hover/add:text-gray-300"
      aria-hidden="true"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>

    <!-- Muted, action-weight label -->
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-gray-600 dark:text-gray-300 group-hover/add:text-gray-900 dark:group-hover/add:text-gray-100 transition-colors leading-snug">
        Add another feed
      </p>
      <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
        Subscribe to another calendar (ICS) URL
      </p>
    </div>

    <!-- Quiet directional affordance, aligned with the action column above -->
    <span
      aria-hidden="true"
      class="shrink-0 pr-1 text-gray-300 dark:text-gray-600 group-hover/add:text-gray-500 dark:group-hover/add:text-gray-400 transition-colors"
    >→</span>
  </button>

  <!-- Inline add-feed panel (used when adding the first or any feed). The open/
       close is driven in JS (see onFormEnter/onFormLeave) so it glides smoothly:
       the container clip-reveals via height while the card fades + slides in on
       compositor-accelerated transform/opacity. -->
  <Transition
    :css="false"
    @enter="onFormEnter"
    @leave="onFormLeave"
    @enter-cancelled="onFormAnimCancel"
    @leave-cancelled="onFormAnimCancel"
  >
    <div v-if="adding" ref="formRef">
      <div class="feed-form-content pt-2 pb-1">
        <div class="rounded-xl border border-paper-line dark:border-gray-700/60 bg-surface/40 dark:bg-gray-800/30 p-4">
          <!-- Panel header: echoes the dashed "add" tile so the row appears to open up -->
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
              aria-hidden="true"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Add a calendar feed</p>
              <p class="text-[11px] font-mono text-gray-400 dark:text-gray-500 mt-0.5">Paste an ICS or webcal link</p>
            </div>
          </div>

          <form class="space-y-3.5" @submit.prevent="handleAdd" @keydown.esc="cancelForm">
            <Input
              v-model="newUrl"
              type="url"
              label="Feed URL"
              placeholder="https://canvas.instructure.com/feeds/calendars/user_xxx.ics"
              :error="formError"
            />
            <Input
              v-model="newLabel"
              type="text"
              label="Name (optional)"
              placeholder="e.g. Canvas, Blackboard"
            />
            <div class="flex items-center gap-2 pt-0.5">
              <Button type="submit" size="sm" :loading="addInFlight">Add feed</Button>
              <Button type="button" size="sm" variant="ghost" :disabled="addInFlight" @click="cancelForm">Cancel</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </Transition>

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

<style scoped>
/* The panel's content wrapper glides on transform during the reveal; hint the
   compositor so it stays smooth. Height/overflow are handled inline by the JS
   hooks (onFormEnter/onFormLeave). */
.feed-form-content {
  will-change: transform, opacity;
}
</style>
