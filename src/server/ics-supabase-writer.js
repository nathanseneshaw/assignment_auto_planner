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
 *
 * Dedupe identity (Pillar B): the primary key is the event UID
 * (`external_assignment_id`), so a moved due date or a renamed assignment with a
 * *stable* UID updates in place. Two things break that, and both used to archive
 * the original and insert a near-identical duplicate beside it:
 *
 *   1. Some LMS feeds rotate the UID whenever an assignment changes.
 *   2. An RRULE occurrence's id is synthesised as `<series uid>@<instant>`, so
 *      moving the series (even by an hour) rotates every member's id even though
 *      the underlying event UID never changed.
 *
 * So for any incoming occurrence whose UID is unknown we load this feed's
 * existing rows and try to re-key one onto the new UID instead of inserting:
 *
 *   - recurring: same (course + series UID), nearest due date within
 *     MAX_SERIES_SHIFT_MS. The series UID is the stable professor-side identity;
 *     the date only decides which member of the series moved where.
 *   - one-off: same (course + source URL), else (course + normalized title),
 *     else (course + exact due instant). Together these survive a rename, a date
 *     move, or both at once when the feed supplies a per-event URL.
 *
 * Every candidate considered is a row the archive sweep below is about to mark
 * archived anyway, so a match can only ever turn "archive + insert a duplicate"
 * into "update in place". The conservative guards — unclaimed rows only, exactly
 * one candidate for the one-off tiers, a bounded shift for the series tier —
 * keep two genuinely distinct assignments from being merged.
 * Costs one extra feed-scoped select per non-empty sync.
 */

import { RECURRENCE_PAST_WINDOW_DAYS, parseOccurrenceUid } from './ics-parser.js'

function nowIso() {
  return new Date().toISOString()
}

/** Normalize nullish text to '' so null-vs-'' doesn't read as a change. */
function normText(v) {
  return v == null ? '' : String(v)
}

/** Normalize a title for content matching: lowercase, collapse whitespace. */
function normalizeTitleKey(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Content-dedupe key: an assignment is "the same" within a course + title. */
function contentKey(courseId, title) {
  return `${courseId}::${normalizeTitleKey(title)}`
}

/** Series key: all expanded occurrences of one recurring event, per course. */
function seriesKeyOf(courseId, seriesUid) {
  return `${courseId}::${seriesUid}`
}

/** Per-event permalink key. Only built for rows that actually carry a URL. */
function sourceUrlKey(courseId, sourceUrl) {
  return `${courseId}::${String(sourceUrl).trim()}`
}

/** Exact-due-instant key, so a renamed assignment still matches its old row. */
function dueKey(courseId, dueAt) {
  const t = Date.parse(dueAt)
  return Number.isNaN(t) ? null : `${courseId}::${t}`
}

/**
 * How far a recurring series may move and still be recognised as the same
 * occurrences. Comfortably covers the realistic edits (a time-of-day change, a
 * day-of-week change) while staying short enough that a genuinely new occurrence
 * at the tail of a series cannot adopt a long-departed one.
 */
const MAX_SERIES_SHIFT_MS = 14 * 24 * 60 * 60 * 1000

/** The series identity behind an occurrence, whether or not the parser set it. */
function seriesUidOf(occ) {
  if (occ.seriesUid) return String(occ.seriesUid)
  const parsed = parseOccurrenceUid(occ.uid)
  return parsed ? parsed.seriesUid : null
}

/**
 * Claim the single unclaimed row at `key`. Returns null when the key is absent
 * or ambiguous (more than one candidate) — we never merge two distinct rows on a
 * guess. Mutates `claimed`.
 */
function claimUnique(index, key, claimed) {
  if (!key) return null
  const candidates = (index.get(key) || []).filter((r) => !claimed.has(r.id))
  if (candidates.length !== 1) return null
  claimed.add(candidates[0].id)
  return candidates[0]
}

/**
 * Claim the member of this occurrence's own series whose due date is nearest.
 * Unlike the one-off tiers this tolerates several candidates, because the series
 * UID has already established they are all the same professor-side event — the
 * date only decides which member moved where. Bounded by MAX_SERIES_SHIFT_MS;
 * the earliest row wins a tie so the pass stays deterministic.
 */
function claimSeriesMatch(occ, courseId, seriesIndex, claimed) {
  const seriesUid = seriesUidOf(occ)
  if (!seriesUid) return null
  const target = Date.parse(occ.dueAt)
  if (Number.isNaN(target)) return null

  let best = null
  let bestDist = Infinity
  let bestAt = Infinity
  for (const row of seriesIndex.get(seriesKeyOf(courseId, seriesUid)) || []) {
    if (claimed.has(row.id)) continue
    const at = Date.parse(row.due_at)
    if (Number.isNaN(at)) continue
    const dist = Math.abs(at - target)
    if (dist < bestDist || (dist === bestDist && at < bestAt)) {
      best = row
      bestDist = dist
      bestAt = at
    }
  }
  if (!best || bestDist > MAX_SERIES_SHIFT_MS) return null
  claimed.add(best.id)
  return best
}

/**
 * Find an existing row to re-key onto a rotated UID. Recurring occurrences match
 * on their series UID; one-offs walk the permalink -> title -> due-instant tiers,
 * strongest identity first. Mutates `claimed`.
 */
function claimRekeyTarget(occ, courseId, indexes, claimed) {
  if (occ.isRecurring) return claimSeriesMatch(occ, courseId, indexes.series, claimed)
  return (
    (occ.sourceUrl
      ? claimUnique(indexes.sourceUrl, sourceUrlKey(courseId, occ.sourceUrl), claimed)
      : null) ||
    claimUnique(indexes.content, contentKey(courseId, occ.title), claimed) ||
    claimUnique(indexes.due, dueKey(courseId, occ.dueAt), claimed)
  )
}

/**
 * True when a row is an expanded recurrence that simply fell out of the back of
 * the parser's expansion window. The feed stopped listing it because it is old,
 * not because the professor removed it, so the archive sweep must leave it alone
 * — otherwise a live weekly series bleeds a row into the Archived tab per week.
 */
function isAgedOutSeriesMember(row, cutoffMs) {
  const parsed = parseOccurrenceUid(row.external_assignment_id)
  if (!parsed) return false
  const dueMs = Date.parse(row.due_at)
  return (Number.isNaN(dueMs) ? parsed.instant : dueMs) < cutoffMs
}

// Feature flag for the Pillar A archive columns (feed_status / archived_at).
// null = unprobed, true = present, false = absent (skip the archive sweep so a
// pre-migration schema keeps syncing). Mirrors the content_hash feature-detection
// in ics-routes.js — the live schema can lag the migrations.
let archiveColumnsPresent = null

const ASSIGNMENT_COLS =
  'id, external_assignment_id, course_id, assignment_name, due_at, description, feed_id, source_url'

/** True when a PostgREST error means an archive column doesn't exist. */
function isMissingArchiveColumn(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42703' || code === 'PGRST204') return true
  const msg = error.message || ''
  return /(feed_status|archived_at)/i.test(msg) && /(column|schema cache|does not exist)/i.test(msg)
}

/**
 * Read assignments with `feed_status` included when the column exists, falling
 * back to the base columns (and disabling the archive sweep) when it doesn't.
 * `applyFilters(query)` chains the per-call .eq/.in filters. Probes once; the
 * resolved capability is cached in `archiveColumnsPresent` for the process.
 */
async function selectAssignments(supabase, applyFilters) {
  const build = (cols) => applyFilters(supabase.from('assignments').select(cols))
  if (archiveColumnsPresent === false) return build(ASSIGNMENT_COLS)
  const rich = await build(`${ASSIGNMENT_COLS}, feed_status`)
  if (!rich.error) {
    archiveColumnsPresent = true
    return rich
  }
  if (isMissingArchiveColumn(rich.error)) {
    archiveColumnsPresent = false
    return build(ASSIGNMENT_COLS)
  }
  return rich
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
  let assignmentsRekeyed = 0
  let assignmentsArchived = 0
  const errors = []

  if (!occurrences || occurrences.length === 0) {
    return {
      coursesInserted: 0,
      coursesUpdated: 0,
      assignmentsInserted: 0,
      assignmentsUpdated: 0,
      assignmentsUnchanged: 0,
      assignmentsRekeyed: 0,
      assignmentsArchived: 0,
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

  // 2) Bulk read existing assignments by external id (feed_status included when
  //    the archive columns exist; see selectAssignments).
  const externalIds = [...dedup.keys()]
  const { data: existingRows, error: selErr } = await selectAssignments(
    supabase,
    (q) => q.eq('user_id', userId).in('external_assignment_id', externalIds)
  )
  if (selErr) throw new Error(`assignments select: ${selErr.message}`)

  const existingByExt = new Map()
  for (const row of existingRows || []) existingByExt.set(String(row.external_assignment_id), row)

  // Pillar B: load this feed's existing assignments so an incoming occurrence
  // with an unknown UID can be matched to an existing row and re-keyed, instead
  // of duplicating, when a feed rotates its UIDs or a recurring series moves.
  // Only rows whose UID is NOT in this sync are eligible (a still-present UID is
  // handled by the direct match above). `feedRows` is also the basis for the
  // Pillar A archive sweep below. Skipped when feedId is absent.
  const incomingUids = new Set(uniqueOccurrences.map((o) => String(o.uid)))
  // Each index maps a candidate identity -> rotated/orphaned rows. See
  // claimRekeyTarget for the order they are consulted in.
  const indexes = {
    series: new Map(),
    sourceUrl: new Map(),
    content: new Map(),
    due: new Map(),
  }
  const claimed = new Set() // existing row ids already matched this run
  const addTo = (index, key, row) => {
    if (!key) return
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(row)
  }
  let feedRows = []
  if (feedId) {
    const { data, error: feedSelErr } = await selectAssignments(
      supabase,
      (q) => q.eq('user_id', userId).eq('feed_id', feedId)
    )
    if (feedSelErr) throw new Error(`assignments feed select: ${feedSelErr.message}`)
    feedRows = data || []
    for (const row of feedRows) {
      if (incomingUids.has(String(row.external_assignment_id))) continue
      // A row is a candidate for one kind of match only: an expanded recurrence
      // is matched through its series, everything else through its own content.
      // Mixing them would let a one-off adopt a series member and punch a hole
      // in the series (its title and URL are shared by every member anyway).
      const parsed = parseOccurrenceUid(row.external_assignment_id)
      if (parsed) {
        addTo(indexes.series, seriesKeyOf(row.course_id, parsed.seriesUid), row)
        continue
      }
      addTo(indexes.content, contentKey(row.course_id, row.assignment_name), row)
      addTo(indexes.due, dueKey(row.course_id, row.due_at), row)
      if (normText(row.source_url).trim()) {
        addTo(indexes.sourceUrl, sourceUrlKey(row.course_id, row.source_url), row)
      }
    }
  }

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
    if (existing) {
      claimed.add(existing.id)
      // A previously-archived assignment that's back in the feed must be revived.
      const wasArchived = normText(existing.feed_status) === 'archived'
      const changed =
        wasArchived ||
        String(existing.course_id) !== String(courseId) ||
        normText(existing.assignment_name) !== normText(occ.title) ||
        !sameInstant(existing.due_at, occ.dueAt) ||
        normText(existing.description) !== normText(occ.description) ||
        normText(existing.feed_id) !== normText(feedId) ||
        normText(existing.source_url) !== normText(occ.sourceUrl)

      if (changed) {
        const patch = {
          course_id: courseId,
          assignment_name: occ.title,
          due_at: occ.dueAt,
          description: occ.description,
          feed_id: feedId,
          source_url: occ.sourceUrl,
          last_seen_at: ts,
          updated_at: ts,
        }
        if (wasArchived && archiveColumnsPresent === true) {
          patch.feed_status = 'live'
          patch.archived_at = null
        }
        const { error: updErr } = await supabase
          .from('assignments')
          .update(patch)
          .eq('id', existing.id)
          .eq('user_id', userId)
        if (updErr) errors.push({ uid: occ.uid, error: `assignments update: ${updErr.message}` })
        else assignmentsUpdated++
      } else {
        assignmentsUnchanged++
        unchangedIds.push(existing.id)
      }
      continue
    }

    // UID unknown. Pillar B: before inserting, try to re-key an existing row —
    // handles feeds that change the UID when an assignment is edited, and the
    // synthetic per-occurrence ids of a recurring series that moved.
    const adopt = claimRekeyTarget(occ, courseId, indexes, claimed)
    if (adopt) {
      const patch = {
        external_assignment_id: occ.uid,
        course_id: courseId,
        assignment_name: occ.title,
        due_at: occ.dueAt,
        description: occ.description,
        feed_id: feedId,
        source_url: occ.sourceUrl,
        last_seen_at: ts,
        updated_at: ts,
      }
      // The row is back in the feed (under a new UID) — keep/restore it live.
      if (archiveColumnsPresent === true) {
        patch.feed_status = 'live'
        patch.archived_at = null
      }
      const { error: rekeyErr } = await supabase
        .from('assignments')
        .update(patch)
        .eq('id', adopt.id)
        .eq('user_id', userId)
      if (rekeyErr) errors.push({ uid: occ.uid, error: `assignments rekey: ${rekeyErr.message}` })
      else {
        assignmentsUpdated++
        assignmentsRekeyed++
      }
      continue
    }

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

  // 6) Pillar A archive sweep: feed-owned assignments that vanished from this
  //    sync are marked archived (kept, never deleted) so a student keeps their
  //    record and completion after a professor removes the item. Guarded so it
  //    can only fire on a genuinely-current feed:
  //    - archive columns must exist (else skip; pre-migration safety);
  //    - scoped to this feed;
  //    - we are necessarily past the empty-occurrence early return, and fetch/
  //      parse failures throw before reaching here, and the content-hash fast
  //      path returns before calling this — so a broken/login-walled feed can't
  //      mass-archive real work.
  //    A row whose UID is still in the feed is never archived, even if an
  //    upstream error left it unclaimed, and neither is an expanded recurrence
  //    that only dropped out of the back of the parser's expansion window.
  if (archiveColumnsPresent === true && feedId) {
    const agedOutBefore = Date.now() - RECURRENCE_PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const toArchive = feedRows
      .filter(
        (r) =>
          !claimed.has(r.id) &&
          !incomingUids.has(String(r.external_assignment_id)) &&
          normText(r.feed_status) !== 'archived' &&
          !isAgedOutSeriesMember(r, agedOutBefore)
      )
      .map((r) => r.id)
    if (toArchive.length > 0) {
      const { error: archErr } = await supabase
        .from('assignments')
        .update({ feed_status: 'archived', archived_at: ts, updated_at: ts })
        .eq('user_id', userId)
        .in('id', toArchive)
      if (archErr) errors.push({ uid: 'archive-sweep', error: `assignments archive: ${archErr.message}` })
      else assignmentsArchived = toArchive.length
    }
  }

  return {
    coursesInserted,
    coursesUpdated,
    assignmentsInserted,
    assignmentsUpdated,
    assignmentsUnchanged,
    assignmentsRekeyed,
    assignmentsArchived,
    errors,
  }
}
