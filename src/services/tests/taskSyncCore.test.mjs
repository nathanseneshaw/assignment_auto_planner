import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  priorityLevelFromPriority,
  normalizeScheduledDate,
  buildTaskRow,
  mapDbTaskRow,
  mergeTaskLists,
} from '../taskSyncCore.js'

test('normalizeScheduledDate: empty/blank/nullish -> null, valid passes through', () => {
  assert.equal(normalizeScheduledDate(''), null)
  assert.equal(normalizeScheduledDate('   '), null)
  assert.equal(normalizeScheduledDate(null), null)
  assert.equal(normalizeScheduledDate(undefined), null)
  assert.equal(normalizeScheduledDate('2026-06-01'), '2026-06-01')
})

test('buildTaskRow: undated task sends scheduled_date null and includes id (Fix #1)', () => {
  const row = buildTaskRow(
    { id: 'abc', title: '  Read ch 4 ', scheduledDate: '', priority: 2, completed: false },
    { userId: 'u1', now: '2026-06-01T00:00:00.000Z' },
  )
  assert.equal(row.id, 'abc')
  assert.equal(row.user_id, 'u1')
  assert.equal(row.scheduled_date, null) // the prime-suspect bug fix
  assert.equal(row.title, 'Read ch 4')
  assert.equal(row.priority, 2)
  assert.equal(row.completed, false)
  assert.equal(row.assignment_id, null)
  assert.equal(row.course_id, null)
  assert.equal(row.updated_at, '2026-06-01T00:00:00.000Z')
})

test('buildTaskRow: dated task keeps date and resolved FK ids', () => {
  const row = buildTaskRow(
    { id: 'x', title: 'T', scheduledDate: '2026-07-04', priority: 1 },
    { userId: 'u', supabaseAssignmentId: 'a1', supabaseCourseId: 'c1' },
  )
  assert.equal(row.scheduled_date, '2026-07-04')
  assert.equal(row.assignment_id, 'a1')
  assert.equal(row.course_id, 'c1')
})

test('buildTaskRow: blank title falls back to "Untitled task"', () => {
  const row = buildTaskRow({ id: 'x', title: '   ', priority: 3 }, { userId: 'u' })
  assert.equal(row.title, 'Untitled task')
})

test('priorityLevelFromPriority maps ranks and defaults to normal', () => {
  assert.equal(priorityLevelFromPriority(1), 'urgent')
  assert.equal(priorityLevelFromPriority(2), 'high')
  assert.equal(priorityLevelFromPriority(3), 'normal')
  assert.equal(priorityLevelFromPriority(0), 'normal')
  assert.equal(priorityLevelFromPriority(99), 'normal')
  assert.equal(priorityLevelFromPriority(undefined), 'normal')
})

test('mapDbTaskRow derives priorityLevel and maps fields (priority round-trips)', () => {
  const t = mapDbTaskRow(
    {
      id: 'r1',
      title: 'Row',
      scheduled_date: '2026-06-02',
      priority: 1,
      completed: true,
      course_id: 'c1',
      assignment_id: 'a1',
      created_at: '2026-01-01T00:00:00Z',
    },
    { assignment: { id: 'a1', courseId: 'c1', courseName: 'Math' } },
  )
  assert.equal(t.id, 'r1')
  assert.equal(t.supabaseTaskId, 'r1')
  assert.equal(t.priority, 1)
  assert.equal(t.priorityLevel, 'urgent')
  assert.equal(t.completed, true)
  assert.equal(t.assignmentId, 'a1')
  assert.equal(t.courseId, 'c1')
  assert.equal(t.courseName, 'Math')
})

test('mapDbTaskRow: null scheduled_date becomes "" for UI grouping', () => {
  const t = mapDbTaskRow({ id: 'r2', title: 'X', scheduled_date: null, priority: 3 })
  assert.equal(t.scheduledDate, '')
  assert.equal(t.priorityLevel, 'normal')
})

test('mergeTaskLists: no duplicate when a pending local task matches a db row by id (Fix #3)', () => {
  // Duplicate-race scenario: local task created with id X (insert in flight,
  // supabaseTaskId still null) while the db snapshot already contains row X.
  const dbTasks = [{ id: 'X', supabaseTaskId: 'X', title: 'A' }]
  const localTasks = [{ id: 'X', supabaseTaskId: null, title: 'A' }]
  const merged = mergeTaskLists(dbTasks, localTasks)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].supabaseTaskId, 'X')
})

test('mergeTaskLists: preserves a genuinely in-flight/failed local task absent from db (Fix #2 self-heal target)', () => {
  const dbTasks = [{ id: 'A', supabaseTaskId: 'A' }]
  const localTasks = [
    { id: 'A', supabaseTaskId: 'A' }, // already in db -> dedup
    { id: 'B', supabaseTaskId: null }, // never persisted -> keep
  ]
  const merged = mergeTaskLists(dbTasks, localTasks)
  assert.deepEqual(merged.map((t) => t.id).sort(), ['A', 'B'])
})

test('mergeTaskLists: dedups legacy task matched via supabaseTaskId (client id != db id)', () => {
  const dbTasks = [{ id: 'DB1', supabaseTaskId: 'DB1' }]
  const localTasks = [{ id: 'client-uuid', supabaseTaskId: 'DB1' }]
  const merged = mergeTaskLists(dbTasks, localTasks)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 'DB1')
})

test('mergeTaskLists: empty db snapshot keeps all local tasks (no wipe  original regression)', () => {
  const localTasks = [
    { id: 'A', supabaseTaskId: null },
    { id: 'B', supabaseTaskId: 'B' },
  ]
  const merged = mergeTaskLists([], localTasks)
  assert.equal(merged.length, 2)
})
