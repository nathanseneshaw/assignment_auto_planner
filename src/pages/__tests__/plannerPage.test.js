import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-id'),
}))
vi.mock('../../services/taskSync', () => ({
  persistTaskToSupabase: vi.fn().mockResolvedValue({ status: 'ok', id: 'sb-task-id' }),
  deleteTaskFromSupabase: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../utils/assignmentDisplay.js', () => ({
  resolveAssignmentCourseName: vi.fn(() => ''),
  importSourceLabel: vi.fn(() => ''),
}))

import PlannerPage from '../PlannerPage.vue'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'

// Stub heavy child components so mounting stays fast
const stubs = {
  TaskFormModal: true,
  MonthCalendar: true,
  Modal: true,
  Input: true,
  Dropdown: true,
  DatePicker: true,
  Button: true,
}

// June 15 2026 noon local — avoids UTC-midnight string parsing shifting the date
// one day back in US timezones, which would make `new Date()` return June 14.
const TODAY = '2026-06-15'
const TODAY_LOCAL_NOON = new Date(2026, 5, 15, 12, 0, 0)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(TODAY_LOCAL_NOON)
})

afterEach(() => vi.useRealTimers())

// ── mount ─────────────────────────────────────────────────────────────────────

describe('PlannerPage mount', () => {
  it('mounts without throwing', async () => {
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises()
    expect(w.html()).toBeTruthy()
  })

  it('renders the day heading for today', async () => {
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    // heading = "Monday, June 15" (2026-06-15 is a Monday)
    expect(w.find('h1').text()).toContain('June 15')
  })

  it('shows "Today" as the relative day label', async () => {
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Today')
  })
})

// ── day item rendering ────────────────────────────────────────────────────────

describe('PlannerPage day items', () => {
  it('shows a task scheduled for today', async () => {
    useTasksStore().hydrateFromSupabase([
      { id: 't1', title: 'Write essay', scheduledDate: TODAY, completed: false, priority: 1 },
    ])
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.html()).toContain('Write essay')
  })

  it('does not show a task scheduled for a different day', async () => {
    useTasksStore().hydrateFromSupabase([
      { id: 't1', title: 'Future task', scheduledDate: '2026-06-20', completed: false, priority: 1 },
    ])
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.html()).not.toContain('Future task')
  })

  it('shows an assignment due today', async () => {
    useAssignmentsStore().assignments.push({
      id: 'a1', title: 'Problem Set 3', dueDate: TODAY, status: 'pending', feedStatus: 'live',
    })
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.html()).toContain('Problem Set 3')
  })

  it('does not include an assignment due on a different day in the day-view to-do list', async () => {
    useAssignmentsStore().assignments.push({
      id: 'a1', title: 'Next Week Assignment', dueDate: '2026-06-22', status: 'pending',
    })
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    // The assignment appears in the "coming up" rail but today's to-do count stays 0
    expect(w.text()).toContain('To do · 0 items')
  })

  it('shows both a task and an assignment due today', async () => {
    useTasksStore().hydrateFromSupabase([
      { id: 't1', title: 'Study notes', scheduledDate: TODAY, completed: false, priority: 1 },
    ])
    useAssignmentsStore().assignments.push({
      id: 'a1', title: 'Lab Report', dueDate: TODAY, status: 'pending',
    })
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.html()).toContain('Study notes')
    expect(w.html()).toContain('Lab Report')
  })
})

// ── item count / mood copy ────────────────────────────────────────────────────

describe('PlannerPage day mood copy', () => {
  it('shows a clear-day message when nothing is due', async () => {
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.text()).toMatch(/clear|Nothing's due/i)
  })

  it('shows a light-day message with 1–2 items', async () => {
    useTasksStore().hydrateFromSupabase([
      { id: 't1', title: 'One thing', scheduledDate: TODAY, completed: false, priority: 1 },
    ])
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('A light day')
  })

  it('shows a full-day message with 5+ items', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `Task ${i}`, scheduledDate: TODAY, completed: false, priority: i + 1,
    }))
    useTasksStore().hydrateFromSupabase(tasks)
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('A full day')
  })
})

// ── item sort order ───────────────────────────────────────────────────────────

describe('PlannerPage item sort order', () => {
  it('renders assignments before tasks in the day list', async () => {
    useTasksStore().hydrateFromSupabase([
      { id: 't1', title: 'My Task', scheduledDate: TODAY, completed: false, priority: 1 },
    ])
    useAssignmentsStore().assignments.push({
      id: 'a1', title: 'My Assignment', dueDate: TODAY, status: 'pending',
    })
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    const html = w.html()
    expect(html.indexOf('My Assignment')).toBeLessThan(html.indexOf('My Task'))
  })

  it('renders completed items after incomplete ones', async () => {
    useTasksStore().hydrateFromSupabase([
      { id: 't1', title: 'Done Task', scheduledDate: TODAY, completed: true, priority: 1 },
      { id: 't2', title: 'Pending Task', scheduledDate: TODAY, completed: false, priority: 2 },
    ])
    const w = mount(PlannerPage, { global: { stubs } })
    await flushPromises(); await nextTick()
    const html = w.html()
    expect(html.indexOf('Pending Task')).toBeLessThan(html.indexOf('Done Task'))
  })
})
