import { setActivePinia, createPinia } from 'pinia'
import { useSubtasksStore } from '../subtasks.js'

/**
 * Mutable Supabase harness.
 *
 * `sb.configured` / `sb.hasClient` are read through getters on the mocked
 * module so a single file can exercise the configured path, the local-only
 * (no backend) path, and the signed-out path without re-importing the store.
 *
 * The query builder is chained exactly the way the store calls it:
 *   from('subtasks').upsert(row, { onConflict: 'id' })
 *   from('subtasks').delete().eq('id', id).eq('user_id', user.id)
 */
const sb = vi.hoisted(() => {
  const upsert = vi.fn(async () => ({ data: null, error: null }))
  const deleteEqUser = vi.fn(async () => ({ data: null, error: null }))
  const deleteEqId = vi.fn(() => ({ eq: deleteEqUser }))
  const deleteFn = vi.fn(() => ({ eq: deleteEqId }))
  const from = vi.fn(() => ({ upsert, delete: deleteFn }))
  const getUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
  return {
    configured: true,
    hasClient: true,
    from,
    upsert,
    deleteFn,
    deleteEqId,
    deleteEqUser,
    getUser,
    client: { from, auth: { getUser } },
  }
})

vi.mock('../../lib/supabase', () => ({
  get isSupabaseConfigured() { return sb.configured },
  get supabase() { return sb.hasClient ? sb.client : null },
}))

/** A hydration row shaped exactly as Supabase returns it (snake_case). */
function dbRow(overrides = {}) {
  return {
    id: 'sub-1',
    task_id: 'task-1',
    title: 'Read chapter 3',
    completed: false,
    sort_order: 0,
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

/** A local (camelCase) subtask, for seeding store state directly. */
function localSubtask(overrides = {}) {
  return {
    id: 'sub-1',
    taskId: 'task-1',
    title: 'Read chapter 3',
    completed: false,
    sortOrder: 0,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  sb.configured = true
  sb.hasClient = true
})

// ── subtaskCountByTask ────────────────────────────────────────────────────────

describe('subtaskCountByTask', () => {
  it('aggregates total and completed counts per parent task', () => {
    const store = useSubtasksStore()
    store.subtasks = [
      localSubtask({ id: 'a1', taskId: 't1', completed: true }),
      localSubtask({ id: 'a2', taskId: 't1', completed: false }),
      localSubtask({ id: 'a3', taskId: 't1', completed: true }),
      localSubtask({ id: 'b1', taskId: 't2', completed: false }),
    ]
    expect(store.subtaskCountByTask.t1).toEqual({ total: 3, completed: 2 })
    expect(store.subtaskCountByTask.t2).toEqual({ total: 1, completed: 0 })
  })

  it('omits tasks that have no subtasks at all', () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ taskId: 't1' })]
    expect(store.subtaskCountByTask.t2).toBeUndefined()
    expect(Object.keys(store.subtaskCountByTask)).toEqual(['t1'])
  })

  it('is an empty map when there are no subtasks', () => {
    const store = useSubtasksStore()
    expect(store.subtaskCountByTask).toEqual({})
  })

  it('recomputes after a subtask is toggled', async () => {
    const store = useSubtasksStore()
    const s = await store.addSubtask('t1', 'Outline')
    expect(store.subtaskCountByTask.t1.completed).toBe(0)
    await store.toggleSubtask(s.id)
    expect(store.subtaskCountByTask.t1.completed).toBe(1)
  })
})

// ── getSubtasksForTask ────────────────────────────────────────────────────────

describe('getSubtasksForTask', () => {
  it('returns only subtasks belonging to the given task', () => {
    const store = useSubtasksStore()
    store.subtasks = [
      localSubtask({ id: 'a1', taskId: 't1' }),
      localSubtask({ id: 'b1', taskId: 't2' }),
      localSubtask({ id: 'a2', taskId: 't1' }),
    ]
    expect(store.getSubtasksForTask('t1').map(s => s.id)).toEqual(['a1', 'a2'])
  })

  it('sorts by sortOrder ascending, not insertion order', () => {
    const store = useSubtasksStore()
    store.subtasks = [
      localSubtask({ id: 'third', taskId: 't1', sortOrder: 2 }),
      localSubtask({ id: 'first', taskId: 't1', sortOrder: 0 }),
      localSubtask({ id: 'second', taskId: 't1', sortOrder: 1 }),
    ]
    expect(store.getSubtasksForTask('t1').map(s => s.id)).toEqual(['first', 'second', 'third'])
  })

  it('treats a missing sortOrder as 0 so it sorts ahead of ordered siblings', () => {
    const store = useSubtasksStore()
    store.subtasks = [
      localSubtask({ id: 'ordered', taskId: 't1', sortOrder: 5 }),
      { id: 'unordered', taskId: 't1', title: 'No sortOrder', completed: false },
    ]
    expect(store.getSubtasksForTask('t1').map(s => s.id)).toEqual(['unordered', 'ordered'])
  })

  it('returns an empty array for a task with no subtasks', () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ taskId: 't1' })]
    expect(store.getSubtasksForTask('nope')).toEqual([])
  })
})

// ── addSubtask ────────────────────────────────────────────────────────────────

describe('addSubtask', () => {
  it('appends a subtask with generated id and default fields', async () => {
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Draft intro')
    expect(store.subtasks).toHaveLength(1)
    expect(created.id).toBeDefined()
    expect(created.taskId).toBe('t1')
    expect(created.completed).toBe(false)
    expect(created.createdAt).toBeDefined()
  })

  it('trims surrounding whitespace from the title', async () => {
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', '   Draft intro \n')
    expect(created.title).toBe('Draft intro')
  })

  it('returns null and adds nothing for an empty title', async () => {
    const store = useSubtasksStore()
    expect(await store.addSubtask('t1', '')).toBeNull()
    expect(store.subtasks).toHaveLength(0)
  })

  it('returns null and adds nothing for a whitespace-only title', async () => {
    const store = useSubtasksStore()
    expect(await store.addSubtask('t1', '   \t  ')).toBeNull()
    expect(store.subtasks).toHaveLength(0)
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('returns null for null/undefined titles instead of throwing', async () => {
    const store = useSubtasksStore()
    expect(await store.addSubtask('t1', null)).toBeNull()
    expect(await store.addSubtask('t1', undefined)).toBeNull()
    expect(store.subtasks).toHaveLength(0)
  })

  it('assigns incrementing sortOrder scoped per parent task', async () => {
    const store = useSubtasksStore()
    const a1 = await store.addSubtask('t1', 'A1')
    const b1 = await store.addSubtask('t2', 'B1')
    const a2 = await store.addSubtask('t1', 'A2')
    const b2 = await store.addSubtask('t2', 'B2')
    expect([a1.sortOrder, a2.sortOrder]).toEqual([0, 1])
    expect([b1.sortOrder, b2.sortOrder]).toEqual([0, 1])
  })

  it('upserts a snake_case row keyed on id with the signed-in user', async () => {
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Persist me')
    expect(sb.from).toHaveBeenCalledWith('subtasks')
    expect(sb.upsert).toHaveBeenCalledWith(
      {
        id: created.id,
        task_id: 't1',
        user_id: 'user-1',
        title: 'Persist me',
        completed: false,
        sort_order: 0,
      },
      { onConflict: 'id' },
    )
  })
})

// ── toggleSubtask ─────────────────────────────────────────────────────────────

describe('toggleSubtask', () => {
  it('flips completed from false to true', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', completed: false })]
    await store.toggleSubtask('s1')
    expect(store.subtasks[0].completed).toBe(true)
  })

  it('flips completed from true to false', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', completed: true })]
    await store.toggleSubtask('s1')
    expect(store.subtasks[0].completed).toBe(false)
  })

  it('persists the new completed value', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', completed: false, sortOrder: 4 })]
    await store.toggleSubtask('s1')
    expect(sb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', completed: true, sort_order: 4 }),
      { onConflict: 'id' },
    )
  })

  it('is a no-op for an unknown id (no state change, no write)', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', completed: false })]
    await store.toggleSubtask('does-not-exist')
    expect(store.subtasks[0].completed).toBe(false)
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('leaves sibling subtasks untouched', async () => {
    const store = useSubtasksStore()
    store.subtasks = [
      localSubtask({ id: 's1', completed: false }),
      localSubtask({ id: 's2', completed: false }),
    ]
    await store.toggleSubtask('s1')
    expect(store.subtasks[1].completed).toBe(false)
  })
})

// ── deleteSubtask ─────────────────────────────────────────────────────────────

describe('deleteSubtask', () => {
  it('removes only the targeted subtask', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1' }), localSubtask({ id: 's2' })]
    await store.deleteSubtask('s1')
    expect(store.subtasks.map(s => s.id)).toEqual(['s2'])
  })

  it('scopes the remote delete to both the row id and the user id', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1' })]
    await store.deleteSubtask('s1')
    expect(sb.from).toHaveBeenCalledWith('subtasks')
    expect(sb.deleteEqId).toHaveBeenCalledWith('id', 's1')
    expect(sb.deleteEqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('leaves state intact for an unknown id', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1' })]
    await store.deleteSubtask('nope')
    expect(store.subtasks).toHaveLength(1)
  })
})

// ── updateSubtaskTitle ────────────────────────────────────────────────────────

describe('updateSubtaskTitle', () => {
  it('trims and applies the new title', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', title: 'Old' })]
    await store.updateSubtaskTitle('s1', '  New title  ')
    expect(store.subtasks[0].title).toBe('New title')
  })

  it('preserves the other fields of the row', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', completed: true, sortOrder: 7 })]
    await store.updateSubtaskTitle('s1', 'Renamed')
    expect(store.subtasks[0]).toMatchObject({ completed: true, sortOrder: 7, taskId: 'task-1' })
  })

  it('rejects an empty title without touching state or Supabase', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', title: 'Keep' })]
    await store.updateSubtaskTitle('s1', '   ')
    expect(store.subtasks[0].title).toBe('Keep')
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('rejects a null title without touching state', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', title: 'Keep' })]
    await store.updateSubtaskTitle('s1', null)
    expect(store.subtasks[0].title).toBe('Keep')
  })

  it('is a no-op for an unknown id', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', title: 'Keep' })]
    await store.updateSubtaskTitle('missing', 'Renamed')
    expect(store.subtasks[0].title).toBe('Keep')
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('persists the renamed row', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', title: 'Old' })]
    await store.updateSubtaskTitle('s1', 'Renamed')
    expect(sb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', title: 'Renamed' }),
      { onConflict: 'id' },
    )
  })
})

// ── hydrateFromSupabase ───────────────────────────────────────────────────────

describe('hydrateFromSupabase', () => {
  it('maps snake_case DB columns onto camelCase local fields', () => {
    const store = useSubtasksStore()
    store.hydrateFromSupabase([
      dbRow({ id: 's1', task_id: 't9', title: 'Mapped', completed: true, sort_order: 3 }),
    ])
    expect(store.subtasks[0]).toEqual({
      id: 's1',
      taskId: 't9',
      title: 'Mapped',
      completed: true,
      sortOrder: 3,
      createdAt: '2026-09-01T10:00:00.000Z',
    })
  })

  it('does not carry through columns outside the mapped set', () => {
    const store = useSubtasksStore()
    store.hydrateFromSupabase([dbRow({ user_id: 'user-1', updated_at: 'whenever' })])
    expect(store.subtasks[0]).not.toHaveProperty('user_id')
    expect(store.subtasks[0]).not.toHaveProperty('updated_at')
  })

  it('falls back to sortOrder 0 when sort_order is null', () => {
    const store = useSubtasksStore()
    store.hydrateFromSupabase([dbRow({ sort_order: null })])
    expect(store.subtasks[0].sortOrder).toBe(0)
  })

  it('falls back to sortOrder 0 when sort_order is absent', () => {
    const store = useSubtasksStore()
    const { sort_order, ...withoutOrder } = dbRow()
    store.hydrateFromSupabase([withoutOrder])
    expect(store.subtasks[0].sortOrder).toBe(0)
  })

  it('keeps an explicit sort_order of 0 rather than coercing it', () => {
    const store = useSubtasksStore()
    store.hydrateFromSupabase([dbRow({ sort_order: 0 })])
    expect(store.subtasks[0].sortOrder).toBe(0)
  })

  it('replaces any previously loaded subtasks', async () => {
    const store = useSubtasksStore()
    await store.addSubtask('t1', 'Stale local row')
    store.hydrateFromSupabase([dbRow({ id: 'fresh' })])
    expect(store.subtasks.map(s => s.id)).toEqual(['fresh'])
  })

  it('treats null input as an empty list', () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask()]
    store.hydrateFromSupabase(null)
    expect(store.subtasks).toEqual([])
  })

  it('treats undefined input as an empty list', () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask()]
    store.hydrateFromSupabase(undefined)
    expect(store.subtasks).toEqual([])
  })

  it('does not write back to Supabase', () => {
    const store = useSubtasksStore()
    store.hydrateFromSupabase([dbRow()])
    expect(sb.from).not.toHaveBeenCalled()
    expect(sb.getUser).not.toHaveBeenCalled()
  })

  it('produces rows that getSubtasksForTask can order', () => {
    const store = useSubtasksStore()
    store.hydrateFromSupabase([
      dbRow({ id: 'b', task_id: 't1', sort_order: 1 }),
      dbRow({ id: 'a', task_id: 't1', sort_order: 0 }),
      dbRow({ id: 'other', task_id: 't2', sort_order: 0 }),
    ])
    expect(store.getSubtasksForTask('t1').map(s => s.id)).toEqual(['a', 'b'])
  })
})

// ── removeSubtasksForTask / clearAll ──────────────────────────────────────────

describe('removeSubtasksForTask', () => {
  it('drops every subtask of the given task and keeps the rest', () => {
    const store = useSubtasksStore()
    store.subtasks = [
      localSubtask({ id: 'a1', taskId: 't1' }),
      localSubtask({ id: 'a2', taskId: 't1' }),
      localSubtask({ id: 'b1', taskId: 't2' }),
    ]
    store.removeSubtasksForTask('t1')
    expect(store.subtasks.map(s => s.id)).toEqual(['b1'])
  })

  it('is local-only: it never issues a remote delete', () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ taskId: 't1' })]
    store.removeSubtasksForTask('t1')
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('is a no-op for a task with no subtasks', () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ taskId: 't1' })]
    store.removeSubtasksForTask('t2')
    expect(store.subtasks).toHaveLength(1)
  })
})

describe('clearAll', () => {
  it('empties local state without touching Supabase', async () => {
    const store = useSubtasksStore()
    await store.addSubtask('t1', 'A')
    await store.addSubtask('t1', 'B')
    vi.clearAllMocks()
    store.clearAll()
    expect(store.subtasks).toEqual([])
    expect(sb.from).not.toHaveBeenCalled()
  })
})

// ── local-only mode (Supabase not configured) ─────────────────────────────────

describe('local-only mode (isSupabaseConfigured === false)', () => {
  beforeEach(() => { sb.configured = false })

  it('still adds subtasks locally', async () => {
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Offline subtask')
    expect(created.title).toBe('Offline subtask')
    expect(store.subtasks).toHaveLength(1)
  })

  it('skips the auth lookup and the write entirely', async () => {
    const store = useSubtasksStore()
    await store.addSubtask('t1', 'Offline subtask')
    expect(sb.getUser).not.toHaveBeenCalled()
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('still toggles and renames locally', async () => {
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Offline subtask')
    await store.toggleSubtask(created.id)
    await store.updateSubtaskTitle(created.id, 'Renamed offline')
    expect(store.subtasks[0].completed).toBe(true)
    expect(store.subtasks[0].title).toBe('Renamed offline')
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('still deletes locally without a remote delete', async () => {
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Offline subtask')
    await store.deleteSubtask(created.id)
    expect(store.subtasks).toEqual([])
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('also degrades when the client itself is null', async () => {
    sb.configured = true
    sb.hasClient = false
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'No client')
    expect(store.subtasks).toHaveLength(1)
    await store.deleteSubtask(created.id)
    expect(store.subtasks).toEqual([])
  })
})

// ── signed-out mode (auth error / no user) ────────────────────────────────────

describe('signed-out mode', () => {
  it('adds locally but skips the write when getUser returns no user', async () => {
    sb.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Anonymous')
    expect(created.title).toBe('Anonymous')
    expect(sb.getUser).toHaveBeenCalled()
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('adds locally but skips the write when getUser reports an auth error', async () => {
    sb.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'jwt expired' } })
    const store = useSubtasksStore()
    await store.addSubtask('t1', 'Expired session')
    expect(store.subtasks).toHaveLength(1)
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('deletes locally but skips the remote delete when there is no user', async () => {
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1' })]
    sb.getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    await store.deleteSubtask('s1')
    expect(store.subtasks).toEqual([])
    expect(sb.from).not.toHaveBeenCalled()
  })
})

// ── persistence failures are swallowed ────────────────────────────────────────

describe('persistence failures', () => {
  let warnSpy
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => warnSpy.mockRestore())

  it('addSubtask resolves and keeps the local row when the upsert throws', async () => {
    sb.upsert.mockRejectedValueOnce(new Error('network down'))
    const store = useSubtasksStore()
    const created = await store.addSubtask('t1', 'Survives failure')
    expect(created).not.toBeNull()
    expect(store.subtasks).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith('[subtasksStore] persistSubtask', 'network down')
  })

  it('toggleSubtask resolves and keeps the flipped value when the upsert throws', async () => {
    sb.upsert.mockRejectedValueOnce(new Error('network down'))
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1', completed: false })]
    await expect(store.toggleSubtask('s1')).resolves.toBeUndefined()
    expect(store.subtasks[0].completed).toBe(true)
  })

  it('deleteSubtask resolves and keeps the row removed when the remote delete throws', async () => {
    sb.deleteEqUser.mockRejectedValueOnce(new Error('row locked'))
    const store = useSubtasksStore()
    store.subtasks = [localSubtask({ id: 's1' })]
    await expect(store.deleteSubtask('s1')).resolves.toBeUndefined()
    expect(store.subtasks).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('[subtasksStore] deleteSubtask', 'row locked')
  })
})
