/**
 * Pure, dependency-free helpers for mapping tasks <-> Supabase rows and merging
 * hydration results. Deliberately free of Supabase/Vite imports so the logic
 * can be unit-tested under plain Node (see tests/taskSyncCore.test.mjs).
 */

// Numeric priority <-> label. The task form stores urgent=1, high=2, normal=3
// (lower number sorts first). We persist only the number and derive the label
// on read, so there's no priority_level column to add or keep in sync.
const PRIORITY_LABEL_BY_RANK = { 1: 'urgent', 2: 'high', 3: 'normal' }

export function priorityLevelFromPriority(priority) {
  return PRIORITY_LABEL_BY_RANK[priority] || 'normal'
}

/**
 * Normalize a scheduled-date input to a 'YYYY-MM-DD' string or null.
 * Empty string / blank / nullish -> null, so a Postgres `date` column never
 * receives '' (which it rejects with: invalid input syntax for type date: "").
 * This was the prime cause of "undated" tasks silently failing to persist.
 */
export function normalizeScheduledDate(input) {
  if (input == null) return null
  const s = String(input).trim()
  return s === '' ? null : s
}

/**
 * Build the Supabase `tasks` row for an upsert. Includes the client-generated
 * `id` as the primary key so inserts are idempotent and the local row and its
 * DB row always share one id  which is what kills the duplicate-on-hydration
 * race (a not-yet-confirmed local task dedups against its own DB row by id).
 */
export function buildTaskRow(
  task,
  { userId, supabaseAssignmentId = null, supabaseCourseId = null, now = null } = {},
) {
  return {
    id: task.id,
    user_id: userId,
    assignment_id: supabaseAssignmentId,
    course_id: supabaseCourseId,
    title: (task.title && String(task.title).trim()) || 'Untitled task',
    scheduled_date: normalizeScheduledDate(task.scheduledDate),
    priority: task.priority ?? 0,
    completed: task.completed ?? false,
    group_name: task.group || null,
    updated_at: now || new Date().toISOString(),
  }
}

/**
 * Map a Supabase `tasks` row -> local Pinia task shape. `id` and
 * `supabaseTaskId` are both the DB id; `priorityLevel` is derived from the
 * numeric priority so the badge survives a round-trip without a DB column.
 */
export function mapDbTaskRow(row, { assignment = null, courseName = null } = {}) {
  const priority = row.priority ?? 0
  return {
    id: row.id,
    supabaseTaskId: row.id,
    createdAt: row.created_at || new Date().toISOString(),
    title: row.title || 'Untitled task',
    scheduledDate: row.scheduled_date || '',
    priority,
    priorityLevel: priorityLevelFromPriority(priority),
    completed: row.completed ?? false,
    group: row.group_name || null,
    assignmentId: assignment?.id || row.assignment_id || null,
    courseId: row.course_id || assignment?.courseId || null,
    courseName: assignment?.courseName || courseName || null,
  }
}

/**
 * Merge DB tasks with local tasks, deduping by id.
 *
 * A local task is kept only when neither its `id` nor its `supabaseTaskId`
 * matches any DB row  i.e. it's a create that hasn't landed in this DB
 * snapshot yet (insert in-flight or failed). Two guards:
 *   - `id` match: new tasks are inserted under their own id, so a pending local
 *     copy and its freshly-written DB row share an id and collapse to one
 *     (this is the duplicate-race fix).
 *   - `supabaseTaskId` match: legacy tasks created before explicit-id inserts
 *     have a client id that differs from the DB id; they still dedup via the
 *     stored supabaseTaskId.
 * Failed query (caller passes the existing list as dbTasks=[]) keeps everything.
 */
export function mergeTaskLists(dbTasks, localTasks) {
  const dbIds = new Set((dbTasks || []).map((t) => t.id))
  const pendingLocal = (localTasks || []).filter(
    (t) => !dbIds.has(t.id) && !(t.supabaseTaskId && dbIds.has(t.supabaseTaskId)),
  )
  return [...(dbTasks || []), ...pendingLocal]
}
