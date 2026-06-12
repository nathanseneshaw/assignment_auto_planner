import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAssignmentsStore } from '../stores/assignments'
import { useCoursesStore } from '../stores/courses'
import { buildTaskRow } from './taskSyncCore'

/**
 * Upsert a task to Supabase, keyed on the task's own `id` (idempotent).
 *
 * Returns a result object so callers can tell apart the three outcomes:
 *   - { status: 'ok', id }       written (insert or update)
 *   - { status: 'skipped' }      no backend / not signed in (local-only mode)
 *   - { status: 'error', error } the write was attempted and failed
 *
 * Resolves Supabase FK ids for assignment_id / course_id from local Pinia state.
 */
export async function persistTaskToSupabase(task) {
  if (!isSupabaseConfigured || !supabase) return { status: 'skipped' }

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return { status: 'skipped' }

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

  const row = buildTaskRow(task, {
    userId: user.id,
    supabaseAssignmentId,
    supabaseCourseId,
  })

  try {
    const { data, error } = await supabase
      .from('tasks')
      .upsert(row, { onConflict: 'id' })
      .select('id')
      .single()
    if (error) throw error
    return { status: 'ok', id: data.id }
  } catch (e) {
    const message = e?.message || String(e)
    // Surface the failing row's date so the classic '' -> date column error is
    // obvious in the console if it ever recurs.
    console.warn(
      '[taskSync] persistTaskToSupabase failed:',
      message,
      '| id:',
      row.id,
      '| scheduled_date:',
      JSON.stringify(row.scheduled_date),
    )
    return { status: 'error', error: message }
  }
}

/** Hard-delete a task row from Supabase by id. */
export async function deleteTaskFromSupabase(taskId) {
  if (!isSupabaseConfigured || !supabase || !taskId) return

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return

  try {
    await supabase.from('tasks').delete().eq('id', taskId).eq('user_id', user.id)
  } catch (e) {
    console.warn('[taskSync] deleteTaskFromSupabase', e.message || e)
  }
}
