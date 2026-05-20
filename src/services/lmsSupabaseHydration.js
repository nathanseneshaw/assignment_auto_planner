/**
 * Read-side counterpart to `lmsSupabaseSync.js`.
 *
 * On demand (e.g. after sign-in or after an ICS sync), pull the user's
 * courses + assignments from Supabase and **fully replace** the local Pinia
 * state with the result. This is intentionally not merged — Supabase is the
 * source of truth here, and any local-only edits would have been pushed up
 * by the background sync first.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useCoursesStore } from '../stores/courses'
import { useAssignmentsStore } from '../stores/assignments'

/** Color palette assigned round-robin so hydration is deterministic per-position. */
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
 * Convert a Supabase `due_at` timestamp into the `YYYY-MM-DD` string the UI
 * uses everywhere. Bad/missing input falls back to today so the calendar
 * grid doesn't crash on a malformed row.
 */
function dueDateFromDb(dueAt) {
  if (!dueAt) return new Date().toISOString().split('T')[0]
  const d = new Date(dueAt)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split('T')[0]
  return d.toISOString().split('T')[0]
}

/**
 * Map a Supabase `courses` row → the shape `useCoursesStore` expects.
 * `index` is the row position used to pick a color, so reordering the source
 * query would shuffle colors (acceptable trade-off for determinism).
 */
function mapCourseRow(row, index) {
  const id = row.id
  const source = row.source || 'manual'
  const external = row.external_course_id != null ? String(row.external_course_id).trim() : ''

  const course = {
    id,
    supabaseCourseId: id,
    createdAt: row.created_at || new Date().toISOString(),
    color: courseColors[index % courseColors.length],
    name: row.course_name || 'Untitled course',
    instructor: row.professor_name || '',
    lmsSource: source,
    code: row.code != null ? String(row.code) : '',
    term: row.term != null ? String(row.term) : '',
  }

  // Surface the external id under the LMS-specific field the rest of the app reads.
  if (source === 'canvas' && external) {
    course.canvasCourseId = external
  } else if (source === 'blackboard' && external) {
    course.blackboardId = external
  }

  return course
}

/**
 * Map a Supabase `assignments` row → the shape `useAssignmentsStore` expects.
 * Defaults `status='pending'`, no subtasks, 0% progress — local task state is
 * not stored server-side yet, so hydration always starts these fresh.
 */
function mapAssignmentRow(row, course) {
  const id = row.id
  const ext = row.external_assignment_id != null ? String(row.external_assignment_id).trim() : ''
  const src = row.import_source

  const base = {
    id,
    supabaseAssignmentId: id,
    createdAt: row.created_at || new Date().toISOString(),
    status: 'pending',
    tasks: [],
    progress: 0,
    courseId: row.course_id,
    courseName: course?.name || 'Unknown course',
    title: row.assignment_name || 'Untitled',
    dueDate: dueDateFromDb(row.due_at),
    description: row.description != null ? String(row.description) : '',
    importSource: src || null,
  }

  // Like courses: route the external id into the LMS-specific field for the
  // two LMSes that still have UI affordances tied to it.
  if (src === 'canvas' && ext) {
    return { ...base, canvasAssignmentId: ext }
  }
  if (src === 'blackboard' && ext) {
    return { ...base, blackboardId: ext }
  }
  return base
}

/**
 * Replace courses and assignments in Pinia from the signed-in user's Supabase rows.
 *
 * No-ops when Supabase is unconfigured or the user is signed out — callers
 * can safely invoke this on every navigation or after every sync without
 * guarding themselves.
 */
export async function hydrateLmsStoresFromSupabase() {
  if (!isSupabaseConfigured || !supabase) return

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return

  const coursesStore = useCoursesStore()
  const assignmentsStore = useAssignmentsStore()

  // Pull both tables in series — assignments need the courses lookup table for `courseName`.
  const { data: courseRows, error: cErr } = await supabase
    .from('courses')
    .select('*')
    .eq('user_id', user.id)
    .order('course_name', { ascending: true })

  if (cErr) {
    console.warn('[lmsSupabaseHydration] courses', cErr.message || cErr)
    return
  }

  const { data: assignmentRows, error: aErr } = await supabase
    .from('assignments')
    .select('*')
    .eq('user_id', user.id)
    .order('due_at', { ascending: true })

  if (aErr) {
    console.warn('[lmsSupabaseHydration] assignments', aErr.message || aErr)
    return
  }

  const courses = (courseRows || []).map((row, i) => mapCourseRow(row, i))
  // O(1) lookup so we can stitch course names onto assignments cheaply.
  const courseById = Object.fromEntries(courses.map((c) => [c.id, c]))

  const assignments = (assignmentRows || []).map((row) =>
    mapAssignmentRow(row, courseById[row.course_id])
  )

  coursesStore.replaceFromHydration(courses)
  assignmentsStore.replaceFromHydration(assignments)
}
