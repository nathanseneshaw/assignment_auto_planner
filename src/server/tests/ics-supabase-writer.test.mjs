import assert from 'node:assert'
import { describe, it } from 'node:test'
import { writeOccurrences } from '../ics-supabase-writer.js'

/**
 * Minimal in-memory fake of the subset of the Supabase/PostgREST query builder
 * that writeOccurrences uses. Records per-table call counts so we can assert
 * the reads/writes are actually bulked (no N+1).
 */
function makeFakeSupabase(seed = {}) {
  let idSeq = 1
  const db = {
    courses: (seed.courses || []).map((r) => ({ ...r })),
    assignments: (seed.assignments || []).map((r) => ({ ...r })),
  }
  const counts = { select: {}, insert: {}, update: {} }
  const bump = (op, table) => { counts[op][table] = (counts[op][table] || 0) + 1 }

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
    const state = { op: null, payload: null, eqs: [], in: null, single: false }
    const exec = () => {
      const t = db[table] || (db[table] = [])
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
      select() { if (!state.op) state.op = 'select'; return api },
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

  it('re-keys a renamed one-off by its source URL when the title also changed', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [{
        id: 'seed-url', user_id: USER, course_id: courseId,
        external_assignment_id: 'OLD-UID', assignment_name: 'Problem Set 3',
        due_at: '2026-09-01T12:00:00.000Z', description: 'desc 1', feed_id: FEED, source_url: 'https://x/1',
      }],
    }
    const { client, db } = makeFakeSupabase(seed)

    // Rotated UID + renamed + rescheduled. The per-event permalink is the only
    // surviving anchor, and it is enough.
    const occurrences = [occ(1, { uid: 'NEW-UID', title: 'Problem Set 3 (revised)', dueAt: '2026-09-15T12:00:00.000Z' })]
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 1)
    assert.equal(res.assignmentsInserted, 0)
    assert.equal(res.assignmentsArchived, 0)
    assert.equal(db.assignments.length, 1)
    assert.equal(db.assignments[0].id, 'seed-url')
    assert.equal(db.assignments[0].assignment_name, 'Problem Set 3 (revised)')
  })

  it('re-keys a renamed one-off by its due instant when the feed carries no URL', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [{
        id: 'seed-due', user_id: USER, course_id: courseId,
        external_assignment_id: 'OLD-UID', assignment_name: 'Reading response',
        due_at: '2026-09-02T12:00:00.000Z', description: 'desc 1', feed_id: FEED, source_url: null,
      }],
    }
    const { client, db } = makeFakeSupabase(seed)

    const occurrences = [occ(1, { uid: 'NEW-UID', title: 'Reading response 2', sourceUrl: null })]
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 1)
    assert.equal(res.assignmentsInserted, 0)
    assert.equal(db.assignments.length, 1)
    assert.equal(db.assignments[0].id, 'seed-due')
    assert.equal(db.assignments[0].assignment_name, 'Reading response 2')
  })

  it('does NOT due-match when two rows share the same due instant (inserts instead)', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [
        { id: 'seed-a', user_id: USER, course_id: courseId, external_assignment_id: 'OLD-A', assignment_name: 'Quiz 4', due_at: '2026-09-02T12:00:00.000Z', feed_id: FEED, source_url: null },
        { id: 'seed-b', user_id: USER, course_id: courseId, external_assignment_id: 'OLD-B', assignment_name: 'Discussion 4', due_at: '2026-09-02T12:00:00.000Z', feed_id: FEED, source_url: null },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    const occurrences = [occ(1, { uid: 'NEW', title: 'Something else', sourceUrl: null })]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 0)
    assert.equal(res.assignmentsInserted, 1) // ambiguous → safe insert, never a wrong merge
    assert.equal(db.assignments.length, 3)
  })

  it('does NOT match a recurring occurrence to a different series with the same title', async () => {
    const courseId = 'course-1'
    const seed = {
      courses: [courseSeed(courseId)],
      assignments: [
        { id: 'seed-r', user_id: USER, course_id: courseId, external_assignment_id: 'base@2026-09-01T12:00:00.000Z', assignment_name: 'Lecture', due_at: '2026-09-01T12:00:00.000Z', feed_id: FEED },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    // Same title, same course, one week apart — but a different series UID, so
    // the title must not be allowed to merge them.
    const occurrences = [occ(1, { uid: 'other@2026-09-08T12:00:00.000Z', seriesUid: 'other', title: 'Lecture', dueAt: '2026-09-08T12:00:00.000Z', isRecurring: true })]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 0)
    assert.equal(res.assignmentsInserted, 1)
    assert.equal(db.assignments.length, 2)
  })
})

// ── Pillar B: recurring series keep their identity when the series moves ──────

/** An already-stored occurrence of series `base` in course-1. */
const seriesRow = (isoStart, over = {}) => ({
  id: `row-${isoStart}`, user_id: USER, course_id: 'course-1',
  external_assignment_id: `base@${isoStart}`, assignment_name: 'Weekly Lab',
  due_at: isoStart, description: 'lab', feed_id: FEED, source_url: 'https://x/lab',
  feed_status: 'live', ...over,
})

/** The same occurrence as the feed now reports it, after the series moved. */
const seriesOcc = (isoStart, over = {}) => ({
  uid: `base@${isoStart}`,
  seriesUid: 'base',
  isRecurring: true,
  courseExternalId: 'C1',
  courseName: 'Course 1',
  title: 'Weekly Lab',
  dueAt: isoStart,
  description: 'lab',
  sourceUrl: 'https://x/lab',
  ...over,
})

describe('writeOccurrences (recurring series identity)', () => {
  it('updates a whole series in place when the professor shifts its time of day', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [
        seriesRow('2026-09-01T12:00:00.000Z'),
        seriesRow('2026-09-08T12:00:00.000Z'),
        seriesRow('2026-09-15T12:00:00.000Z'),
      ],
    }
    const { client, db } = makeFakeSupabase(seed)

    // 12:00 → 17:00 rotates every synthetic occurrence id, but the series UID
    // behind them is untouched, so every row must move rather than duplicate.
    const occurrences = [
      seriesOcc('2026-09-01T17:00:00.000Z'),
      seriesOcc('2026-09-08T17:00:00.000Z'),
      seriesOcc('2026-09-15T17:00:00.000Z'),
    ]
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 3)
    assert.equal(res.assignmentsInserted, 0)
    assert.equal(res.assignmentsArchived, 0)
    assert.equal(db.assignments.length, 3) // no duplicates, nothing archived

    // Each physical row kept its identity and picked up its own new time.
    assert.deepEqual(
      db.assignments.map((r) => [r.id, r.external_assignment_id]).sort(),
      [
        ['row-2026-09-01T12:00:00.000Z', 'base@2026-09-01T17:00:00.000Z'],
        ['row-2026-09-08T12:00:00.000Z', 'base@2026-09-08T17:00:00.000Z'],
        ['row-2026-09-15T12:00:00.000Z', 'base@2026-09-15T17:00:00.000Z'],
      ]
    )
    assert.ok(db.assignments.every((r) => r.feed_status !== 'archived'))
  })

  it('updates a series in place when both the day and the title change', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [seriesRow('2026-09-01T12:00:00.000Z'), seriesRow('2026-09-08T12:00:00.000Z')],
    }
    const { client, db } = makeFakeSupabase(seed)

    const occurrences = [
      seriesOcc('2026-09-03T12:00:00.000Z', { title: 'Weekly Lab (Thursdays)' }),
      seriesOcc('2026-09-10T12:00:00.000Z', { title: 'Weekly Lab (Thursdays)' }),
    ]
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 2)
    assert.equal(res.assignmentsInserted, 0)
    assert.equal(res.assignmentsArchived, 0)
    assert.equal(db.assignments.length, 2)
    assert.ok(db.assignments.every((r) => r.assignment_name === 'Weekly Lab (Thursdays)'))
  })

  it('recovers the series identity from a stored id even without seriesUid on the occurrence', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [seriesRow('2026-09-01T12:00:00.000Z')],
    }
    const { client, db } = makeFakeSupabase(seed)
    const occurrences = [seriesOcc('2026-09-01T17:00:00.000Z', { seriesUid: undefined })]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 1)
    assert.equal(db.assignments.length, 1)
  })

  it('inserts rather than adopting a distant row when a series gains a new occurrence', async () => {
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [seriesRow('2026-09-01T12:00:00.000Z')],
    }
    const { client, db } = makeFakeSupabase(seed)
    // Three months away is far outside MAX_SERIES_SHIFT_MS: this is a new
    // occurrence, not the old one moved.
    const occurrences = [seriesOcc('2026-12-01T12:00:00.000Z')]

    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences })

    assert.equal(res.assignmentsRekeyed, 0)
    assert.equal(res.assignmentsInserted, 1)
    assert.equal(res.assignmentsArchived, 1) // the genuinely-gone occurrence
    assert.equal(db.assignments.length, 2)
  })

  it('does not archive series occurrences that merely aged out of the expansion window', async () => {
    const dayMs = 24 * 60 * 60 * 1000
    const agedOut = new Date(Date.now() - 60 * dayMs).toISOString()
    const stillInWindow = new Date(Date.now() + 7 * dayMs).toISOString()
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [seriesRow(agedOut), seriesRow(stillInWindow)],
    }
    const { client, db } = makeFakeSupabase(seed)

    // The feed only reports the occurrence still inside the window. The older one
    // fell off the back of RRULE expansion — that is not a professor deleting it.
    const res = await writeOccurrences({
      supabase: client, userId: USER, feedId: FEED,
      occurrences: [seriesOcc(stillInWindow)],
    })

    assert.equal(res.assignmentsArchived, 0)
    assert.equal(db.assignments.find((r) => r.external_assignment_id === `base@${agedOut}`).feed_status, 'live')
  })

  it('still archives a one-off assignment the professor removed, however old', async () => {
    const oldIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const seed = {
      courses: [courseSeed('course-1')],
      assignments: [
        liveRow(),
        { id: 'gone', user_id: USER, course_id: 'course-1', external_assignment_id: 'ONE-OFF', assignment_name: 'Deleted essay', due_at: oldIso, feed_id: FEED, source_url: 'https://x/essay', feed_status: 'live' },
      ],
    }
    const { client, db } = makeFakeSupabase(seed)
    const res = await writeOccurrences({ supabase: client, userId: USER, feedId: FEED, occurrences: [occ(1)] })

    assert.equal(res.assignmentsArchived, 1)
    assert.equal(db.assignments.find((r) => r.id === 'gone').feed_status, 'archived')
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
