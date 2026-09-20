/**
 * /assignments - reading the list.
 *
 * Covers what the page decides to show: the empty states (one per status tab),
 * how a due date lands an assignment in the overdue / upcoming / archived
 * bucket, the overview counters, and the overdue nudge in the right rail.
 *
 * Every date comes from `dayOffset(n)` because the page buckets by comparing
 * the stored `YYYY-MM-DD` against today.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The same "Sep 3" label the page renders for a due date. */
function shortDateLabel(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** A status tab, addressed by its label plus the count badge it renders. */
function statusTab(page, label, count) {
  return page.getByRole('button', { name: `${label} ${count}`, exact: true })
}

/** The overview row for `label`, i.e. the wrapper holding the label + value. */
function overviewRow(page, label) {
  return page.getByText(label, { exact: true }).locator('xpath=..')
}

test.describe('assignments list', () => {
  test('shows the empty state when nothing has been added', async ({ app, page }) => {
    await app.goto('/assignments')

    await expect(page.getByRole('heading', { level: 1, name: 'Assignments' })).toBeVisible()
    await expect(page.getByText('No assignments yet.')).toBeVisible()
    await expect(page.getByText('Add one manually or connect a calendar feed.')).toBeVisible()
    // The empty state offers its own call to action alongside the header button.
    await expect(page.getByRole('button', { name: 'New assignment' }).last()).toBeVisible()
  })

  test('gives each status tab its own empty copy', async ({ app, page }) => {
    await app.goto('/assignments')

    await statusTab(page, 'Overdue', 0).click()
    await expect(page.getByText('Nothing overdue. Nicely done.')).toBeVisible()
    await expect(page.getByText('all caught up here')).toBeVisible()

    await statusTab(page, 'Upcoming', 0).click()
    await expect(page.getByText('Nothing due in the next 7 days.')).toBeVisible()
    await expect(page.getByText('clear for now')).toBeVisible()

    await statusTab(page, 'Completed', 0).click()
    await expect(page.getByText('Nothing completed yet.')).toBeVisible()
    await expect(page.getByText('collect here')).toBeVisible()
    // Off the "All" tab the page drops the add call to action.
    await expect(page.getByRole('button', { name: 'New assignment' })).toHaveCount(1)
  })

  test('puts an assignment due two days ago in the overdue bucket', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [
        makeAssignment({ title: 'Late lab', courseIndex: 0, dueDate: dayOffset(-2) }),
        makeAssignment({ title: 'Reading response', courseIndex: 0, dueDate: dayOffset(3) }),
      ],
    })

    await expect(statusTab(page, 'Overdue', 1)).toBeVisible()
    // Overdue rows carry an up-arrow marker in front of the due date.
    await expect(page.getByText(new RegExp(`↑\\s*${shortDateLabel(-2)}`))).toBeVisible()

    await statusTab(page, 'Overdue', 1).click()
    await expect(page.getByText('Late lab')).toBeVisible()
    await expect(page.getByText('Reading response')).toHaveCount(0)
  })

  test('puts an assignment due in three days in the next seven days', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [
        makeAssignment({ title: 'Reading response', courseIndex: 0, dueDate: dayOffset(3) }),
        makeAssignment({ title: 'Late lab', courseIndex: 0, dueDate: dayOffset(-2) }),
      ],
    })

    await expect(statusTab(page, 'Upcoming', 1)).toBeVisible()
    await statusTab(page, 'Upcoming', 1).click()

    await expect(page.getByText('Reading response')).toBeVisible()
    // The row renders the short due date; the overdue nudge repeats it, so take the row's.
    await expect(page.getByText(shortDateLabel(3), { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Late lab')).toHaveCount(0)
  })

  test('keeps a completed assignment out of the active buckets', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [
        makeAssignment({ title: 'Finished essay', courseIndex: 0, dueDate: dayOffset(2), status: 'completed' }),
      ],
    })

    await expect(statusTab(page, 'Completed', 1)).toBeVisible()
    await expect(statusTab(page, 'Upcoming', 0)).toBeVisible()
    await expect(statusTab(page, 'Overdue', 0)).toBeVisible()

    await statusTab(page, 'Completed', 1).click()
    await expect(page.getByText('Finished essay')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark active again' })).toBeVisible()
  })

  test('reveals the archived tab only once something has left the feed', async ({ app, page }) => {
    await app.goto('/assignments')

    await expect(page.getByRole('button', { name: /^Archived/ })).toHaveCount(0)

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [
        makeAssignment({
          title: 'Dropped essay',
          courseIndex: 0,
          dueDate: dayOffset(-4),
          feedStatus: 'archived',
          importSource: 'ics',
        }),
      ],
    })

    await expect(statusTab(page, 'Archived', 1)).toBeVisible()
    // Archived work is excluded from the active buckets.
    await expect(statusTab(page, 'Overdue', 0)).toBeVisible()

    await statusTab(page, 'Archived', 1).click()
    await expect(page.getByText('Dropped essay')).toBeVisible()
    // The row wears its own archived badge, explained by a tooltip.
    await expect(
      page.getByTitle('Archived after leaving your calendar feed. Kept here for your records.')
    ).toBeVisible()
    await expect(page.getByText('Calendar feed')).toBeVisible()
  })

  test('counts every bucket in the overview panel', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [
        makeAssignment({ title: 'Late lab', courseIndex: 0, dueDate: dayOffset(-2) }),
        makeAssignment({ title: 'Reading response', courseIndex: 0, dueDate: dayOffset(3) }),
        makeAssignment({ title: 'Finished essay', courseIndex: 0, dueDate: dayOffset(1), status: 'completed' }),
      ],
    })

    await expect(overviewRow(page, 'Total')).toHaveText(/Total\s*3/)
    await expect(overviewRow(page, 'Overdue')).toHaveText(/Overdue\s*1/)
    await expect(overviewRow(page, 'Upcoming')).toHaveText(/Upcoming\s*1/)
    await expect(overviewRow(page, 'Completed')).toHaveText(/Completed\s*1/)
    await expect(statusTab(page, 'All', 3)).toBeVisible()
  })

  test('nudges about overdue work in the right rail', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [makeAssignment({ title: 'Late lab', courseIndex: 0, dueDate: dayOffset(-2) })],
    })

    // With nothing upcoming the nudge falls back to its "past due" wording.
    await expect(page.getByText(/past due\. Let.s clear them to get back on track\./)).toBeVisible()

    await seedPlannerData(app, {
      assignments: [makeAssignment({ title: 'Reading response', dueDate: dayOffset(3) })],
    })

    // Once there is a heaviest upcoming day the nudge points at that date.
    await expect(page.getByText('Catch up before')).toBeVisible()
    await expect(page.getByText(shortDateLabel(3), { exact: true }).first()).toBeVisible()
  })
})
