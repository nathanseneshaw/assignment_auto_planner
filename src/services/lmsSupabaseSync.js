/**
 * Client-side persistence helpers: write a single course or assignment to
 * Supabase from the browser. Used by the Pinia stores after local mutations.
 *
 * Dedupe strategy:
 *   - **Courses**: prefer the cached `supabaseCourseId`. Otherwise match on
 *     `(user_id, source, external_course_id)` (e.g. same Canvas course id).
 *     Falls through to a plain insert.
 *   - **Assignments**: prefer `supabaseAssignmentId`. Otherwise match on
 *     `(user_id, course_id, assignment_name, due_at)` so re-syncs don't create
 *     duplicates when the user lacks a stable external id.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/**
 * Map local Pinia course → LMS source for public.courses.source.
 * Falls back to inferring from the external id fields when `lmsSource` is missing
 * (legacy rows from before the explicit field was added).
 */
export function resolveCourseLmsSource(course) {
  if (course.lmsSource && ['canvas', 'blackboard', 'manual'].includes(course.lmsSource)) {
    return course.lmsSource
  }
  if (course.canvasCourseId) return 'canvas'
  if (course.blackboardId) return 'blackboard'
  return 'manual'
}

/**
 * Pick the appropriate external id (Canvas wins over Blackboard when both are
 * present, which shouldn't normally happen but matters during platform switches).
 */
function externalCourseId(course) {
  if (course.canvasCourseId != null && String(course.canvasCourseId).trim() !== '') {
    return String(course.canvasCourseId).trim()
  }
  if (course.blackboardId != null && String(course.blackboardId).trim() !== '') {
    return String(course.blackboardId).trim()
  }
  return null
}

/** Stable LMS assignment id for Supabase dedupe (unique per user). */
export function resolveExternalAssignmentId(assignment) {
  if (assignment.canvasAssignmentId != null && String(assignment.canvasAssignmentId).trim() !== '') {
    return String(assignment.canvasAssignmentId).trim()
  }
  if (assignment.blackboardId != null && String(assignment.blackboardId).trim() !== '') {
    return String(assignment.blackboardId).trim()
  }
  return null
}

/** Same fall-through pattern as {@link resolveCourseLmsSource} but for assignments. */
export function resolveImportSource(assignment) {
  const s = assignment.importSource
  if (s === 'canvas' || s === 'blackboard') return s
  if (assignment.canvasAssignmentId) return 'canvas'
  if (assignment.blackboardId) return 'blackboard'
  return null
}

/**
 * Coerce any accepted date input (ISO string, Date, epoch ms) into an ISO
 * string. Falls back to "now" on garbage input so Supabase NOT NULL still
 * succeeds  the user can fix the date later.
 */
function normalizeDueAt(due) {
  if (!due) return new Date().toISOString()
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

/**
 * Upsert a course row for the signed-in user. Returns Supabase course UUID or null.
 *
 * Tries three paths in order:
 *   1. **Known id**  update by `supabaseCourseId` (fast path on subsequent syncs).
 *   2. **External match**  look up `(source, external_course_id)` and update if found.
 *   3. **Fresh insert**  no match anywhere; create a new row.
 * Errors are swallowed and logged; the caller treats `null` as "try again later".
 */
export async function persistCourseToSupabase(course) {
  if (!isSupabaseConfigured || !supabase) return null

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const source = resolveCourseLmsSource(course)
  const external_course_id = externalCourseId(course)

  // Full row used only for inserts. Updates use the narrower `courseUpdatePayload`
  // so we never overwrite immutable columns like `user_id` or `source`.
  const row = {
    user_id: user.id,
    source,
    course_name: (course.name && String(course.name).trim()) || 'Untitled course',
    professor_name: course.instructor ? String(course.instructor).trim() : null,
    external_course_id,
    updated_at: new Date().toISOString(),
  }

  const courseUpdatePayload = {
    course_name: row.course_name,
    professor_name: row.professor_name,
    updated_at: row.updated_at,
  }

  try {
    // Fast path: we already know the Supabase row id.
    if (course.supabaseCourseId) {
      const { data, error } = await supabase
        .from('courses')
        .update(courseUpdatePayload)
        .eq('id', course.supabaseCourseId)
        .eq('user_id', user.id)
        .select('id')
        .single()
      if (error) throw error
      return data.id
    }

    // Match by external LMS id so re-imports of the same course update rather than duplicate.
    if (external_course_id) {
      const { data: existing, error: selErr } = await supabase
        .from('courses')
        .select('id')
        .eq('user_id', user.id)
        .eq('source', source)
        .eq('external_course_id', external_course_id)
        .maybeSingle()

      if (selErr) throw selErr

      if (existing?.id) {
        const { data, error } = await supabase
          .from('courses')
          .update(courseUpdatePayload)
          .eq('id', existing.id)
          .select('id')
          .single()
        if (error) throw error
        return data.id
      }
    }

    // No match  insert a fresh row.
    const { data, error } = await supabase
      .from('courses')
      .insert(row)
      .select('id')
      .single()

    if (error) throw error
    return data.id
  } catch (e) {
    console.warn('[lmsSupabaseSync] persistCourseToSupabase', e.message || e)
    return null
  }
}

/**
 * Insert or update assignment linked to public.courses.id (Supabase UUID).
 * Dedupes by external_assignment_id (Canvas / Blackboard) when present, else by course + title + due_at.
 *
 * Mirrors the three-path pattern from {@link persistCourseToSupabase}. The
 * "title + due_at" fallback dedupes manually-entered rows that have no stable
 * external id  accept the small risk of two genuinely-identical assignments
 * collapsing in exchange for not duplicating on re-sync.
 */
export async function persistAssignmentToSupabase(assignment, supabaseCourseId) {
  if (!isSupabaseConfigured || !supabase || !supabaseCourseId) return null

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const nowIso = new Date().toISOString()
  const row = {
    user_id: user.id,
    course_id: supabaseCourseId,
    assignment_name: (assignment.title && String(assignment.title).trim()) || 'Untitled',
    due_at: normalizeDueAt(assignment.dueAt || assignment.dueDate),
    description: assignment.description != null ? String(assignment.description) : null,
    updated_at: nowIso,
  }

  const assignmentUpdatePayload = {
    course_id: row.course_id,
    assignment_name: row.assignment_name,
    due_at: row.due_at,
    description: row.description,
    updated_at: row.updated_at,
  }

  try {
    // Fast path  already mapped to a Supabase row.
    if (assignment.supabaseAssignmentId) {
      const { data, error } = await supabase
        .from('assignments')
        .update(assignmentUpdatePayload)
        .eq('id', assignment.supabaseAssignmentId)
        .eq('user_id', user.id)
        .select('id')
        .single()
      if (error) throw error
      return data.id
    }

    // Dedupe key for assignments without an external id: same course + same
    // title + same due date implies the same logical assignment.
    const { data: existing, error: selErr } = await supabase
      .from('assignments')
      .select('id')
      .eq('user_id', user.id)
      .eq('course_id', supabaseCourseId)
      .eq('assignment_name', row.assignment_name)
      .eq('due_at', row.due_at)
      .maybeSingle()

    if (selErr) throw selErr

    if (existing?.id) {
      const { data, error } = await supabase
        .from('assignments')
        .update(assignmentUpdatePayload)
        .eq('id', existing.id)
        .select('id')
        .single()
      if (error) throw error
      return data.id
    }

    // No match  insert.
    const { data, error } = await supabase.from('assignments').insert(row).select('id').single()
    if (error) throw error
    return data.id
  } catch (e) {
    console.warn('[lmsSupabaseSync] persistAssignmentToSupabase', e.message || e)
    return null
  }
}
