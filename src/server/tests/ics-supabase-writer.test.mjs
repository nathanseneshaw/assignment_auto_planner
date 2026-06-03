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

    // No N+1: one bulk select + one bulk insert per table, zero updates.
    assert.equal(counts.select.courses, 1)
    assert.equal(counts.insert.courses, 1)
    assert.equal(counts.select.assignments, 1)
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
    assert.equal(counts.select.assignments, 1)
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
