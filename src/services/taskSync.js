import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'

/**
 * Upsert a task to Supabase. Returns the Supabase row id or null on failure.
 * Resolves Supabase FK ids for assignment_id and course_id from local Pinia state.
 */
export async function persistTaskToSupabase(task) {
  if (!isSupabaseConfigured || !supabase) return null

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  let supabaseAssignmentId = null
  let supabaseCourseId = null

  if (task.assignmentId) {
    const assignment = useAssignmentsStore().getAssignmentById(task.assignmentId)
    supabaseAssignmentId = assignment?.supabaseAssignmentId || null
  }

  if (task.courseId) {
    const course = useCoursesStore().getCourseById(task.courseId)
    supabaseCourseId = course?.supabaseCourseId || null
  }

  const row = {
    user_id: user.id,
    assignment_id: supabaseAssignmentId,
    course_id: supabaseCourseId,
    title: (task.title && String(task.title).trim()) || 'Untitled task',
    scheduled_date: task.scheduledDate,
    priority: task.priority ?? 0,
    completed: task.completed ?? false,
    updated_at: new Date().toISOString(),
  }

  try {
    if (task.supabaseTaskId) {
      const { data, error } = await supabase
        .from('tasks')
        .update(row)
        .eq('id', task.supabaseTaskId)
        .eq('user_id', user.id)
        .select('id')
        .single()
      if (error) throw error
      return data.id
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert(row)
      .select('id')
      .single()
    if (error) throw error
    return data.id
  } catch (e) {
    console.warn('[taskSync] persistTaskToSupabase', e.message || e)
    return null
  }
}

/** Hard-delete a task row from Supabase. */
export async function deleteTaskFromSupabase(supabaseTaskId) {
  if (!isSupabaseConfigured || !supabase || !supabaseTaskId) return

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return

  try {
    await supabase
      .from('tasks')
      .delete()
      .eq('id', supabaseTaskId)
      .eq('user_id', user.id)
  } catch (e) {
    console.warn('[taskSync] deleteTaskFromSupabase', e.message || e)
  }
}
