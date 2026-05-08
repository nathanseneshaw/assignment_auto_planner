import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { persistCourseToSupabase } from '../services/lmsSupabaseSync'

export const useCoursesStore = defineStore('courses', () => {
  const courses = ref([])
  const loading = ref(false)
  const error = ref(null)
  /** local course id → in-flight persist promise (dedupes concurrent upserts) */
  const coursePersistPromises = new Map()

  const coursesSorted = computed(() => {
    return [...courses.value].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  })

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
   */
  async function ensureSupabaseCourseRow(localCourseId) {
    const initial = getCourseById(localCourseId)
    if (!initial) return null
    if (initial.supabaseCourseId) return initial.supabaseCourseId

    if (coursePersistPromises.has(localCourseId)) {
      return coursePersistPromises.get(localCourseId)
    }

    const p = (async () => {
      try {
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

  function updateCourse(id, updates) {
    const index = courses.value.findIndex(c => c.id === id)
    if (index !== -1) {
      courses.value[index] = { ...courses.value[index], ...updates }
      const merged = courses.value[index]
      const hasExtId =
        (merged.canvasCourseId != null && String(merged.canvasCourseId).trim() !== '') ||
        (merged.blackboardId != null && String(merged.blackboardId).trim() !== '')
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
