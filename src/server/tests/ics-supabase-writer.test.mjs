import assert from 'node:assert'
import { describe, it } from 'node:test'
import { writeOccurrences } from '../ics-supabase-writer.js'

/**
 * Minimal in-memory fake of the subset of the Supabase/PostgREST query builder
 * that writeOccurrences uses. Records per-table call counts so we can assert
 * the reads/writes are actually bulked (no N+1).
 */
function makeFakeSupabase(seed = {}, opts = {}) {
  let idSeq = 1
  const db = {
    courses: (seed.courses || []).map((r) => ({ ...r })),
    assignments: (seed.assignments || []).map((r) => ({ ...r })),
  }
  const counts = { select: {}, insert: {}, update: {} }
  const bump = (op, table) => { counts[op][table] = (counts[op][table] || 0) + 1 }
  // Optional error injection: `fail({ table, op, cols, payload, eqs, in })` may
  // return a PostgREST-shaped error object to make that one call fail.
  const fail = opts.fail || (() => null)

  function applyFilters(rows, eqs, inFilter) {
    let out = rows
    for (const [col, val] of eqs) out = out.filter((r) => String(r[col]) === String(val))
    if (inFilter) {
      const set = new Set(inFilter.values.map(String))
      out = out.filter((r) => set.has(String(r[inFilter.col])))
    }
    return out
  }

  function builder(table) {
    const state = { op: null, cols: null, payload: null, eqs: [], in: null, single: false }
    const exec = () => {
      const t = db[table] || (db[table] = [])
      const injected = fail({ table, ...state })
      if (injected) {
        if (state.op) bump(state.op, table)
        return { data: null, error: injected }
      }
      if (state.op === 'select') {
        bump('select', table)
        const rows = applyFilters(t, state.eqs, state.in).map((r) => ({ ...r }))
        return { data: state.single ? rows[0] || null : rows, error: null }
      }
      if (state.op === 'insert') {
        bump('insert', table)
        const arr = Array.isArray(state.payload) ? state.payload : [state.payload]
        const inserted = arr.map((row) => {
          const withId = { id: `id-${idSeq++}`, ...row }
          t.push(withId)
          return { ...withId }
        })
        return { data: state.single ? inserted[0] || null : inserted, error: null }
      }
      if (state.op === 'update') {
        bump('update', table)
        const rows = applyFilters(t, state.eqs, state.in)
        for (const r of rows) Object.assign(r, state.payload)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }
    const api = {
      select(cols) { if (!state.op) state.op = 'select'; state.cols = cols ?? state.cols; return api },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api },
      update(payload) { state.op = 'update'; state.payload = payload; return api },
      eq(col, val) { state.eqs.push([col, val]); return api },
      in(col, values) { state.in = { col, values }; return api },
      single() { state.single = true; return api },
      maybeSingle() { state.single = true; return api },
      then(resolve, reject) {
        try { resolve(exec()) } catch (e) { reject ? reject(e) : (() => { throw e })() }
      },
    }
    return api
  }

  return { client: { from: builder }, db, counts }
}

const USER = 'user-1'
const FEED = 'feed-1'

function occ(i, over = {}) {
  return {
    uid: `A${i}`,
    courseExternalId: 'C1',
    courseName: 'Course 1',
    title: `Assignment ${i}`,
    dueAt: '2026-09-0' + ((i % 9) + 1) + 'T12:00:00.000Z',
    description: `desc ${i}`,
    sourceUrl: `https://x/${i}`,
    ...over,
  }
}

describe('writeOccurrences (bulked writes)', () => {
  it('inserts all-new courses+assignments with ONE select and ONE insert per table', async () => {
    const { client, counts, db } = makeFakeSupabase()
    const occurrences = [occ(1), occ(2), occ(3)]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.coursesInserted, 1)
    assert.equal(res.assignmentsInserted, 3)
    assert.equal(res.assignmentsUpdated, 0)
    assert.equal(res.assignmentsUnchanged, 0)
    assert.deepEqual(res.errors, [])

    // No N+1: one bulk insert per table, zero updates. Assignments take two
    // selects (UID-keyed match + the feed-scoped read for content dedupe).
    assert.equal(counts.select.courses, 1)
    assert.equal(counts.insert.courses, 1)
    assert.equal(counts.select.assignments, 2)
    assert.equal(counts.insert.assignments, 1)
    assert.equal(counts.update.assignments || 0, 0)

    assert.equal(db.assignments.length, 3)
    assert.equal(db.courses.length, 1)
  })

  it('scales call count flat: 25 new assignments still = 1 insert call', async () => {
    const { client, counts } = makeFakeSupabase()
    const occurrences = Array.from({ length: 25 }, (_, i) => occ(i + 1))

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsInserted, 25)
    assert.equal(counts.insert.assignments, 1)
    // Two selects regardless of size (UID-keyed + feed-scoped) — still flat, no N+1.
    assert.equal(counts.select.assignments, 2)
  })

  it('treats an identical re-sync as fully unchanged (no inserts, no field updates)', async () => {
    const occurrences = [occ(1), occ(2)]
    const courseId = 'course-1'
    const seed = {
      courses: [{ id: courseId, user_id: USER, source: 'ics', external_course_id: 'C1', course_name: 'Course 1', feed_id: FEED }],
      assignments: occurrences.map((o) => ({
        id: `seed-${o.uid}`,
        user_id: USER,
        course_id: courseId,
        external_assignment_id: o.uid,
        assignment_name: o.title,
        due_at: o.dueAt,
        description: o.description,
        feed_id: FEED,
        source_url: o.sourceUrl,
      })),
    }
    const { client, counts } = makeFakeSupabase(seed)

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsInserted, 0)
    assert.equal(res.assignmentsUpdated, 0)
    assert.equal(res.assignmentsUnchanged, 2)
    assert.equal(res.coursesInserted, 0)
    assert.equal(res.coursesUpdated, 0)
    // No per-row field rewrites; at most a single bulk last_seen_at touch.
    assert.ok((counts.update.assignments || 0) <= 1)
    assert.equal(counts.insert.assignments || 0, 0)
  })

  it('updates only the changed row and leaves the rest untouched', async () => {
    const occurrences = [occ(1), occ(2)]
    const courseId = 'course-1'
    const seed = {
      courses: [{ id: courseId, user_id: USER, source: 'ics', external_course_id: 'C1', course_name: 'Course 1', feed_id: FEED }],
      assignments: occurrences.map((o) => ({
        id: `seed-${o.uid}`,
        user_id: USER,
        course_id: courseId,
        external_assignment_id: o.uid,
        assignment_name: o.title,
        due_at: o.dueAt,
        description: o.description,
        feed_id: FEED,
        source_url: o.sourceUrl,
      })),
    }
    const { client, db } = makeFakeSupabase(seed)

    // Change the title of A1 only.
    const changed = [occ(1, { title: 'Renamed assignment' }), occ(2)]
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: changed })

    assert.equal(res.assignmentsUpdated, 1)
    assert.equal(res.assignmentsUnchanged, 1)
    assert.equal(res.assignmentsInserted, 0)

    const a1 = db.assignments.find((r) => r.external_assignment_id === 'A1')
    assert.equal(a1.assignment_name, 'Renamed assignment')
  })

  it('collapses a duplicate UID within one feed to a single insert (no unique-index trip)', async () => {
    const { client, counts, db } = makeFakeSupabase()
    // Two occurrences share uid 'A1'; the second should win, not double-insert.
    const occurrences = [occ(1, { uid: 'A1', title: 'First' }), occ(2, { uid: 'A1', title: 'Second' })]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsInserted, 1)
    assert.deepEqual(res.errors, [])
    assert.equal(counts.insert.assignments, 1)
    assert.equal(db.assignments.length, 1)
    assert.equal(db.assignments[0].assignment_name, 'Second') // last wins
  })

  it('handles an empty feed without any DB calls', async () => {
    const { client, counts } = makeFakeSupabase()
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [] })
    assert.equal(res.assignmentsInserted, 0)
    assert.deepEqual(res.errors, [])
    assert.equal(counts.select.assignments || 0, 0)
    assert.equal(counts.select.courses || 0, 0)
  })
})

// ── Pillar B: content-based re-key for rotated UIDs ───────────────────────────

const courseSeed = (courseId) => ({
  id: courseId, user_id: USER, source: 'ics', external_course_id: 'C1', course_name: 'Course 1', feed_id: FEED,
})

describe('writeOccurrences (rotated-UID content dedupe)', () => {
  it('re-keys an existing row onto a new UID instead of duplicating when title matches', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [{
        id: 'seed-old', user_id: USER, course_id: courseId,
        external_assignment_id: 'OLD-UID', assignment_name: 'Assignment 1',
        due_at: '2026-09-01T12:00:00.000Z', description: 'desc 1', feed_id: FEED, source_url: 'https://x/1',
      }],
    }
    const { client, db } = makeFakeSupabase(seed)

    // Same course + title, NEW uid, MOVED due date: a feed that rotates the UID
    // when the professor reschedules. Must update the row, not insert a copy.
    const occurrences = [occ(1, { uid: 'NEW-UID', dueAt: '2026-09-15T12:00:00.000Z' })]
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 1)
    assert.equal(res.assignmentsUpdated, 1) // a rekey is reported as an update
    assert.equal(res.assignmentsInserted, 0)
    assert.equal(db.assignments.length, 1)  // no duplicate

    const row = db.assignments[0]
    assert.equal(row.id, 'seed-old')                     // same physical row
    assert.equal(row.external_assignment_id, 'NEW-UID')  // re-keyed to new UID
    assert.ok(row.due_at.startsWith('2026-09-15'))       // due date moved
  })

  it('does NOT content-match when two same-titled rows are ambiguous (inserts instead)', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [
        { id: 'seed-a', user_id: USER, course_id: courseId, external_assignment_id: 'OLD-A', assignment_name: 'Weekly Quiz', due_at: '2026-09-01T12:00:00.000Z', feed_id: FEED },
        { id: 'seed-b', user_id: USER, course_id: courseId, external_assignment_id: 'OLD-B', assignment_name: 'Weekly Quiz', due_at: '2026-09-08T12:00:00.000Z', feed_id: FEED },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    const occurrences = [occ(1, { uid: 'NEW', title: 'Weekly Quiz', dueAt: '2026-09-20T12:00:00.000Z' })]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 0)
    assert.equal(res.assignmentsInserted, 1) // ambiguous → safe insert, never a wrong merge
    assert.equal(db.assignments.length, 3)
  })

  it('does NOT content-match recurring occurrences (series members share a title)', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [
        { id: 'seed-r', user_id: USER, course_id: courseId, external_assignment_id: 'base@2026-09-01', assignment_name: 'Lecture', due_at: '2026-09-01T12:00:00.000Z', feed_id: FEED },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    const occurrences = [occ(1, { uid: 'base@2026-09-08', title: 'Lecture', dueAt: '2026-09-08T12:00:00.000Z', isRecurring: true })]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 0)
    assert.equal(res.assignmentsInserted, 1)
    assert.equal(db.assignments.length, 2)
  })
})

// ── Pillar A: archive lifecycle (removed-from-feed) ───────────────────────────

// occ(1) resolves to uid 'A1', title 'Assignment 1', due '2026-09-02T12:00:00.000Z',
// description 'desc 1', sourceUrl 'https://x/1' — match these in seeds to keep a
// row "unchanged" so the assertions isolate the archive behavior.
const liveRow = (over = {}) => ({
  id: 'keep', user_id: USER, course_id: 'course-1', external_assignment_id: 'A1',
  assignment_name: 'Assignment 1', due_at: '2026-09-02T12:00:00.000Z', description: 'desc 1',
  feed_id: FEED, source_url: 'https://x/1', feed_status: 'live', ...over,
})

describe('writeOccurrences (archive lifecycle)', () => {
  it('archives a feed-owned assignment that vanished from the sync (no delete)', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [
        liveRow(),
        { id: 'gone', user_id: USER, course_id: 'course-1', external_assignment_id: 'A2', assignment_name: 'Assignment 2', due_at: '2026-09-05T12:00:00.000Z', feed_id: FEED, source_url: 'https://x/2', feed_status: 'live' },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    // Only A1 is still in the feed; A2 disappeared.
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsArchived, 1)
    assert.equal(db.assignments.length, 2) // kept, never deleted
    assert.equal(db.assignments.find((r) => r.external_assignment_id === 'A1').feed_status, 'live')
    const a2 = db.assignments.find((r) => r.external_assignment_id === 'A2')
    assert.equal(a2.feed_status, 'archived')
    assert.ok(a2.archived_at) // timestamped when it left the feed
  })

  it('revives an archived assignment when it reappears in the feed', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [liveRow({ id: 'back', feed_status: 'archived', archived_at: '2026-05-01T00:00:00.000Z' })],
    }
    const { client, db } = makeFakeSupabase(seed)
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsArchived, 0)
    assert.equal(res.assignmentsUpdated, 1) // revival is reported as an update
    const a1 = db.assignments.find((r) => r.external_assignment_id === 'A1')
    assert.equal(a1.feed_status, 'live')
    assert.equal(a1.archived_at, null)
  })

  it('does not re-touch a row that was already archived and stays gone', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [
        liveRow(),
        { id: 'arch', user_id: USER, course_id: 'course-1', external_assignment_id: 'OLD', assignment_name: 'Long gone', due_at: '2026-08-01T12:00:00.000Z', feed_id: FEED, source_url: 'https://x/old', feed_status: 'archived' },
      ],
    }
    const { client } = makeFakeSupabase(seed)
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })
    assert.equal(res.assignmentsArchived, 0) // already archived → not counted again
  })

  it('never archives rows belonging to a different feed', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [
        liveRow(),
        { id: 'other', user_id: USER, course_id: 'course-1', external_assignment_id: 'B1', assignment_name: 'Other feed item', due_at: '2026-09-02T12:00:00.000Z', feed_id: 'feed-2', source_url: 'https://y/1', feed_status: 'live' },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsArchived, 0)
    assert.equal(db.assignments.find((r) => r.external_assignment_id === 'B1').feed_status, 'live') // untouched
  })
})

// ── bulk-insert resilience (per-row fallback) ────────────────────────────────
// bulkInsert deliberately retries row-by-row when the batch insert fails, so a
// single malformed row can't sink a whole feed. Nothing exercised that path.

const isBatch = (ctx) => Array.isArray(ctx.payload)

describe('writeOccurrences (bulk-insert per-row fallback)', () => {
  it('falls back to per-row inserts when the batch fails, landing every good row', async () => {
    const { client, counts, db } = makeFakeSupabase({}, {
      fail: (ctx) => (ctx.op === 'insert' && ctx.table === 'assignments' && isBatch(ctx)
        ? { message: 'batch rejected' }
        : null),
    })

    const res = await writeOccurrences({
      supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1), occ(2), occ(3)],
    })

    assert.equal(res.assignmentsInserted, 3)
    assert.deepEqual(res.errors, [])
    assert.equal(db.assignments.length, 3)
    assert.equal(counts.insert.assignments, 4)   // 1 failed batch + 3 single-row retries
  })

  it('collects a per-row error for the one bad row and still saves the rest', async () => {
    const { client, db } = makeFakeSupabase({}, {
      fail: (ctx) => {
        if (ctx.op !== 'insert' || ctx.table !== 'assignments') return null
        const rows = isBatch(ctx) ? ctx.payload : [ctx.payload]
        return rows.some((r) => r.external_assignment_id === 'A2')
          ? { message: 'value too long for column assignment_name' }
          : null
      },
    })

    const res = await writeOccurrences({
      supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1), occ(2), occ(3)],
    })

    assert.equal(res.assignmentsInserted, 2)
    assert.equal(res.errors.length, 1)
    assert.equal(res.errors[0].uid, 'A2')
    assert.match(res.errors[0].error, /^assignments insert: /)
    assert.deepEqual(db.assignments.map((r) => r.external_assignment_id).sort(), ['A1', 'A3'])
  })

  it('applies the same fallback to the courses insert', async () => {
    const { client, counts, db } = makeFakeSupabase({}, {
      fail: (ctx) => (ctx.op === 'insert' && ctx.table === 'courses' && isBatch(ctx)
        ? { message: 'batch rejected' }
        : null),
    })

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.coursesInserted, 1)
    assert.deepEqual(res.errors, [])
    assert.equal(counts.insert.courses, 2)      // failed batch + one retry
    assert.equal(db.courses.length, 1)
  })

  it('skips assignments whose parent course could not be created', async () => {
    const { client, db } = makeFakeSupabase({}, {
      fail: (ctx) => (ctx.op === 'insert' && ctx.table === 'courses' ? { message: 'courses are on fire' } : null),
    })

    const res = await writeOccurrences({
      supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1), occ(2)],
    })

    assert.equal(res.assignmentsInserted, 0)
    assert.equal(db.assignments.length, 0)
    assert.ok(res.errors.some((e) => e.error === 'parent course unresolved'))
    assert.deepEqual(res.errors.filter((e) => e.error === 'parent course unresolved').map((e) => e.uid), ['A1', 'A2'])
  })
})

// ── unrecoverable read errors ────────────────────────────────────────────────

describe('writeOccurrences (read failures throw, they do not silently no-op)', () => {
  it('throws when the courses select fails', async () => {
    const { client } = makeFakeSupabase({}, {
      fail: (ctx) => (ctx.op === 'select' && ctx.table === 'courses' ? { message: 'boom' } : null),
    })
    await assert.rejects(
      () => writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] }),
      /courses select: boom/
    )
  })

  it('throws when the UID-keyed assignments select fails', async () => {
    const { client } = makeFakeSupabase({}, {
      fail: (ctx) => (ctx.op === 'select' && ctx.table === 'assignments' &&
        !ctx.eqs.some(([c]) => c === 'feed_id') ? { message: 'boom' } : null),
    })
    await assert.rejects(
      () => writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] }),
      /assignments select: boom/
    )
  })

  it('throws when the feed-scoped assignments select fails', async () => {
    const { client } = makeFakeSupabase({}, {
      fail: (ctx) => (ctx.op === 'select' && ctx.table === 'assignments' &&
        ctx.eqs.some(([c]) => c === 'feed_id') ? { message: 'boom' } : null),
    })
    await assert.rejects(
      () => writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] }),
      /assignments feed select: boom/
    )
  })

  it('collects (does not throw on) a per-row assignment update failure', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [{
        id: 'seed-A1', user_id: USER, course_id: 'course-1', external_assignment_id: 'A1',
        assignment_name: 'Old name', due_at: '2026-09-02T12:00:00.000Z', description: 'desc 1',
        feed_id: FEED, source_url: 'https://x/1',
      }],
    }
    const { client } = makeFakeSupabase(seed, {
      fail: (ctx) => (ctx.op === 'update' && ctx.table === 'assignments' &&
        ctx.eqs.some(([c]) => c === 'id') ? { message: 'update denied' } : null),
    })

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsUpdated, 0)
    assert.equal(res.errors.length, 1)
    assert.equal(res.errors[0].uid, 'A1')
    assert.match(res.errors[0].error, /^assignments update: /)
  })
})

// ── course row maintenance ───────────────────────────────────────────────────

describe('writeOccurrences (course row maintenance)', () => {
  it('renames an existing course when the feed\'s course name changed', async () => {
    const { client, db } = makeFakeSupabase({
      courses: [{ id: 'course-1', user_id: USER, source: 'ics', external_course_id: 'C1', course_name: 'Old title', feed_id: FEED }],
    })

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.coursesUpdated, 1)
    assert.equal(res.coursesInserted, 0)
    assert.equal(db.courses.length, 1)
    assert.equal(db.courses[0].course_name, 'Course 1')
  })

  it('backfills feed_id on a course row that predates feed tracking', async () => {
    const { client, db } = makeFakeSupabase({
      courses: [{ id: 'course-1', user_id: USER, source: 'ics', external_course_id: 'C1', course_name: 'Course 1', feed_id: null }],
    })

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.coursesUpdated, 1)
    assert.equal(db.courses[0].feed_id, FEED)
    assert.equal(db.courses[0].course_name, 'Course 1')
  })

  it('leaves an already-correct course row completely untouched', async () => {
    const { client, counts } = makeFakeSupabase({ courses: [courseSeed('course-1')] })
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })
    assert.equal(res.coursesUpdated, 0)
    assert.equal(res.coursesInserted, 0)
    assert.equal(counts.update.courses || 0, 0)
  })

  it('collects a course update failure instead of throwing', async () => {
    const { client } = makeFakeSupabase({
      courses: [{ id: 'course-1', user_id: USER, source: 'ics', external_course_id: 'C1', course_name: 'Old title', feed_id: FEED }],
    }, {
      fail: (ctx) => (ctx.op === 'update' && ctx.table === 'courses' ? { message: 'denied' } : null),
    })

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.coursesUpdated, 0)
    assert.ok(res.errors.some((e) => e.uid === 'course:C1' && /courses update: denied/.test(e.error)))
  })
})

// ── timestamp comparison tolerance ───────────────────────────────────────────
// due_at comes back from PostgREST as '+00:00' while occurrences carry '.000Z'.
// Comparing the strings would rewrite every row on every sync.

describe('writeOccurrences (due_at is compared by instant, not by string)', () => {
  const withDueAt = (dueAt) => ({
    courses: [courseSeed('course-1')],
    assignments: [{
      id: 'seed-A1', user_id: USER, course_id: 'course-1', external_assignment_id: 'A1',
      assignment_name: 'Assignment 1', due_at: dueAt, description: 'desc 1',
      feed_id: FEED, source_url: 'https://x/1',
    }],
  })

  it('treats a Postgres "+00:00" offset as identical to the ".000Z" form', async () => {
    const { client, counts } = makeFakeSupabase(withDueAt('2026-09-02T12:00:00+00:00'))
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsUnchanged, 1)
    assert.equal(res.assignmentsUpdated, 0)
    assert.ok((counts.update.assignments || 0) <= 1) // at most the bulk last_seen_at touch
  })

  it('treats an equivalent non-UTC offset as identical too', async () => {
    const { client } = makeFakeSupabase(withDueAt('2026-09-02T07:00:00-05:00'))
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })
    assert.equal(res.assignmentsUnchanged, 1)
  })

  it('still updates when the instant genuinely moved', async () => {
    const { client, db } = makeFakeSupabase(withDueAt('2026-09-02T12:00:01+00:00'))
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })
    assert.equal(res.assignmentsUpdated, 1)
    assert.equal(db.assignments[0].due_at, '2026-09-02T12:00:00.000Z')
  })
})

// ── pre-migration schema (archive columns absent) ────────────────────────────
// Mirrors the content_hash degradation in ics-routes.js: the live schema can lag
// the migrations, and the archive sweep must switch itself off rather than break
// sync. Uses a FRESH module instance because `archiveColumnsPresent` is
// process-level state that the tests above have already latched to `true`.

describe('writeOccurrences (schema without feed_status/archived_at)', () => {
  it('skips the archive sweep and syncs normally when the columns are missing', async () => {
    const { writeOccurrences: writeFresh } = await import('../ics-supabase-writer.js?noArchiveColumns=1')

    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [{
        id: 'vanished', user_id: USER, course_id: 'course-1', external_assignment_id: 'GONE',
        assignment_name: 'Removed by the professor', due_at: '2026-08-01T12:00:00.000Z',
        feed_id: FEED, source_url: 'https://x/old',
      }],
    }
    const { client, db } = makeFakeSupabase(seed, {
      fail: (ctx) => (ctx.op === 'select' && /feed_status/.test(String(ctx.cols || ''))
        ? { code: '42703', message: 'column assignments.feed_status does not exist' }
        : null),
    })

    const res = await writeFresh({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsInserted, 1, 'sync still works on a pre-migration schema')
    assert.equal(res.assignmentsArchived, 0, 'the sweep must be skipped, not attempted')
    assert.deepEqual(res.errors, [])

    const gone = db.assignments.find((r) => r.external_assignment_id === 'GONE')
    assert.ok(gone, 'the vanished row is left exactly as it was')
    assert.equal(gone.feed_status, undefined)
    assert.equal(gone.archived_at, undefined)
  })

  it('does not archive anything when the feed produced zero occurrences', async () => {
    const { client, db } = makeFakeSupabase({
      courses: [courseSeed('course-1')],
      assignments: [liveRow()],
    })
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [] })

    assert.equal(res.assignmentsArchived, 0)
    assert.equal(db.assignments[0].feed_status, 'live', 'an empty feed must never mass-archive')
  })
})
