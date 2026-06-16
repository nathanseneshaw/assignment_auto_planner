import { onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useTasksStore } from '../stores/tasks'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import {
  hydrateLmsStoresFromSupabase,
  assignmentDbRowMatchesLocal,
  courseDbRowMatchesLocal,
} from '../services/lmsSupabaseHydration'
import { beginRemoteApply, endRemoteApply } from '../services/syncCoordinator'

/**
 * Live cross-instance sync via Supabase Realtime.
 *
 * Problem this solves: with two app instances open (e.g. desktop + web), an edit
 * on one — completing a task, editing an assignment, importing a course — only
 * showed up on the other after a full restart, because Supabase→Pinia hydration
 * previously ran only on boot, sign-in, and ICS sync.
 *
 * Mount once in App.vue. While signed in, we subscribe to Postgres change events
 * on the user's `courses`, `assignments`, and `tasks` rows. Any event debounces a
 * single re-hydration from Supabase, so a burst of changes (an ICS import writing
 * many rows) collapses into one refresh. The hydration is bracketed with the sync
 * coordinator so the resulting store mutation does not echo back as a new upsert
 * (see syncCoordinator.js).
 *
 * Requirements (one-time, see supabase/migrations/*_enable_realtime_sync.sql):
 *   - the three tables must be members of the `supabase_realtime` publication;
 *   - they need `replica identity full` so UPDATE/DELETE events still carry the
 *     `user_id` the row filter (and RLS) match against.
 *
 * Safe to call when Supabase is not configured (no-ops).
 */

/** Quiet window before re-hydrating; coalesces a burst of row events into one pull. */
const DEBOUNCE_MS = 400

/** Tables whose per-user rows we mirror into Pinia. */
const TABLES = ['courses', 'assignments', 'tasks']

export function useSupabaseRealtimeSync() {
  if (!isSupabaseConfigured || !supabase) return

  const authStore = useAuthStore()
  const tasksStore = useTasksStore()
  const coursesStore = useCoursesStore()
  const assignmentsStore = useAssignmentsStore()

  /** @type {import('@supabase/supabase-js').RealtimeChannel | null} */
  let channel = null
  let debounceTimer = null
  let stopWatchUser = null
  // Guards against two hydrations overlapping; if an event lands mid-apply we
  // remember it and run exactly one more pass afterwards.
  let applying = false
  let pendingWhileApplying = false

  function scheduleHydrate() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void applyRemoteChange()
    }, DEBOUNCE_MS)
  }

  async function applyRemoteChange() {
    if (!authStore.user) return
    if (applying) {
      pendingWhileApplying = true
      return
    }
    applying = true
    pendingWhileApplying = false

    beginRemoteApply()
    try {
      await hydrateLmsStoresFromSupabase()
      // Let the store-sync deep watchers run (and bail, because a remote apply
      // is in progress) before we clear the suppression flag. Vue flushes those
      // watchers within the nextTick window, so this reliably covers them.
      await nextTick()
    } catch (e) {
      console.warn('[realtime-sync]', e?.message || e)
    } finally {
      endRemoteApply()
      applying = false
      if (pendingWhileApplying) {
        pendingWhileApplying = false
        scheduleHydrate()
      }
    }
  }

  /**
   * Task deletes need special handling: the hydration merge deliberately keeps
   * local tasks that are absent from a fresh snapshot (to protect in-flight
   * creates), which would otherwise resurrect a task another instance deleted.
   * The DELETE payload carries the old row id (thanks to replica identity full),
   * so we drop it locally first, then let the debounced hydrate reconcile the rest.
   */
  function handleTaskDelete(payload) {
    const oldId = payload?.old?.id
    if (oldId) tasksStore.removeLocalTask(oldId)
    scheduleHydrate()
  }

  /**
   * Recognise an INSERT/UPDATE event that is just this instance's own write
   * echoing back: the row's user-visible state already matches the local store,
   * so re-hydrating would be wasted work (and would briefly churn the list).
   * A genuine edit from another instance differs on at least one field, so it
   * falls through to scheduleHydrate() and still propagates live. Rows we don't
   * know yet (e.g. a create from elsewhere) return false so they get pulled in.
   */
  function isLocalEcho(table, payload) {
    const row = payload?.new
    if (!row?.id) return false
    if (table === 'assignments') {
      const local = assignmentsStore.assignments.find(
        (a) => a.supabaseAssignmentId === row.id || a.id === row.id
      )
      return local ? assignmentDbRowMatchesLocal(row, local) : false
    }
    if (table === 'courses') {
      const local = coursesStore.courses.find(
        (c) => c.supabaseCourseId === row.id || c.id === row.id
      )
      return local ? courseDbRowMatchesLocal(row, local) : false
    }
    return false
  }

  async function subscribe() {
    if (channel || !authStore.user) return
    const userId = authStore.user.id

    // Ensure the realtime socket carries the user's JWT so the
    // `user_id=eq.<id>` filters pass RLS for postgres_changes. supabase-js keeps
    // this in sync on token refresh; we set it explicitly for the first subscribe
    // right after a restored session.
    const token = authStore.session?.access_token
    if (token) {
      try {
        await supabase.realtime.setAuth(token)
      } catch {
        // Non-fatal — the client also sets it from the auth listener.
      }
    }

    let ch = supabase.channel(`user-sync:${userId}`)
    for (const table of TABLES) {
      const opts = { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }
      ch = ch.on('postgres_changes', opts, (payload) => {
        if (table === 'tasks' && payload?.eventType === 'DELETE') {
          handleTaskDelete(payload)
          return
        }
        const evt = payload?.eventType
        if ((evt === 'INSERT' || evt === 'UPDATE') && isLocalEcho(table, payload)) {
          // Our own write coming back — nothing new to pull.
          return
        }
        scheduleHydrate()
      })
    }

    channel = ch.subscribe((status) => {
      // SUBSCRIBED is the happy path. CHANNEL_ERROR / TIMED_OUT are retried by the
      // client automatically; surface them only for debugging.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime-sync] channel status:', status, '(will auto-retry)')
      }
    })
  }

  async function unsubscribe() {
    clearTimeout(debounceTimer)
    debounceTimer = null
    if (channel) {
      try {
        await supabase.removeChannel(channel)
      } catch {
        // Ignore — we're tearing down anyway.
      }
      channel = null
    }
  }

  onMounted(() => {
    if (authStore.user) void subscribe()

    // Re-subscribe whenever the signed-in user changes (sign-in / account switch
    // / sign-out). Keyed on id so a mere token refresh — same user — is ignored.
    stopWatchUser = watch(
      () => authStore.user?.id,
      async (id, prev) => {
        if (id === prev) return
        await unsubscribe()
        if (id) void subscribe()
      }
    )
  })

  onUnmounted(() => {
    if (stopWatchUser) stopWatchUser()
    void unsubscribe()
  })
}
