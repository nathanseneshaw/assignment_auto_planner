/**
 * Write normalized ICS occurrences into public.courses + public.assignments
 * using the caller's JWT-scoped Supabase client. RLS protects per-user data.
 *
 * Never deletes. Each touched assignment has last_seen_at bumped to now().
 */

function nowIso() {
  return new Date().toISOString()
}

/**
 * Upsert one course row keyed on (user_id, source='ics', external_course_id).
 * Returns the course UUID.
 */
async function upsertCourse(supabase, userId, feedId, courseExternalId, courseName) {
  const { data: existing, error: selErr } = await supabase
    .from('courses')
    .select('id, feed_id')
    .eq('user_id', userId)
    .eq('source', 'ics')
    .eq('external_course_id', courseExternalId)
    .maybeSingle()

  if (selErr) throw new Error(`courses select: ${selErr.message}`)

  if (existing?.id) {
    const patch = { course_name: courseName, updated_at: nowIso() }
    if (!existing.feed_id && feedId) patch.feed_id = feedId
    const { error: updErr } = await supabase
      .from('courses')
      .update(patch)
      .eq('id', existing.id)
      .eq('user_id', userId)
    if (updErr) throw new Error(`courses update: ${updErr.message}`)
    return { id: existing.id, inserted: false }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('courses')
    .insert({
      user_id: userId,
      source: 'ics',
      external_course_id: courseExternalId,
      course_name: courseName,
      feed_id: feedId,
    })
    .select('id')
    .single()

  if (insErr) throw new Error(`courses insert: ${insErr.message}`)
  return { id: inserted.id, inserted: true }
}

/**
 * Upsert one assignment row keyed on (user_id, external_assignment_id).
 * Always sets last_seen_at = now().
 */
async function upsertAssignment(supabase, userId, feedId, courseId, occ) {
  const externalId = occ.uid
  const dueAt = occ.dueAt
  const ts = nowIso()

  const { data: existing, error: selErr } = await supabase
    .from('assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('external_assignment_id', externalId)
    .maybeSingle()

  if (selErr) throw new Error(`assignments select: ${selErr.message}`)

  if (existing?.id) {
    const { error: updErr } = await supabase
      .from('assignments')
      .update({
        course_id: courseId,
        assignment_name: occ.title,
        due_at: dueAt,
        description: occ.description,
        feed_id: feedId,
        source_url: occ.sourceUrl,
        last_seen_at: ts,
        updated_at: ts,
      })
      .eq('id', existing.id)
      .eq('user_id', userId)
    if (updErr) throw new Error(`assignments update: ${updErr.message}`)
    return { id: existing.id, inserted: false }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('assignments')
    .insert({
      user_id: userId,
      course_id: courseId,
      assignment_name: occ.title,
      due_at: dueAt,
      description: occ.description,
      import_source: 'ics',
      external_assignment_id: externalId,
      feed_id: feedId,
      source_url: occ.sourceUrl,
      last_seen_at: ts,
    })
    .select('id')
    .single()

  if (insErr) throw new Error(`assignments insert: ${insErr.message}`)
  return { id: inserted.id, inserted: true }
}

/**
 * Write a batch of normalized occurrences for one feed.
 * Returns counts. Throws on any unrecoverable error; per-row errors are collected.
 */
export async function writeOccurrences({ supabase, userId, feedId, occurrences }) {
  const courseCache = new Map() // courseExternalId → courseUuid
  let coursesInserted = 0
  let coursesUpdated = 0
  let assignmentsInserted = 0
  let assignmentsUpdated = 0
  const errors = []

  for (const occ of occurrences) {
    try {
      let courseUuid = courseCache.get(occ.courseExternalId)
      if (!courseUuid) {
        const { id, inserted } = await upsertCourse(
          supabase,
          userId,
          feedId,
          occ.courseExternalId,
          occ.courseName
        )
        courseUuid = id
        courseCache.set(occ.courseExternalId, id)
        if (inserted) coursesInserted++
        else coursesUpdated++
      }

      const { inserted } = await upsertAssignment(supabase, userId, feedId, courseUuid, occ)
      if (inserted) assignmentsInserted++
      else assignmentsUpdated++
    } catch (e) {
      errors.push({ uid: occ.uid, error: e?.message || String(e) })
    }
  }

  return {
    coursesInserted,
    coursesUpdated,
    assignmentsInserted,
    assignmentsUpdated,
    errors,
  }
}
