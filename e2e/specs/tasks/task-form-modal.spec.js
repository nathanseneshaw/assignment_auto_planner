/**
 * The add/edit task modal, driven from /tasks.
 *
 * TaskFormModal is teleported to <body>, and so are the popovers it opens (the
 * date calendar and both dropdown panels). That is why the modal is addressed
 * through `taskModal()` rather than a page-level query: the header's "Add Task"
 * button and the modal's submit button would otherwise be the same locator.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, makeTask, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

/** The teleported modal panel, identified by the heading it renders. */
function taskModal(page) {
  return page
    .locator('body > div')
    .filter({ has: page.getByRole('heading', { name: /Add New Task|Edit Task/ }) })
}

/** The header's "Add Task" button - distinct from the empty state's "Add task". */
async function openAddModal(page) {
  await page.getByRole('button', { name: 'Add Task', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add New Task' })).toBeVisible()
}

/** A course with one assignment each, so the course filter has something to do. */
async function seedTwoCourses(app) {
  return seedPlannerData(app, {
    courses: [makeCourse({ name: 'Discrete Math' }), makeCourse({ name: 'World History' })],
    assignments: [
      makeAssignment({ title: 'Proof set 4', courseIndex: 0, dueDate: dayOffset(4) }),
      makeAssignment({ title: 'Reading response', courseIndex: 1, dueDate: dayOffset(5) }),
    ],
  })
}

test.describe('task form modal', () => {
  test('creates a task with a date, a priority and a group', async ({ app, page }) => {
    await app.goto('/tasks')
    await openAddModal(page)

    const modal = taskModal(page)
    await modal.getByPlaceholder('e.g. Read chapter 4').fill('Draft thesis outline')

    await modal.getByRole('button', { name: 'Pick a day' }).click()
    await page
      .getByRole('dialog', { name: 'Choose date' })
      .getByRole('button', { name: 'Today', exact: true })
      .click()

    await modal.getByRole('button', { name: 'Urgent' }).click()
    await modal.getByPlaceholder('e.g. Study, Work, Personal').fill('Thesis')
    await expect(page.getByText('Creates a new group "Thesis"')).toBeVisible()

    await modal.getByRole('button', { name: 'Add Task', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Add New Task' })).not.toBeVisible()
    // Picking "Today" in the calendar has to land the task in the Today bucket,
    // which is the only section on the page.
    const today = page.locator('section').first()
    await expect(today).toContainText('Today')
    await expect(today).toContainText('Draft thesis outline')
    await expect(today).toContainText('Urgent')
    await expect(today).toContainText('Thesis')
  })

  test('blocks the submit until the task has a non-blank title', async ({ app, page }) => {
    await app.goto('/tasks')
    await openAddModal(page)

    const modal = taskModal(page)
    const title = modal.getByPlaceholder('e.g. Read chapter 4')
    const submit = modal.getByRole('button', { name: 'Add Task', exact: true })

    await expect(submit).toBeDisabled()

    // Whitespace is not a title.
    await title.fill('   ')
    await expect(submit).toBeDisabled()

    await title.fill('Read chapter 4')
    await expect(submit).toBeEnabled()

    // Emptying it again re-arms the guard, and nothing was created.
    await title.fill('')
    await expect(submit).toBeDisabled()
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('No tasks yet.')).toBeVisible()
  })

  test('offers only the selected course\'s assignments', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedTwoCourses(app)
    await openAddModal(page)

    const modal = taskModal(page)
    const options = page.getByRole('listbox').getByRole('option')

    // No course chosen: every assignment is on offer.
    await modal.getByRole('button', { name: 'No assignment', exact: true }).click()
    await expect(options).toHaveText(['No assignment', 'Proof set 4', 'Reading response'])
    await page.getByRole('option', { name: 'No assignment' }).click()

    // Choosing a course narrows the list to that course's work.
    await modal.getByRole('button', { name: 'No course', exact: true }).click()
    await page.getByRole('option', { name: 'Discrete Math' }).click()
    await modal.getByRole('button', { name: 'No assignment', exact: true }).click()
    await expect(options).toHaveText(['No assignment', 'Proof set 4'])
  })

  test('drops the chosen assignment when the course is switched', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedTwoCourses(app)
    await openAddModal(page)

    const modal = taskModal(page)

    // Picking an assignment adopts its course.
    await modal.getByRole('button', { name: 'No assignment', exact: true }).click()
    await page.getByRole('option', { name: 'Proof set 4' }).click()
    await expect(modal.getByRole('button', { name: 'Discrete Math', exact: true })).toBeVisible()

    // Switching to another course clears the now-mismatched assignment.
    await modal.getByRole('button', { name: 'Discrete Math', exact: true }).click()
    await page.getByRole('option', { name: 'World History' }).click()
    await expect(modal.getByRole('button', { name: 'No assignment', exact: true })).toBeVisible()
  })

  test('edits an existing task in place', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedPlannerData(app, {
      tasks: [makeTask({ title: 'Read chapter 1', scheduledDate: dayOffset(0) })],
    })

    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible()

    const modal = taskModal(page)
    await expect(modal.getByPlaceholder('e.g. Read chapter 4')).toHaveValue('Read chapter 1')

    await modal.getByPlaceholder('e.g. Read chapter 4').fill('Read chapter 2')
    await modal.getByRole('button', { name: 'High', exact: true }).click()
    await modal.getByRole('button', { name: 'Save Changes' }).click()

    await expect(page.getByRole('heading', { name: 'Edit Task' })).not.toBeVisible()
    await expect(page.getByText('Read chapter 2')).toBeVisible()
    await expect(page.getByText('Read chapter 1')).not.toBeVisible()
    await expect(page.locator('section').first()).toContainText('High')
  })
})
