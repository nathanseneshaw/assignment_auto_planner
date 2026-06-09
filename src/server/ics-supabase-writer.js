/**
 * Write normalized ICS occurrences into public.courses + public.assignments
 * using the caller's JWT-scoped Supabase client. RLS protects per-user data.
 *
 * Never deletes. Each touched assignment has last_seen_at bumped to now().
 *
 * Call-efficiency design (see Supabase request-reduction work):
 * - Reads are **bulked**: one `.in(...)` select per table instead of a
 *   select-per-row (the old N+1).
 * - New rows are **bulk-inserted** in a single round-trip per table, with a
 *   per-row fallback so one bad row can't sink the whole batch (preserves the
 *   old partial-success semantics).
 * - Existing rows are only **updated when a tracked field actually changed**.
 *   Unchanged rows get a single bulk `last_seen_at` touch instead of a write
 *   each, so an unchanged feed costs ~3 round-trips total regardless of size.
 *
 * This deliberately avoids `upsert({ onConflict })` because that requires a
 * matching unique constraint to exist in the live DB; the select+insert/update
 * shape works against whatever schema is deployed.
 */

function nowIso() {
  return new Date().toISOString()
}

/** Normalize nullish text to '' so null-vs-'' doesn't read as a change. */
function normText(v) {
  return v == null ? '' : String(v)
}

/** Compare two timestamps by instant, tolerating formatting differences. */
function sameInstant(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return normText(a) === normText(b)
  return ta === tb
}

/**
 * Resolve every course referenced by `occurrences` to a Supabase UUID,
 * inserting any that don't exist yet. Returns a Map(courseExternalId → uuid)
 * plus insert/update counts. One select + (at most) one insert round-trip.
 */
async function resolveCourses(supabase, userId, feedId, occurrences) {
  const map = new Map() // externalId -> uuid
  let coursesInserted = 0
  let coursesUpdated = 0
  const errors = []

  // De-dupe the courses this feed references (externalId -> name).
  const wanted = new Map()
  for (const occ of occurrences) {
    if (!wanted.has(occ.courseExternalId)) wanted.set(occ.courseExternalId, occ.courseName)
  }
  const externalIds = [...wanted.keys()]
  if (externalIds.length === 0) return { map, coursesInserted, coursesUpdated, errors }

  // Bulk read existing courses for this user/source.
  const { data: existingRows, error: selErr } = await supabase
    .from('courses')
    .select('id, external_course_id, course_name, feed_id')
    .eq('user_id', userId)
    .eq('source', 'ics')
    .in('external_course_id', externalIds)
  if (selErr) throw new Error(`courses select: ${selErr.message}`)

  const existingByExt = new Map()
  for (const row of existingRows || []) {
    existingByExt.set(String(row.external_course_id), row)
    map.set(String(row.external_course_id), row.id)
  }

  // Update existing rows only when the name changed or feed_id needs backfilling.
  for (const [ext, name] of wanted) {
    const row = existingByExt.get(String(ext))
    if (!row) continue
    const nameChanged = normText(row.course_name) !== normText(name)
    const needsFeed = !row.feed_id && feedId
    if (nameChanged || needsFeed) {
      const patch = { updated_at: nowIso() }
      if (nameChanged) patch.course_name = name
      if (needsFeed) patch.feed_id = feedId
      const { error: updErr } = await supabase
        .from('courses')
        .update(patch)
        .eq('id', row.id)
        .eq('user_id', userId)
      if (updErr) errors.push({ uid: `course:${ext}`, error: `courses update: ${updErr.message}` })
      else coursesUpdated++
    }
  }

  // Bulk-insert the courses we didn't find.
  const toInsert = []
  for (const [ext, name] of wanted) {
    if (existingByExt.has(String(ext))) continue
    toInsert.push({
      user_id: userId,
      source: 'ics',
      external_course_id: ext,
      course_name: name,
      feed_id: feedId,
    })
  }
  if (toInsert.length > 0) {
    const inserted = await bulkInsert(
      supabase,
      'courses',
      toInsert,
      'id, external_course_id',
      errors
    )
    for (const row of inserted) {
      map.set(String(row.external_course_id), row.id)
      coursesInserted++
    }
  }

  return { map, coursesInserted, coursesUpdated, errors }
}

/**
 * Insert `rows` into `table` in one round-trip. If the batch insert fails
 * (e.g. a single malformed row), fall back to inserting row-by-row so the
 * good rows still land and per-row errors are collected into `errors`.
 * Returns the inserted rows (with the requested `returning` columns).
 */
async function bulkInsert(supabase, table, rows, returning, errors) {
  if (rows.length === 0) return []
  const { data, error } = await supabase.from(table).insert(rows).select(returning)
  if (!error) return data || []

  // Per-row fallback so one bad row doesn't drop the whole feed.
  const out = []
  for (const row of rows) {
    const { data: one, error: oneErr } = await supabase
      .from(table)
      .insert(row)
      .select(returning)
      .single()
    if (oneErr) {
      errors.push({ uid: row.external_assignment_id || row.external_course_id || 'row', error: `${table} insert: ${oneErr.message}` })
    } else if (one) {
      out.push(one)
    }
  }
  return out
}

/**
 * Write a batch of normalized occurrences for one feed.
 * Returns counts. Throws on an unrecoverable error; per-row errors are collected.
 */
export async function writeOccurrences({ supabase, userId, feedId, occurrences }) {
  let assignmentsInserted = 0
  let assignmentsUpdated = 0
  let assignmentsUnchanged = 0
  const errors = []

  if (!occurrences || occurrences.length === 0) {
    return {
      coursesInserted: 0,
      coursesUpdated: 0,
      assignmentsInserted: 0,
      assignmentsUpdated: 0,
      assignmentsUnchanged: 0,
      errors,
    }
  }

  // 0) Collapse duplicate UIDs within a single feed (last occurrence wins).
  //    The old serial upsert naturally deduped — the 2nd row found the 1st and
  //    updated it. Bulk inserts snapshot the table up front, so without this two
  //    rows sharing an external_assignment_id would both be inserted and trip
  //    the unique index. De-duping first preserves the old last-write-wins shape.
  const dedup = new Map()
  for (const occ of occurrences) dedup.set(String(occ.uid), occ)
  const uniqueOccurrences = [...dedup.values()]

  // 1) Resolve all courses (one select + at most one insert).
  const { map: courseMap, coursesInserted, coursesUpdated, errors: courseErrors } =
    await resolveCourses(supabase, userId, feedId, uniqueOccurrences)
  errors.push(...courseErrors)

  // 2) Bulk read existing assignments by external id.
  const externalIds = [...dedup.keys()]
  const { data: existingRows, error: selErr } = await supabase
    .from('assignments')
    .select('id, external_assignment_id, course_id, assignment_name, due_at, description, feed_id, source_url')
    .eq('user_id', userId)
    .in('external_assignment_id', externalIds)
  if (selErr) throw new Error(`assignments select: ${selErr.message}`)

  const existingByExt = new Map()
  for (const row of existingRows || []) existingByExt.set(String(row.external_assignment_id), row)

  const ts = nowIso()
  const toInsert = []
  const unchangedIds = []

  // 3) Partition occurrences into insert / update / unchanged.
  for (const occ of uniqueOccurrences) {
    const courseId = courseMap.get(occ.courseExternalId)
    if (!courseId) {
      // Course failed to resolve (insert error upstream) — skip this assignment.
      errors.push({ uid: occ.uid, error: 'parent course unresolved' })
      continue
    }
    const existing = existingByExt.get(String(occ.uid))
    if (!existing) {
      toInsert.push({
        user_id: userId,
        course_id: courseId,
        assignment_name: occ.title,
        due_at: occ.dueAt,
        description: occ.description,
        import_source: 'ics',
        external_assignment_id: occ.uid,
        feed_id: feedId,
        source_url: occ.sourceUrl,
        last_seen_at: ts,
      })
      continue
    }

    const changed =
      String(existing.course_id) !== String(courseId) ||
      normText(existing.assignment_name) !== normText(occ.title) ||
      !sameInstant(existing.due_at, occ.dueAt) ||
      normText(existing.description) !== normText(occ.description) ||
      normText(existing.feed_id) !== normText(feedId) ||
      normText(existing.source_url) !== normText(occ.sourceUrl)

    if (changed) {
      const { error: updErr } = await supabase
        .from('assignments')
        .update({
          course_id: courseId,
          assignment_name: occ.title,
          due_at: occ.dueAt,
          description: occ.description,
          feed_id: feedId,
          source_url: occ.sourceUrl,
          last_seen_at: ts,
          updated_at: ts,
        })
        .eq('id', existing.id)
        .eq('user_id', userId)
      if (updErr) errors.push({ uid: occ.uid, error: `assignments update: ${updErr.message}` })
      else assignmentsUpdated++
    } else {
      assignmentsUnchanged++
      unchangedIds.push(existing.id)
    }
  }

  // 4) Bulk-insert the new assignments.
  if (toInsert.length > 0) {
    const inserted = await bulkInsert(supabase, 'assignments', toInsert, 'id', errors)
    assignmentsInserted += inserted.length
  }

  // 5) One bulk last_seen_at touch for everything we saw but didn't rewrite.
  //    Best-effort: a failure here is non-fatal (the column is never read for
  //    pruning today; this just preserves the documented "we saw it" semantics).
  if (unchangedIds.length > 0) {
    const { error: touchErr } = await supabase
      .from('assignments')
      .update({ last_seen_at: ts })
      .eq('user_id', userId)
      .in('id', unchangedIds)
    if (touchErr) {
      // Swallow — non-critical metadata bump.
      console.warn('[writeOccurrences] last_seen_at touch failed:', touchErr.message || touchErr)
    }
  }

  return {
    coursesInserted,
    coursesUpdated,
    assignmentsInserted,
    assignmentsUpdated,
    assignmentsUnchanged,
    errors,
  }
}
