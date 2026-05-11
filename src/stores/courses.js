/**
 * Courses Pinia store.
 *
 * Each course has a local UUID (`id`) used by the UI plus an optional
 * `supabaseCourseId` (server-side UUID) once it has been persisted. LMS-imported
 * rows also carry `canvasCourseId` / `blackboardId` for matching during re-sync.
 *
 * Persistence side-effects: `addCourse` and `updateCourse` fire-and-forget an
 * upsert to Supabase. The deeper background sync (`useSupabaseStoreSync`)
 * additionally debounces flushes for any other mutations.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { persistCourseToSupabase } from '../services/lmsSupabaseSync'

export const useCoursesStore = defineStore('courses', () => {
  const courses = ref([])
  const loading = ref(false)
  const error = ref(null)
  /**
   * local course id → in-flight persist promise.
   * Dedupes concurrent upserts so a burst of mutations on the same row only
   * triggers a single network round-trip.
   */
  const coursePersistPromises = new Map()

  /** Alphabetical view; used by every page that lists courses. */
  const coursesSorted = computed(() => {
    return [...courses.value].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  })

  /**
   * Tailwind class triplets cycled through when adding new courses, so each
   * card gets a distinct accent without the user having to pick one.
   */
  const courseColors = [
    { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
    { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
    { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
    { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
    { bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-300' },
    { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-300' },
    { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-300' },
    { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  ]

  /**
   * Ensure this local course has a row in public.courses (Supabase). Resolves the Supabase UUID or null.
   *
   * Idempotent and re-entrant: parallel callers share the same in-flight
   * promise via {@link coursePersistPromises} so we never double-insert.
   */
  async function ensureSupabaseCourseRow(localCourseId) {
    const initial = getCourseById(localCourseId)
    if (!initial) return null
    if (initial.supabaseCourseId) return initial.supabaseCourseId

    // A concurrent caller is already persisting this row — reuse their promise.
    if (coursePersistPromises.has(localCourseId)) {
      return coursePersistPromises.get(localCourseId)
    }

    const p = (async () => {
      try {
        // Re-read inside the async closure in case the row gained an id while queued.
        const latest = getCourseById(localCourseId)
        if (!latest) return null
        if (latest.supabaseCourseId) return latest.supabaseCourseId
        const rid = await persistCourseToSupabase(latest)
        if (rid) {
          const i = courses.value.findIndex((c) => c.id === localCourseId)
          if (i !== -1 && !courses.value[i].supabaseCourseId) {
            courses.value[i] = { ...courses.value[i], supabaseCourseId: rid }
          }
        }
        return rid
      } finally {
        coursePersistPromises.delete(localCourseId)
      }
    })()

    coursePersistPromises.set(localCourseId, p)
    return p
  }

  /**
   * Insert a new course. Auto-assigns id/timestamp/color and kicks off a
   * background Supabase upsert. The caller's `course` fields override defaults.
   */
  function addCourse(course) {
    const colorIndex = courses.value.length % courseColors.length
    const newCourse = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      color: courseColors[colorIndex],
      ...course
    }
    courses.value.push(newCourse)
    void ensureSupabaseCourseRow(newCourse.id)
    return newCourse
  }

  /**
   * Merge `updates` into an existing course and persist if it is already
   * tracked server-side (`supabaseCourseId`) or has an external LMS id
   * (Canvas/Blackboard) that lets the server upsert it.
   */
  function updateCourse(id, updates) {
    const index = courses.value.findIndex(c => c.id === id)
    if (index !== -1) {
      courses.value[index] = { ...courses.value[index], ...updates }
      const merged = courses.value[index]
      const hasExtId =
        (merged.canvasCourseId != null && String(merged.canvasCourseId).trim() !== '') ||
        (merged.blackboardId != null && String(merged.blackboardId).trim() !== '')
      // Skip persistence for purely-local courses that have never reached Supabase yet —
      // the background sync (useSupabaseStoreSync) will pick them up.
      if (!merged.supabaseCourseId && !hasExtId) return

      void persistCourseToSupabase(merged).then((rid) => {
        if (!rid) return
        const i = courses.value.findIndex(c => c.id === id)
        if (i !== -1 && !courses.value[i].supabaseCourseId) {
          courses.value[i] = { ...courses.value[i], supabaseCourseId: rid }
        }
      })
    }
  }

  /** Local-only delete; the Supabase row is intentionally left in place. */
  function deleteCourse(id) {
    courses.value = courses.value.filter(c => c.id !== id)
  }

  /** Full replace (e.g. Supabase hydration). Clears in-flight persist dedupe. */
  function replaceFromHydration(list) {
    coursePersistPromises.clear()
    courses.value = Array.isArray(list) ? list : []
  }

  function getCourseById(id) {
    return courses.value.find(c => c.id === id)
  }

  return {
    courses,
    loading,
    error,
    coursesSorted,
    addCourse,
    ensureSupabaseCourseRow,
    updateCourse,
    deleteCourse,
    replaceFromHydration,
    getCourseById,
  }
})
