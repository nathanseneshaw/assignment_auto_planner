/**
 * Planner - month view (the "Month" tab on /planner).
 *
 * MonthCalendar.vue renders a 6x7 grid anchored on the current month, with its
 * own paging controls and an empty state. The month it opens on is whatever
 * month today falls in, so every label is derived from `new Date()`.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, makeTask, seedPlannerData, dayOffset } from '../../fixtures/seed.js'
import { monthHeading, addTaskCellLabel } from '../../mocks/planner.js'

test.describe('planner month view', () => {
  test('opens on the current month with no way back needed', async ({ app, page }) => {
    await app.goto('/planner')
    await page.getByRole('tab', { name: 'Month' }).click()

    await expect(page.getByRole('heading', { level: 1, name: monthHeading(0) })).toBeVisible()
    // "This month" only appears once you have paged away from it.
    await expect(page.getByRole('button', { name: 'This month' })).toHaveCount(0)
  })

  test('pages back and forward through months and returns with This month', async ({ app, page }) => {
    await app.goto('/planner')
    await page.getByRole('tab', { name: 'Month' }).click()

    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByRole('heading', { level: 1, name: monthHeading(-1) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'This month' })).toBeVisible()

    await page.getByRole('button', { name: 'Next month' }).click()
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByRole('heading', { level: 1, name: monthHeading(1) })).toBeVisible()

    await page.getByRole('button', { name: 'This month' }).click()
    await expect(page.getByRole('heading', { level: 1, name: monthHeading(0) })).toBeVisible()
    await expect(page.getByRole('button', { name: 'This month' })).toHaveCount(0)
  })

  test('places seeded work on the day cells it belongs to', async ({ app, page }) => {
    await app.goto('/planner')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Linear Algebra', code: 'MATH 240' })],
      assignments: [
        makeAssignment({ title: 'Eigenvector quiz', courseIndex: 0, dueDate: dayOffset(0) }),
      ],
      tasks: [
        makeTask({ title: 'Review row reduction', courseIndex: 0, scheduledDate: dayOffset(2) }),
      ],
    })

    await page.getByRole('tab', { name: 'Month' }).click()

    await expect(page.getByText('Eigenvector quiz')).toBeVisible()
    await expect(page.getByText('Review row reduction')).toBeVisible()
    // Only in-month cells expose an add-task control, so today's cell is
    // addressable by its own accessible name.
    await expect(page.getByRole('button', { name: addTaskCellLabel(0) })).toHaveCount(1)
    // The course legend lists every course whose colour appears in the grid.
    await expect(page.getByText('MATH 240', { exact: true })).toBeVisible()
  })

  test('shows the empty-calendar copy when nothing is scheduled anywhere', async ({ app, page }) => {
    await app.goto('/planner')
    await page.getByRole('tab', { name: 'Month' }).click()

    await expect(page.getByText('Nothing on the calendar yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible()
  })
})
