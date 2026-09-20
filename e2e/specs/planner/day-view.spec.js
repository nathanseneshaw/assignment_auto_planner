/**
 * Planner - day view (/planner, the default view).
 *
 * The page opens on a focused agenda for one day: a date heading driven by the
 * live clock, arrow navigation, the day's tasks and deadlines, and a sidebar
 * rail of what is coming up. Every expected label is derived from `new Date()`
 * through the helpers in e2e/mocks/planner.js, never hard-coded.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, makeTask, seedPlannerData, dayOffset } from '../../fixtures/seed.js'
import { dayHeading } from '../../mocks/planner.js'

test.describe('planner day view', () => {
  test('opens on today with the full date as its heading', async ({ app, page }) => {
    await app.goto('/planner')

    await expect(page.getByRole('heading', { level: 1, name: dayHeading(0) })).toBeVisible()
    // The relative-day eyebrow reads "Today", and the "Today" shortcut button is
    // hidden precisely because today is already selected. Scoped to <main>
    // because the app sidebar carries its own "Today" date stamp.
    const main = page.getByRole('main')
    await expect(main.getByText('Today', { exact: true })).toBeVisible()
    await expect(main.getByRole('button', { name: 'Today' })).toHaveCount(0)
  })

  test('steps forward and back through days and returns with the Today shortcut', async ({ app, page }) => {
    await app.goto('/planner')

    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(page.getByRole('heading', { level: 1, name: dayHeading(1) })).toBeVisible()
    await expect(page.getByText('Tomorrow', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Previous day' }).click()
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.getByRole('heading', { level: 1, name: dayHeading(-1) })).toBeVisible()
    await expect(page.getByText('Yesterday', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Today' }).click()
    await expect(page.getByRole('heading', { level: 1, name: dayHeading(0) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Today' })).toHaveCount(0)
  })

  test('lists the tasks and deadlines scheduled for the selected day', async ({ app, page }) => {
    await app.goto('/planner')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Organic Chemistry', code: 'CHEM 210' })],
      assignments: [
        makeAssignment({ title: 'Lab report 3', courseIndex: 0, dueDate: dayOffset(0) }),
      ],
      tasks: [
        makeTask({ title: 'Draft the discussion', courseIndex: 0, scheduledDate: dayOffset(0) }),
      ],
    })

    await expect(page.getByText('To do · 2 items')).toBeVisible()
    // A deadline shows twice: once on the agenda and once in the Coming up rail.
    await expect(page.getByText('Lab report 3')).toHaveCount(2)
    // Tasks are agenda-only, so this one is unambiguous.
    await expect(page.getByText('Draft the discussion')).toBeVisible()
    // Deadlines are badged "Due"; work blocks are badged by priority ("Task").
    await expect(page.getByText('Due', { exact: true })).toBeVisible()
    await expect(page.getByText('Task', { exact: true })).toBeVisible()
  })

  test('shows the clear-day copy when nothing is scheduled', async ({ app, page }) => {
    await app.goto('/planner')

    await expect(page.getByText('To do · 0 items')).toBeVisible()
    await expect(page.getByText('Your slate is clear for today.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible()
    // Nothing seeded means the sidebar rail is empty too.
    await expect(page.getByText('Nothing on the horizon yet.')).toBeVisible()
  })

  test('opens the day of an upcoming deadline from the Coming up rail', async ({ app, page }) => {
    await app.goto('/planner')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'World History', code: 'HIST 101' })],
      assignments: [
        makeAssignment({ title: 'Essay outline', courseIndex: 0, dueDate: dayOffset(4) }),
      ],
    })

    // The rail entry is a button whose accessible name folds in the date, the
    // title and the course, so match on the title alone.
    await page.getByRole('button', { name: /Essay outline/ }).click()

    await expect(page.getByRole('heading', { level: 1, name: dayHeading(4) })).toBeVisible()
    await expect(page.getByText('To do · 1 item')).toBeVisible()
  })
})
