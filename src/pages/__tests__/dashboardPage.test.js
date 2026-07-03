import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
// Stores fire best-effort persists on mutation; stub the network layer so the
// dashboard's toggle/seed paths stay local and synchronous.
vi.mock('../../services/lmsSupabaseSync', () => ({
  persistAssignmentToSupabase: vi.fn().mockResolvedValue('sb-id'),
  persistCourseToSupabase: vi.fn().mockResolvedValue('sb-id'),
  deleteCourseAndAssignmentsFromSupabase: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/taskSync', () => ({
  persistTaskToSupabase: vi.fn().mockResolvedValue({ status: 'ok', id: 'sb-task-id' }),
  deleteTaskFromSupabase: vi.fn().mockResolvedValue(undefined),
}))

import DashboardPage from '../DashboardPage.vue'
import { useTasksStore } from '../../stores/tasks'
import { useAssignmentsStore } from '../../stores/assignments'
import { useProfileStore } from '../../stores/profile'

// June 15 2026 noon local — noon avoids UTC-midnight string parsing shifting the
// date one day back in US timezones, and 12:00 lands the greeting on "afternoon".
const TODAY = '2026-06-15'
const TODAY_LOCAL_NOON = new Date(2026, 5, 15, 12, 0, 0)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(TODAY_LOCAL_NOON)
})

afterEach(() => vi.useRealTimers())

// ── seed helpers ────────────────────────────────────────────────────────────

function seedTasks(tasks) {
  useTasksStore().hydrateFromSupabase(tasks)
}

function seedAssignments(assignments) {
  useAssignmentsStore().assignments.push(...assignments)
}

/** A fully populated dashboard: 2 today-tasks (1 done), 3 upcoming, 1 overdue,
 *  2 historically-completed assignments. */
function seedFullDashboard() {
  useProfileStore().updateProfile({ name: 'Nathan Smith' })
  seedTasks([
    { id: 't1', title: 'Outline lab report', scheduledDate: TODAY, completed: false, priority: 1, priorityLevel: 'urgent', courseName: 'CHEM 201' },
    { id: 't2', title: 'Email professor', scheduledDate: TODAY, completed: true, priority: 2, priorityLevel: 'normal' },
    { id: 't3', title: 'Future task', scheduledDate: '2026-06-20', completed: false, priority: 3 },
  ])
  seedAssignments([
    { id: 'a-up1', title: 'Essay Draft', dueDate: '2026-06-16', status: 'pending', feedStatus: 'live', courseName: 'ENGL 101' },
    { id: 'a-up2', title: 'Problem Set 5', dueDate: '2026-06-18', status: 'pending', feedStatus: 'live', courseName: 'MATH 210' },
    { id: 'a-up3', title: 'Reading Response', dueDate: '2026-06-20', status: 'pending', feedStatus: 'live', courseName: 'HIST 150' },
    { id: 'a-od1', title: 'Late Lab', dueDate: '2026-06-10', status: 'pending', feedStatus: 'live', courseName: 'PHYS 105' },
    { id: 'a-c1', title: 'Quiz 1', dueDate: '2026-06-12', status: 'completed', completedAt: '2026-06-12T10:00:00', courseName: 'BIO 100' },
    { id: 'a-c2', title: 'Quiz 2', dueDate: '2026-06-05', status: 'completed', completedAt: '2026-06-05T10:00:00', courseName: 'BIO 100' },
  ])
}

const mountDashboard = () => mount(DashboardPage)

// ── mount / hero ────────────────────────────────────────────────────────────

describe('DashboardPage mount + hero', () => {
  it('mounts without throwing on an empty dashboard', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.html()).toBeTruthy()
  })

  it('renders the first name from the profile in the hero heading', async () => {
    useProfileStore().updateProfile({ name: 'Nathan Smith' })
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.find('h1').text()).toContain('Nathan')
  })

  it('falls back to "Welcome" when no name is set', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.find('h1').text()).toContain('Welcome')
  })

  it('shows the afternoon greeting at noon', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Good afternoon')
  })

  it('shows the morning greeting before noon', async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0))
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Good morning')
  })

  it('shows the evening greeting after 6pm', async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 20, 0, 0))
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Good evening')
  })

  it('summarises today\'s workload in the hero subtitle', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    // 2 tasks scheduled today → "You have 2 tasks lined up for today."
    expect(w.text()).toContain('You have 2 tasks lined up for today')
    // 1 overdue assignment feeds the italic warning clause.
    expect(w.text()).toContain('1 overdue assignment')
  })
})

// ── stat cards ──────────────────────────────────────────────────────────────

describe('DashboardPage stat cards', () => {
  it('renders exactly three stat cards with their labels', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    const cards = w.find('.grid-cols-3').findAll('div')
    expect(cards).toHaveLength(3)
    expect(cards[0].text()).toContain("Today's Tasks")
    expect(cards[1].text()).toContain('Upcoming')
    expect(cards[2].text()).toContain('Overdue')
  })

  it('passes the completed/total task ratio into the first card', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    const cards = w.find('.grid-cols-3').findAll('div')
    // 1 of today's 2 tasks is complete.
    expect(cards[0].find('.display').text()).toBe('1/2')
    expect(cards[0].text()).toContain('1 done so far')
  })

  it('passes the upcoming-assignment count into the second card', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    const cards = w.find('.grid-cols-3').findAll('div')
    expect(cards[1].find('.display').text()).toBe('3')
    // Sub-label points at the nearest deadline (Jun 16).
    expect(cards[1].text()).toContain('Next')
    expect(cards[1].text()).toContain('Jun 16')
  })

  it('passes the overdue count into the third card', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    const cards = w.find('.grid-cols-3').findAll('div')
    expect(cards[2].find('.display').text()).toBe('1')
    expect(cards[2].text()).toContain('Needs attention')
  })

  it('shows all-zero counts and reassuring sub-labels when empty', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    const cards = w.find('.grid-cols-3').findAll('div')
    expect(cards[0].find('.display').text()).toBe('0/0')
    expect(cards[0].text()).toContain('Nothing scheduled yet')
    expect(cards[1].find('.display').text()).toBe('0')
    expect(cards[1].text()).toContain('Nothing upcoming')
    expect(cards[2].find('.display').text()).toBe('0')
    expect(cards[2].text()).toContain('All clear')
  })
})

// ── today's tasks list ──────────────────────────────────────────────────────

describe('DashboardPage today\'s tasks', () => {
  it('renders each of today\'s tasks with its title and course label', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Outline lab report')
    expect(w.text()).toContain('CHEM 201')
    expect(w.text()).toContain('Email professor')
  })

  it('does not list tasks scheduled for another day', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).not.toContain('Future task')
  })

  it('shows the empty state and an add-task CTA when nothing is scheduled', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Your slate is clear for today')
    expect(w.text()).toContain('Add task')
  })

  it('toggling a task updates the completed ratio in the stat card', async () => {
    seedTasks([
      { id: 't1', title: 'Only task', scheduledDate: TODAY, completed: false, priority: 1, priorityLevel: 'normal' },
    ])
    const w = mountDashboard()
    await flushPromises(); await nextTick()

    const cards = w.find('.grid-cols-3').findAll('div')
    expect(cards[0].find('.display').text()).toBe('0/1')

    // The task row carries the click handler that toggles completion.
    await w.findAll('.cursor-pointer')[0].trigger('click')
    await flushPromises(); await nextTick()

    expect(cards[0].find('.display').text()).toBe('1/1')
    expect(useTasksStore().tasks[0].completed).toBe(true)
  })
})

// ── activity heatmap ────────────────────────────────────────────────────────

describe('DashboardPage activity', () => {
  it('renders the section with the 14-week label', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Activity')
    expect(w.text()).toContain('Past 14 weeks')
  })

  it('counts every completed assignment in the semester total', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    // Two assignments carry status 'completed'.
    expect(w.text()).toContain('2 assignments completed this semester')
  })

  it('reports zero completed when there is no history', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('0 assignments completed this semester')
  })
})

// ── right rail ──────────────────────────────────────────────────────────────

describe('DashboardPage right rail', () => {
  it('always renders the weekly planner shortcut', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Weekly planner')
  })

  it('lists upcoming deadlines with title and short date', async () => {
    seedFullDashboard()
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Upcoming deadlines')
    expect(w.text()).toContain('Essay Draft')
    expect(w.text()).toContain('Jun 16')
    expect(w.text()).toContain('Problem Set 5')
    expect(w.text()).toContain('Reading Response')
  })

  it('caps the rail at four upcoming deadlines', async () => {
    useAssignmentsStore().assignments.push(
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `a${i}`,
        title: `Deadline ${i}`,
        dueDate: `2026-06-${17 + i}`,
        status: 'pending',
        feedStatus: 'live',
      })),
    )
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Deadline 0')
    expect(w.text()).toContain('Deadline 3')
    // The rail slices to the first four; the fifth/sixth stay off it.
    expect(w.text()).not.toContain('Deadline 4')
    expect(w.text()).not.toContain('Deadline 5')
  })

  it('shows the overdue alert only when something is overdue', async () => {
    const empty = mountDashboard()
    await flushPromises(); await nextTick()
    expect(empty.text()).not.toContain('Review overdue')

    setActivePinia(createPinia())
    seedAssignments([
      { id: 'a-od1', title: 'Late Lab', dueDate: '2026-06-10', status: 'pending', feedStatus: 'live' },
    ])
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Review overdue')
    expect(w.text()).toContain('1 Overdue')
  })

  it('shows an empty-rail message when nothing is upcoming', async () => {
    const w = mountDashboard()
    await flushPromises(); await nextTick()
    expect(w.text()).toContain('Nothing on the horizon yet')
  })
})
