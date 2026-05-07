import { watch, onMounted, onUnmounted } from 'vue'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'
import { useAuthStore } from '../stores/auth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  persistCourseToSupabase,
  persistAssignmentToSupabase,
} from '../services/lmsSupabaseSync'

/** Debounced push of Pinia courses + assignments → Supabase (upsert). Local deletes are not removed from the DB. */
const DEBOUNCE_MS = 1200

export function useSupabaseStoreSync() {
  const coursesStore = useCoursesStore()
  const assignmentsStore = useAssignmentsStore()
  const authStore = useAuthStore()

  let debounceTimer = null
  let suppressWatch = false
  let isFlushing = false
  let pendingDuringFlush = false
  /** @type {import('vue').WatchStopHandle[]} */
  const stopWatchers = []

  function scheduleFlush() {
    if (!isSupabaseConfigured) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void flushToSupabase()
    }, DEBOUNCE_MS)
  }

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
      if (pendingDuringFlush) {
        pendingDuringFlush = false
        scheduleFlush()
      }
    }
  }

  onMounted(() => {
    if (!isSupabaseConfigured) return

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

    stopWatchers.push(
      watch(
        () => authStore.user,
        (u) => {
          if (u) scheduleFlush()
        }
      )
    )

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
