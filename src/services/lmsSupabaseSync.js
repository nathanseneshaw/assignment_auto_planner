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

/** ISO string for a completion timestamp, or null when not completed / unparseable. */
function normalizeCompletedAt(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * The durable completion fields (Pillar C). Written on both insert and update so
 * an assignment's completed state survives ICS re-sync and Supabase hydration.
 */
function completionFields(assignment) {
  const progress = Number(assignment.progress)
  return {
    status: assignment.status || 'pending',
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0,
    completed_at: normalizeCompletedAt(assignment.completedAt),
  }
}

// Capability flag for the completion columns added 2026-06-14 (status / progress
// / completed_at). null = not probed yet, true = present, false = absent (older
// schema  strip the fields so saves still succeed). Mirrors the content_hash
// feature-detection in ics-routes.js; tolerates the documented schema drift.
let completionColumnsPresent = null

/** True when a PostgREST error means one of the completion columns doesn't exist. */
function isMissingCompletionColumn(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42703' || code === 'PGRST204') return true
  const msg = error.message || ''
  return /(status|progress|completed_at)/i.test(msg) &&
    /(column|schema cache|does not exist)/i.test(msg)
}

/** Return a shallow copy of `payload` with the completion columns removed. */
function withoutCompletionFields(payload) {
  const clone = { ...payload }
  delete clone.status
  delete clone.progress
  delete clone.completed_at
  return clone
}

/**
 * Run a single-row assignment insert/update, transparently retrying without the
 * completion columns if the live schema predates them. `build(payload)` must
 * return the fully-chained PostgREST query (e.g. `.select('id').single()`).
 */
async function writeAssignmentRow(build, payload) {
  const first = completionColumnsPresent === false ? withoutCompletionFields(payload) : payload
  let res = await build(first)
  if (res.error && completionColumnsPresent !== false && isMissingCompletionColumn(res.error)) {
    completionColumnsPresent = false
    res = await build(withoutCompletionFields(payload))
  } else if (!res.error && completionColumnsPresent === null) {
    completionColumnsPresent = true
  }
  return res
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
// Per-row write serialization. Every write for one assignment runs strictly in
// submission order, so a fast complete→uncheck can't have its two writes land out
// of order and leave Supabase holding the wrong final state (which would then echo
// back over Realtime and revert the checkbox on every open instance). Keyed by the
// stable local id, which all call sites carry (immediate per-edit persist, the
// debounced full-store flush, and the initial insert).
const assignmentWriteChains = new Map()
export function runSerialized(key, task) {
  const prev = assignmentWriteChains.get(key) || Promise.resolve()
  const run = prev.then(() => task())
  // The stored chain never rejects, so one failed write can't wedge the queue.
  const guarded = run.then(() => {}, () => {})
  assignmentWriteChains.set(key, guarded)
  // Drop the entry once the queue drains so the map can't grow without bound.
  guarded.then(() => {
    if (assignmentWriteChains.get(key) === guarded) assignmentWriteChains.delete(key)
  })
  return run
}

export function persistAssignmentToSupabase(assignment, supabaseCourseId) {
  const key = (assignment && (assignment.id || assignment.supabaseAssignmentId)) || 'pending'
  return runSerialized(`assignment:${key}`, () =>
    persistAssignmentRowToSupabase(assignment, supabaseCourseId)
  )
}

async function persistAssignmentRowToSupabase(assignment, supabaseCourseId) {
  if (!isSupabaseConfigured || !supabase || !supabaseCourseId) return null

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const nowIso = new Date().toISOString()
  const completion = completionFields(assignment)
  const row = {
    user_id: user.id,
    course_id: supabaseCourseId,
    assignment_name: (assignment.title && String(assignment.title).trim()) || 'Untitled',
    due_at: normalizeDueAt(assignment.dueAt || assignment.dueDate),
    description: assignment.description != null ? String(assignment.description) : null,
    updated_at: nowIso,
    ...completion,
  }

  const assignmentUpdatePayload = {
    course_id: row.course_id,
    assignment_name: row.assignment_name,
    due_at: row.due_at,
    description: row.description,
    updated_at: row.updated_at,
    ...completion,
  }

  try {
    // Fast path  already mapped to a Supabase row.
    if (assignment.supabaseAssignmentId) {
      const { data, error } = await writeAssignmentRow(
        (payload) =>
          supabase
            .from('assignments')
            .update(payload)
            .eq('id', assignment.supabaseAssignmentId)
            .eq('user_id', user.id)
            .select('id')
            .single(),
        assignmentUpdatePayload
      )
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
      const { data, error } = await writeAssignmentRow(
        (payload) =>
          supabase
            .from('assignments')
            .update(payload)
            .eq('id', existing.id)
            .select('id')
            .single(),
        assignmentUpdatePayload
      )
      if (error) throw error
      return data.id
    }

    // No match  insert.
    const { data, error } = await writeAssignmentRow(
      (payload) => supabase.from('assignments').insert(payload).select('id').single(),
      row
    )
    if (error) throw error
    return data.id
  } catch (e) {
    console.warn('[lmsSupabaseSync] persistAssignmentToSupabase', e.message || e)
    return null
  }
}

/**
 * Hard-delete a course and all its assignments from Supabase. Assignments are
 * deleted first so the operation is safe even if the DB has no CASCADE rule.
 * Silently no-ops when Supabase is unconfigured or the user is signed out.
 */
export async function deleteCourseAndAssignmentsFromSupabase(supabaseCourseId) {
  if (!isSupabaseConfigured || !supabase || !supabaseCourseId) return
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return

  try {
    await supabase
      .from('assignments')
      .delete()
      .eq('course_id', supabaseCourseId)
      .eq('user_id', user.id)
  } catch (e) {
    console.warn('[lmsSupabaseSync] delete assignments for course:', e?.message || e)
  }

  try {
    await supabase
      .from('courses')
      .delete()
      .eq('id', supabaseCourseId)
      .eq('user_id', user.id)
  } catch (e) {
    console.warn('[lmsSupabaseSync] delete course:', e?.message || e)
  }
}
