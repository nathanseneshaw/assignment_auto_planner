/**
 * /dashboard - the hero, the three stat cards, today's agenda and the right
 * rail (week ahead, upcoming deadlines, my courses).
 *
 * Everything here is derived state: the page reads the courses, assignments and
 * tasks stores and never fetches. So each test seeds the stores and asserts on
 * the copy the page computes from them - including the "nothing yet" wording,
 * which is what a new account actually sees.
 */
import { test, expect } from '../../fixtures/test.js'
import {
  makeCourse,
  makeAssignment,
  makeTask,
  profileSeed,
  seedPlannerData,
  dayOffset,
} from '../../fixtures/seed.js'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The same "Sep 3" label the dashboard renders for a due date. */
function shortDateLabel(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

test.describe('dashboard', () => {
  test('reflects the seeded courses, assignments and tasks', async ({ app, page }) => {
    app.seedLocalStorage(profileSeed({ name: 'Ada Lovelace' }))
    await app.goto('/dashboard')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Discrete Math', code: 'MATH 220' })],
      assignments: [
        makeAssignment({ title: 'Proof set 4', courseIndex: 0, dueDate: dayOffset(2) }),
        makeAssignment({ title: 'Late reading', courseIndex: 0, dueDate: dayOffset(-3) }),
      ],
      tasks: [
        makeTask({ title: 'Review lemmas', scheduledDate: dayOffset(0) }),
        makeTask({ title: 'Skim notes', scheduledDate: dayOffset(0), completed: true }),
      ],
    })

    // Hero greets the stored profile name.
    await expect(page.getByRole('heading', { level: 1, name: 'Ada' })).toBeVisible()
    await expect(page.getByText('You have 2 tasks lined up for today.')).toBeVisible()

    // Stat cards: today's progress, the next deadline, the overdue nudge.
    await expect(page.getByText('1 done so far')).toBeVisible()
    await expect(page.getByText(`Next · ${shortDateLabel(2)}`)).toBeVisible()
    await expect(page.getByText('Needs attention')).toBeVisible()

    // Today's agenda lists both of today's tasks.
    await expect(page.getByText('Review lemmas')).toBeVisible()
    await expect(page.getByText('Skim notes')).toBeVisible()

    // Right rail: the upcoming deadline, and the course with its open count.
    await expect(page.getByText('Nothing on the horizon yet.')).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Proof set 4' })).toBeVisible()
    // "My courses" counts both assignments as still open.
    await expect(page.getByText('2 left')).toBeVisible()
  })

  test('shows the clear-slate empty state with no data at all', async ({ app, page }) => {
    await app.goto('/dashboard')

    await expect(page.getByText("Today's slate is clear")).toBeVisible()
    await expect(page.getByText('Your slate is clear for today.')).toBeVisible()
    await expect(page.getByText('Add assignments to get tasks scheduled automatically.')).toBeVisible()

    // Every stat card falls back to its own "nothing here" sub-label.
    await expect(page.getByText('Nothing scheduled yet')).toBeVisible()
    await expect(page.getByText('Nothing upcoming')).toBeVisible()
    await expect(page.getByText('All clear')).toBeVisible()
    await expect(page.getByText('Nothing on the horizon yet.')).toBeVisible()
  })

  test('the Today\'s Tasks card opens the tasks page', async ({ app, page }) => {
    await app.goto('/dashboard')

    await page.getByRole('button', { name: "Today's Tasks" }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
    expect(await app.currentPath()).toBe('/tasks')
  })

  test('the empty-state shortcut opens the add-task modal on the tasks page', async ({
    app,
    page,
  }) => {
    await app.goto('/dashboard')

    await page.getByRole('button', { name: 'Add task', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Add New Task' })).toBeVisible()
    expect(await app.currentPath()).toBe('/tasks')
  })
})
