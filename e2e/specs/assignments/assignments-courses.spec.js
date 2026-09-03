/**
 * /assignments - the course rail.
 *
 * The right rail lists one chip per course that actually has assignments, each
 * with its own count, and clicking a chip narrows every bucket below it.
 * "All courses" puts the full list back.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

/** A status tab, addressed by its label plus the count badge it renders. */
function statusTab(page, label, count) {
  return page.getByRole('button', { name: `${label} ${count}`, exact: true })
}

/** A course chip in the rail, addressed by its name plus its count. */
function courseChip(page, name, count) {
  return page.getByRole('button', { name: `${name} ${count}`, exact: true })
}

test.describe('course filter', () => {
  test('lists a chip per course that has assignments, with its count', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [
        makeCourse({ name: 'Art History', code: 'ART 100' }),
        makeCourse({ name: 'Biology', code: 'BIO 200' }),
        makeCourse({ name: 'Chemistry', code: 'CHM 300' }),
      ],
      assignments: [
        makeAssignment({ title: 'Cell diagram', courseIndex: 1, dueDate: dayOffset(1) }),
        makeAssignment({ title: 'Lab safety quiz', courseIndex: 1, dueDate: dayOffset(-1) }),
        makeAssignment({ title: 'Titration writeup', courseIndex: 2, dueDate: dayOffset(4) }),
      ],
    })

    await expect(courseChip(page, 'All courses', 3)).toBeVisible()
    await expect(courseChip(page, 'Biology', 2)).toBeVisible()
    await expect(courseChip(page, 'Chemistry', 1)).toBeVisible()
    // A course with no assignments earns no chip.
    await expect(page.getByRole('button', { name: /^Art History/ })).toHaveCount(0)
  })

  test('filtering by course narrows the list and All courses restores it', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Biology', code: 'BIO 200' }), makeCourse({ name: 'Chemistry', code: 'CHM 300' })],
      assignments: [
        makeAssignment({ title: 'Cell diagram', courseIndex: 0, dueDate: dayOffset(1) }),
        makeAssignment({ title: 'Titration writeup', courseIndex: 1, dueDate: dayOffset(4) }),
      ],
    })

    await expect(statusTab(page, 'All', 2)).toBeVisible()

    await courseChip(page, 'Biology', 1).click()

    await expect(page.getByText('Cell diagram')).toBeVisible()
    await expect(page.getByText('Titration writeup')).toHaveCount(0)
    await expect(statusTab(page, 'All', 1)).toBeVisible()
    // The chip counts stay whole-library totals while the list is filtered.
    await expect(courseChip(page, 'All courses', 2)).toBeVisible()

    await courseChip(page, 'All courses', 2).click()

    await expect(page.getByText('Cell diagram')).toBeVisible()
    await expect(page.getByText('Titration writeup')).toBeVisible()
    await expect(statusTab(page, 'All', 2)).toBeVisible()
  })

  test('shows the filtered empty state without the add shortcut', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Biology', code: 'BIO 200' })],
      assignments: [makeAssignment({ title: 'Cell diagram', courseIndex: 0, dueDate: dayOffset(1) })],
    })

    await courseChip(page, 'Biology', 1).click()
    await statusTab(page, 'Overdue', 0).click()

    await expect(page.getByText('Nothing overdue. Nicely done.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New assignment' })).toHaveCount(1)
  })
})
