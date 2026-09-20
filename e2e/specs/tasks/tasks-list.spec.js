/**
 * /tasks - reading and filtering the list.
 *
 * TasksPage buckets every task by comparing its `scheduledDate` against today,
 * so each fixture date comes from `dayOffset(n)`. Offsets are chosen to be
 * bucket-stable whatever weekday the suite runs on: -2 is always Overdue, 0 is
 * always Today, +30 is always Later (the "This Week" bucket ends on Saturday,
 * so it is deliberately not asserted on).
 *
 * The buckets render as <section> elements and nothing in the app shell does,
 * so a section index is the cleanest way to say "this task landed in that
 * group" - the group labels themselves (Overdue, Today...) are reused by the
 * stat cards and the breakdown rail.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeTask, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

/** The bucket sections the page renders, in document order. */
const buckets = (page) => page.locator('section')

test.describe('tasks list', () => {
  test('shows the empty state when nothing has been added', async ({ app, page }) => {
    await app.goto('/tasks')

    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
    await expect(page.getByText('No tasks yet.')).toBeVisible()
    await expect(page.getByText('Add your first study task to get started.')).toBeVisible()
    // The empty state offers its own call to action ("Add task") next to the
    // header's ("Add Task").
    await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible()
    await expect(buckets(page)).toHaveCount(0)
    await expect(page.getByText('0 of 0 tasks complete')).toBeVisible()
  })

  test('sorts tasks into overdue, today, later and no-date buckets', async ({ app, page }) => {
    await app.goto('/tasks')

    await seedPlannerData(app, {
      tasks: [
        makeTask({ title: 'Winter project', scheduledDate: dayOffset(30) }),
        makeTask({ title: 'Someday idea', scheduledDate: null }),
        makeTask({ title: 'Late reading', scheduledDate: dayOffset(-2) }),
        makeTask({ title: 'Morning review', scheduledDate: dayOffset(0) }),
      ],
    })

    await expect(buckets(page)).toHaveCount(4)

    await expect(buckets(page).nth(0)).toContainText('Overdue')
    await expect(buckets(page).nth(0)).toContainText('Late reading')

    await expect(buckets(page).nth(1)).toContainText('Today')
    await expect(buckets(page).nth(1)).toContainText('Morning review')

    await expect(buckets(page).nth(2)).toContainText('Later')
    await expect(buckets(page).nth(2)).toContainText('Winter project')

    await expect(buckets(page).nth(3)).toContainText('No Date')
    await expect(buckets(page).nth(3)).toContainText('Someday idea')
  })

  test('narrows the list to today when the Today tab is selected', async ({ app, page }) => {
    await app.goto('/tasks')

    await seedPlannerData(app, {
      tasks: [
        makeTask({ title: 'Late reading', scheduledDate: dayOffset(-2) }),
        makeTask({ title: 'Morning review', scheduledDate: dayOffset(0) }),
        makeTask({ title: 'Winter project', scheduledDate: dayOffset(30) }),
      ],
    })

    await page.getByRole('button', { name: 'Today', exact: true }).click()

    await expect(buckets(page)).toHaveCount(1)
    await expect(page.getByText('Morning review')).toBeVisible()
    await expect(page.getByText('Late reading')).not.toBeVisible()
    await expect(page.getByText('Winter project')).not.toBeVisible()
  })

  test('shows only completed work when the status filter is set to Completed only', async ({
    app,
    page,
  }) => {
    await app.goto('/tasks')

    await seedPlannerData(app, {
      tasks: [
        makeTask({ title: 'Morning review', scheduledDate: dayOffset(0) }),
        makeTask({ title: 'Filed lab notes', scheduledDate: dayOffset(0), completed: true }),
      ],
    })

    await page.getByRole('button', { name: 'All tasks' }).click()
    await page.getByRole('option', { name: 'Completed only' }).click()

    await expect(page.getByText('Filed lab notes')).toBeVisible()
    await expect(page.getByText('Morning review')).not.toBeVisible()
    // The stats above the list are deliberately independent of the filters.
    await expect(page.getByText('1 of 2 tasks complete')).toBeVisible()
  })

  test('filters by search text and reports when nothing matches', async ({ app, page }) => {
    await app.goto('/tasks')

    await seedPlannerData(app, {
      tasks: [
        makeTask({ title: 'Review lemmas', scheduledDate: dayOffset(0) }),
        makeTask({ title: 'Winter project', scheduledDate: dayOffset(30) }),
      ],
    })

    const search = page.getByPlaceholder('Search tasks')

    await search.fill('lemmas')
    await expect(page.getByText('Review lemmas')).toBeVisible()
    await expect(page.getByText('Winter project')).not.toBeVisible()

    await search.fill('nothing like this')
    await expect(page.getByText('No tasks match your filters.')).toBeVisible()
    await expect(page.getByText('Try a different view or clear the search.')).toBeVisible()
  })
})
