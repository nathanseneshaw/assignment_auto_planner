import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))

// useRoute is read on mount for the ?new=1 deep-link; keep the query mutable so
// individual tests can flip it. useRouter.replace is called to strip the flag.
const { routeMock, routerMock } = vi.hoisted(() => ({
  routeMock: { query: {} },
  routerMock: { push: vi.fn(), replace: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => routerMock,
}))

vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-id'),
  deleteCourseAndAssignmentsFromSupabase: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/taskSync', () => ({
  persistTaskToSupabase: vi.fn().mockResolvedValue({ status: 'ok', id: 'sb-task-id' }),
  deleteTaskFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

import TasksPage from '../TasksPage.vue'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'
import { useSubtasksStore } from '../../stores/subtasks'

// 2026-06-15 is a Monday; noon avoids UTC-midnight date drift. Week end is
// Saturday 2026-06-20, which drives the This Week / Later bucket boundary.
const TODAY = '2026-06-15'
const TODAY_LOCAL_NOON = new Date(2026, 5, 15, 12, 0, 0)

// Custom stubs expose modelValue (open/closed) + key props via data-attributes
// so tests can assert wiring without depending on the real modal internals.
const TaskFormModalStub = {
  name: 'TaskFormModal',
  props: ['modelValue', 'task'],
  template: `<div class="tfm-stub" :data-open="String(modelValue)" :data-task="task ? task.title : ''"></div>`,
}
const ConfirmDialogStub = {
  name: 'ConfirmDialog',
  props: ['modelValue', 'message', 'title'],
  template: `<div class="cd-stub" :data-open="String(modelValue)">{{ message }}</div>`,
}
const stubs = { TaskFormModal: TaskFormModalStub, ConfirmDialog: ConfirmDialogStub, Dropdown: true }
const mountTasks = () => mount(TasksPage, { global: { stubs } })

beforeEach(() => {
  setActivePinia(createPinia())
  routeMock.query = {}
  routerMock.push.mockClear()
  routerMock.replace.mockClear()
  vi.useFakeTimers()
  vi.setSystemTime(TODAY_LOCAL_NOON)
})

afterEach(() => vi.useRealTimers())

// ── seed helpers ────────────────────────────────────────────────────────────

function seedTasks(tasks) {
  useTasksStore().hydrateFromSupabase(tasks)
}

/** One task per bucket + a completed one, a group, a linked assignment,
 *  and subtasks — enough to exercise every branch of the page. */
function seedFullBoard() {
  seedTasks([
    { id: 't-od', title: 'Overdue reading', scheduledDate: '2026-06-10', completed: false, priority: 1, priorityLevel: 'urgent', group: 'Reading' },
    { id: 't-today', title: 'Today study', scheduledDate: TODAY, completed: false, priority: 2, priorityLevel: 'high', courseName: 'MATH 210', assignmentId: 'a1' },
    { id: 't-today-done', title: 'Finished today', scheduledDate: TODAY, completed: true, priority: 3, priorityLevel: 'normal' },
    { id: 't-week', title: 'Week task', scheduledDate: '2026-06-18', completed: false, priority: 1, group: 'Reading' },
    { id: 't-later', title: 'Later task', scheduledDate: '2026-06-25', completed: false, priority: 1 },
    { id: 't-none', title: 'Someday task', completed: false, priority: 1 },
  ])
  useAssignmentsStore().assignments.push({ id: 'a1', title: 'Problem Set 5', dueDate: '2026-06-15', status: 'pending' })
  useSubtasksStore().subtasks.push(
    { id: 's1', taskId: 't-today', title: 'Sub A', completed: true, sortOrder: 0 },
    { id: 's2', taskId: 't-today', title: 'Sub B', completed: false, sortOrder: 1 },
  )
}

// ── query helpers ───────────────────────────────────────────────────────────

function statCard(w, label) {
  const cards = w.find('.grid-cols-2').findAll('div')
  const card = cards.find((c) => c.find('.eyebrow').text() === label)
  return card ? card.find('.display').text() : null
}

function sectionByLabel(w, label) {
  return w.findAll('section').find((s) => s.find('.eyebrow').text() === label)
}

function taskRow(w, title) {
  return w.findAll('.cursor-pointer').find((r) => r.text().includes(title))
}

function breakdownValue(w, label) {
  const row = w.find('aside').findAll('.border-dotted').find((r) => r.text().includes(label))
  return row ? row.findAll('span')[1].text() : null
}

// ── mount / header / meta ─────────────────────────────────────────────────────

describe('TasksPage mount + header', () => {
  it('mounts without throwing on an empty board', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.html()).toBeTruthy()
  })

  it('renders the page title', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.find('h1').text()).toBe('Tasks')
  })

  it('summarises today + overdue in the meta bar', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    const meta = w.find('.eyebrow')
    expect(meta.text()).toContain('1/2 Today')
    expect(meta.text()).toContain('1 Overdue')
  })

  it('shows "On track" when nothing is overdue', async () => {
    seedTasks([{ id: 't1', title: 'A task', scheduledDate: TODAY, completed: false, priority: 1 }])
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.find('.eyebrow').text()).toContain('On track')
  })
})

// ── stat cards ────────────────────────────────────────────────────────────────

describe('TasksPage stat cards', () => {
  it('renders four labelled stat cards', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    const cards = w.find('.grid-cols-2').findAll('div')
    expect(cards).toHaveLength(4)
    expect(cards.map((c) => c.find('.eyebrow').text())).toEqual(['Total', 'Completed', 'Overdue', 'Due Today'])
  })

  it('passes the correct value into each stat card', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(statCard(w, 'Total')).toBe('6')
    expect(statCard(w, 'Completed')).toBe('1')
    expect(statCard(w, 'Overdue')).toBe('1')
    expect(statCard(w, 'Due Today')).toBe('2')
  })

  it('shows zeros on an empty board', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(statCard(w, 'Total')).toBe('0')
    expect(statCard(w, 'Completed')).toBe('0')
    expect(statCard(w, 'Overdue')).toBe('0')
    expect(statCard(w, 'Due Today')).toBe('0')
  })
})

// ── progress rail ─────────────────────────────────────────────────────────────

describe('TasksPage progress rail', () => {
  it('renders the completion percentage and count', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    const rail = w.find('aside')
    // 1 of 6 complete → 17%.
    expect(rail.text()).toContain('17')
    expect(rail.text()).toContain('of 6 tasks complete')
  })

  it('passes every breakdown value into the rail', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(breakdownValue(w, 'Total')).toBe('6')
    expect(breakdownValue(w, 'Completed')).toBe('1')
    expect(breakdownValue(w, 'Remaining')).toBe('5')
    expect(breakdownValue(w, 'Overdue')).toBe('1')
    expect(breakdownValue(w, 'Due today')).toBe('2')
  })

  it('shows 0% with no tasks', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.find('aside').text()).toContain('of 0 tasks complete')
  })
})

// ── buckets ───────────────────────────────────────────────────────────────────

describe('TasksPage buckets', () => {
  it('renders every non-empty bucket with its done/total count', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    const labels = w.findAll('section').map((s) => s.find('.eyebrow').text())
    expect(labels).toEqual(['Overdue', 'Today', 'This Week', 'Later', 'No Date'])

    expect(sectionByLabel(w, 'Overdue').text()).toContain('0/1')
    expect(sectionByLabel(w, 'Today').text()).toContain('1/2')
  })

  it('places each task in the correct bucket', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(sectionByLabel(w, 'Overdue').text()).toContain('Overdue reading')
    expect(sectionByLabel(w, 'Today').text()).toContain('Today study')
    expect(sectionByLabel(w, 'Today').text()).toContain('Finished today')
    expect(sectionByLabel(w, 'This Week').text()).toContain('Week task')
    expect(sectionByLabel(w, 'Later').text()).toContain('Later task')
    expect(sectionByLabel(w, 'No Date').text()).toContain('Someday task')
  })
})

// ── task row detail ───────────────────────────────────────────────────────────

describe('TasksPage task row detail', () => {
  it('renders priority badge, course, and linked assignment for a task', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    const row = taskRow(w, 'Today study')
    expect(row.text()).toContain('High')            // priorityLevel: 'high'
    expect(row.text()).toContain('MATH 210')        // courseName
    expect(row.text()).toContain('Problem Set 5')   // linked assignment title
  })

  it('flags an overdue task with its date label', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    // 2026-06-10 is a Wednesday.
    expect(taskRow(w, 'Overdue reading').text()).toContain('Wed, Jun 10')
  })

  it('reveals subtasks when a task row is expanded', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    // Subtasks are hidden until the row is clicked.
    expect(w.text()).not.toContain('Sub A')
    await taskRow(w, 'Today study').trigger('click')
    await nextTick()
    expect(w.text()).toContain('Sub A')
    expect(w.text()).toContain('Sub B')
  })
})

// ── filters ───────────────────────────────────────────────────────────────────

describe('TasksPage filters', () => {
  it('narrows to today when the Today date tab is selected', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    await w.findAll('button').find((b) => b.text() === 'Today').trigger('click')
    await nextTick()
    const labels = w.findAll('section').map((s) => s.find('.eyebrow').text())
    expect(labels).toEqual(['Today'])
    expect(w.text()).not.toContain('Overdue reading')
    expect(w.text()).toContain('Today study')
  })

  it('filters tasks by the search query', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    await w.find('input[type="text"]').setValue('week')
    await nextTick()
    expect(w.text()).toContain('Week task')
    expect(w.text()).not.toContain('Today study')
    expect(w.text()).not.toContain('Someday task')
  })
})

// ── groups ────────────────────────────────────────────────────────────────────

describe('TasksPage groups', () => {
  it('renders a chip per group and counts them in the rail', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    // The 'Reading' group has two tasks (t-od + t-week).
    const railGroupBtn = w.find('aside').findAll('button').find((b) => b.text().includes('Reading'))
    expect(railGroupBtn).toBeTruthy()
    expect(railGroupBtn.text()).toContain('2')
  })

  it('filtering by a group hides tasks outside it', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    // Click the 'Reading' group in the rail to filter.
    await w.find('aside').findAll('button').find((b) => b.text().includes('Reading')).trigger('click')
    await nextTick()
    expect(w.text()).toContain('Overdue reading')
    expect(w.text()).toContain('Week task')
    expect(w.text()).not.toContain('Today study')
    expect(w.text()).not.toContain('Someday task')
  })
})

// ── empty states ──────────────────────────────────────────────────────────────

describe('TasksPage empty states', () => {
  it('shows the first-run empty state with an add CTA', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.findAll('section')).toHaveLength(0)
    expect(w.text()).toContain('No tasks yet.')
    expect(w.findAll('button').some((b) => b.text() === 'Add task')).toBe(true)
  })

  it('shows a filtered empty state without an add CTA', async () => {
    seedFullBoard()
    const w = mountTasks()
    await flushPromises(); await nextTick()
    await w.find('input[type="text"]').setValue('zzz-no-match')
    await nextTick()
    expect(w.text()).toContain('No tasks match your filters.')
    expect(w.findAll('button').some((b) => b.text() === 'Add task')).toBe(false)
  })
})

// ── modals + CRUD wiring ──────────────────────────────────────────────────────

describe('TasksPage modals', () => {
  it('keeps the task modal closed on first render', async () => {
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.find('.tfm-stub').attributes('data-open')).toBe('false')
  })

  it('opens the add-task modal (no editing task) via the header button', async () => {
    seedTasks([{ id: 't1', title: 'A task', scheduledDate: TODAY, completed: false, priority: 1 }])
    const w = mountTasks()
    await flushPromises(); await nextTick()
    await w.findAll('button').find((b) => b.text() === 'Add Task').trigger('click')
    await nextTick()
    const modal = w.find('.tfm-stub')
    expect(modal.attributes('data-open')).toBe('true')
    expect(modal.attributes('data-task')).toBe('')
  })

  it('opens the edit modal pre-loaded with the clicked task', async () => {
    seedTasks([{ id: 't1', title: 'Edit me', scheduledDate: TODAY, completed: false, priority: 1 }])
    const w = mountTasks()
    await flushPromises(); await nextTick()
    await w.findAll('button').find((b) => b.text().includes('Edit')).trigger('click')
    await nextTick()
    const modal = w.find('.tfm-stub')
    expect(modal.attributes('data-open')).toBe('true')
    expect(modal.attributes('data-task')).toBe('Edit me')
  })

  it('opens the add-task modal from the ?new=1 deep-link', async () => {
    routeMock.query = { new: '1' }
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.find('.tfm-stub').attributes('data-open')).toBe('true')
    // The flag is stripped so a refresh does not reopen it.
    expect(routerMock.replace).toHaveBeenCalled()
  })

  it('opens the delete confirmation with the task title in its message', async () => {
    seedTasks([{ id: 't1', title: 'Kill this task', scheduledDate: TODAY, completed: false, priority: 1 }])
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(w.find('.cd-stub').attributes('data-open')).toBe('false')
    await w.find('button[title="Delete task"]').trigger('click')
    await nextTick()
    const dialog = w.find('.cd-stub')
    expect(dialog.attributes('data-open')).toBe('true')
    expect(dialog.text()).toContain('Kill this task')
  })
})

// ── completion toggle ─────────────────────────────────────────────────────────

describe('TasksPage completion toggle', () => {
  it('toggling the checkbox updates the completed stat and progress', async () => {
    seedTasks([{ id: 't1', title: 'Only task', scheduledDate: TODAY, completed: false, priority: 1 }])
    const w = mountTasks()
    await flushPromises(); await nextTick()
    expect(statCard(w, 'Completed')).toBe('0')

    await w.find('button[title="Mark complete"]').trigger('click')
    await flushPromises(); await nextTick()

    expect(statCard(w, 'Completed')).toBe('1')
    expect(w.find('aside').text()).toContain('100')
    expect(useTasksStore().tasks[0].completed).toBe(true)
  })
})
