import { supabase, isSupabaseConfigured } from '../lib/supabase'

/**
 * Map local Pinia course → LMS source for public.courses.source
 */
export function resolveCourseLmsSource(course) {
  if (course.lmsSource && ['canvas', 'blackboard', 'manual'].includes(course.lmsSource)) {
    return course.lmsSource
  }
  if (course.canvasCourseId) return 'canvas'
  if (course.blackboardId) return 'blackboard'
  return 'manual'
}

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

export function resolveImportSource(assignment) {
  const s = assignment.importSource
  if (s === 'canvas' || s === 'blackboard') return s
  if (assignment.canvasAssignmentId) return 'canvas'
  if (assignment.blackboardId) return 'blackboard'
  return null
}

function normalizeDueAt(due) {
  if (!due) return new Date().toISOString()
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

/**
 * Upsert a course row for the signed-in user. Returns Supabase course UUID or null.
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

    const { data, error } = await supabase.from('assignments').insert(row).select('id').single()
    if (error) throw error
    return data.id
  } catch (e) {
    console.warn('[lmsSupabaseSync] persistAssignmentToSupabase', e.message || e)
    return null
  }
}
