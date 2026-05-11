/**
 * Debounced one-way mirror: Pinia (courses + assignments) → Supabase (upsert).
 *
 * Mounted once at the app root. Watches both stores deeply and, after a quiet
 * window (`DEBOUNCE_MS`), upserts every row to Supabase. The reverse direction
 * (Supabase → Pinia) is handled by `lmsSupabaseHydration`.
 *
 * Important caveats:
 * - **Deletes are not propagated.** Removing a course or assignment locally
 *   leaves the Supabase row intact (intentional — protects against accidental
 *   wipes; cleanup happens separately).
 * - `suppressWatch` is flipped while we patch local rows with the returned
 *   Supabase IDs so the resulting deep-watch trigger does not recurse into a
 *   second flush.
 * - `isFlushing` + `pendingDuringFlush` serialize flushes: if the stores
 *   mutate while a flush is mid-flight, we schedule exactly one more flush
 *   afterwards rather than running them concurrently.
 */
import { watch, onMounted, onUnmounted } from 'vue'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  persistCourseToSupabase,
  persistAssignmentToSupabase,
} from '../services/lmsSupabaseSync'

/** Quiet window before flushing. Coalesces bursts of edits into one round-trip. */
const DEBOUNCE_MS = 1200

export function useSupabaseStoreSync() {
  const coursesStore = useCoursesStore()
  const assignmentsStore = useAssignmentsStore()
  const authStore = useAuthStore()

  let debounceTimer = null
  // Set true while we write Supabase IDs back into local rows, so the watcher
  // does not treat that internal patch as a new edit and trigger another flush.
  let suppressWatch = false
  // Lock that prevents two flushes from running concurrently.
  let isFlushing = false
  // If a store change arrives while a flush is in progress, remember it so we
  // can fire exactly one follow-up flush when the current one ends.
  let pendingDuringFlush = false
  /** @type {import('vue').WatchStopHandle[]} */
  const stopWatchers = []

  /** Reset the debounce window; the actual flush runs after the timer fires. */
  function scheduleFlush() {
    if (!isSupabaseConfigured) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void flushToSupabase()
    }, DEBOUNCE_MS)
  }

  /**
   * Walk the local stores and upsert every row into Supabase. Persists in two
   * passes (courses first, then assignments) because assignment rows reference
   * the parent course's Supabase UUID.
   */
  async function flushToSupabase() {
    if (!isSupabaseConfigured || !supabase) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    if (isFlushing) {
      pendingDuringFlush = true
      return
    }
    isFlushing = true
    pendingDuringFlush = false

    suppressWatch = true
    try {
      // Pass 1 — courses. Patch each local row with its Supabase UUID so
      // future updates can target it without another lookup.
      const courses = [...coursesStore.courses]
      for (const course of courses) {
        const rid = await persistCourseToSupabase({ ...course })
        if (rid) {
          const idx = coursesStore.courses.findIndex((c) => c.id === course.id)
          if (idx !== -1 && !coursesStore.courses[idx].supabaseCourseId) {
            coursesStore.courses[idx] = {
              ...coursesStore.courses[idx],
              supabaseCourseId: rid,
            }
          }
        }
      }

      // Pass 2 — assignments. `ensureSupabaseCourseRow` resolves the parent
      // FK; rows whose parent has no Supabase row yet are skipped this round.
      const assignments = [...assignmentsStore.assignments]
      for (const a of assignments) {
        const cid = await coursesStore.ensureSupabaseCourseRow(a.courseId)
        if (!cid) continue
        const aid = await persistAssignmentToSupabase({ ...a }, cid)
        if (aid) {
          const idx = assignmentsStore.assignments.findIndex((x) => x.id === a.id)
          if (idx !== -1 && !assignmentsStore.assignments[idx].supabaseAssignmentId) {
            assignmentsStore.assignments[idx] = {
              ...assignmentsStore.assignments[idx],
              supabaseAssignmentId: aid,
            }
          }
        }
      }
    } finally {
      suppressWatch = false
      isFlushing = false
      // If something changed mid-flush, queue one more pass so we don't lose it.
      if (pendingDuringFlush) {
        pendingDuringFlush = false
        scheduleFlush()
      }
    }
  }

  onMounted(() => {
    if (!isSupabaseConfigured) return

    // Watch courses deeply: any property change on any row debounces a flush.
    stopWatchers.push(
      watch(
        () => coursesStore.courses,
        () => {
          if (suppressWatch) return
          if (!authStore.user) return
          scheduleFlush()
        },
        { deep: true }
      )
    )

    // Same for assignments.
    stopWatchers.push(
      watch(
        () => assignmentsStore.assignments,
        () => {
          if (suppressWatch) return
          if (!authStore.user) return
          scheduleFlush()
        },
        { deep: true }
      )
    )

    // When a user signs in, push whatever is locally cached up to their account.
    stopWatchers.push(
      watch(
        () => authStore.user,
        (u) => {
          if (u) scheduleFlush()
        }
      )
    )

    // If the app starts already authenticated, flush any pre-existing local edits.
    if (authStore.user) {
      scheduleFlush()
    }
  })

  onUnmounted(() => {
    clearTimeout(debounceTimer)
    debounceTimer = null
    while (stopWatchers.length) {
      const s = stopWatchers.pop()
      s?.()
    }
  })
}
