/**
 * /assignments - creating, editing, completing and deleting through the UI.
 *
 * Everything here drives the real modal: the title field, the custom Dropdown
 * for the course, and the custom DatePicker (whose "Today" shortcut keeps the
 * chosen date relative to the run, never hard-coded).
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

const TITLE_PLACEHOLDER = 'e.g., Research Essay on Climate Change'
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A status tab, addressed by its label plus the count badge it renders. */
function statusTab(page, label, count) {
  return page.getByRole('button', { name: `${label} ${count}`, exact: true })
}

/** Open the DatePicker and take its "Today" shortcut. */
async function pickToday(page) {
  await page.getByRole('button', { name: 'Pick a due date' }).click()
  await page.getByRole('dialog', { name: 'Choose date' }).getByRole('button', { name: 'Today' }).click()
}

/** What the DatePicker trigger reads once today is selected: "Sep 3, 2026". */
function todayTriggerLabel() {
  const d = new Date()
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

test.describe('assignment CRUD', () => {
  test('creates an assignment from the new assignment form', async ({ app, page }) => {
    await app.goto('/assignments')
    await seedPlannerData(app, { courses: [makeCourse({ name: 'CS 101' })] })

    await page.getByRole('button', { name: 'New assignment' }).first().click()
    await expect(page.getByRole('heading', { name: 'Add New Assignment' })).toBeVisible()

    await page.getByPlaceholder(TITLE_PLACEHOLDER).fill('Weekly quiz')
    await page.getByPlaceholder('Add any details about the assignment...').fill('Chapters 1 to 3')

    await page.getByRole('button', { name: 'Select a course' }).click()
    await page.getByRole('option', { name: 'CS 101' }).click()

    await pickToday(page)
    await expect(page.getByRole('button', { name: todayTriggerLabel() })).toBeVisible()

    await page.getByRole('button', { name: 'Add Assignment' }).click()

    await expect(page.getByRole('heading', { name: 'Add New Assignment' })).toHaveCount(0)
    await expect(page.getByText('Weekly quiz')).toBeVisible()
    await expect(statusTab(page, 'Upcoming', 1)).toBeVisible()

    const { assignments } = await app.store('assignments').state()
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      title: 'Weekly quiz',
      description: 'Chapters 1 to 3',
      courseName: 'CS 101',
      dueDate: dayOffset(0),
      status: 'pending',
    })
  })

  test('blocks submitting until both a title and a due date are set', async ({ app, page }) => {
    await app.goto('/assignments')

    await page.getByRole('button', { name: 'New assignment' }).first().click()
    const submit = page.getByRole('button', { name: 'Add Assignment' })

    await expect(submit).toBeDisabled()

    // Title alone is not enough.
    await page.getByPlaceholder(TITLE_PLACEHOLDER).fill('Half-filled')
    await expect(submit).toBeDisabled()

    await pickToday(page)
    await expect(submit).toBeEnabled()

    // Clearing the title blocks it again, and whitespace does not count.
    await page.getByPlaceholder(TITLE_PLACEHOLDER).fill('   ')
    await expect(submit).toBeDisabled()

    expect((await app.store('assignments').state()).assignments).toHaveLength(0)
  })

  test('edits an existing assignment', async ({ app, page }) => {
    await app.goto('/assignments')
    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [makeAssignment({ title: 'Draft outline', courseIndex: 0, dueDate: dayOffset(2) })],
    })

    await page.getByRole('button', { name: /Edit/ }).click()

    await expect(page.getByRole('heading', { name: 'Edit Assignment' })).toBeVisible()
    await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue('Draft outline')
    await expect(
      page.getByText('Use the checkbox on each row to mark an assignment complete or active again.')
    ).toBeVisible()

    await page.getByPlaceholder(TITLE_PLACEHOLDER).fill('Final outline')
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(page.getByRole('heading', { name: 'Edit Assignment' })).toHaveCount(0)
    await expect(page.getByText('Final outline')).toBeVisible()
    await expect(page.getByText('Draft outline')).toHaveCount(0)
    // Editing must not duplicate the row.
    await expect(statusTab(page, 'All', 1)).toBeVisible()
  })

  test('deletes an assignment after confirming', async ({ app, page }) => {
    await app.goto('/assignments')
    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [
        makeAssignment({ title: 'First up', courseIndex: 0, dueDate: dayOffset(1) }),
        makeAssignment({ title: 'Second up', courseIndex: 0, dueDate: dayOffset(2) }),
      ],
    })

    // Rows are sorted by due date, so the first delete button is "First up".
    await page.getByRole('button', { name: 'Delete assignment' }).first().click()

    await expect(page.getByRole('heading', { name: 'Delete Assignment' })).toBeVisible()
    await expect(
      page.getByText("Are you sure you want to delete 'First up'? This action cannot be undone.")
    ).toBeVisible()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('First up')).toHaveCount(0)
    await expect(page.getByText('Second up')).toBeVisible()
    await expect(statusTab(page, 'All', 1)).toBeVisible()
  })

  test('keeps the assignment when the delete dialog is cancelled', async ({ app, page }) => {
    await app.goto('/assignments')
    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [makeAssignment({ title: 'Keep me', courseIndex: 0, dueDate: dayOffset(1) })],
    })

    await page.getByRole('button', { name: 'Delete assignment' }).click()
    await expect(page.getByRole('heading', { name: 'Delete Assignment' })).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('heading', { name: 'Delete Assignment' })).toHaveCount(0)
    await expect(page.getByText('Keep me')).toBeVisible()
    await expect(statusTab(page, 'All', 1)).toBeVisible()
  })

  test('the row checkbox moves an assignment between the upcoming and completed buckets', async ({ app, page }) => {
    await app.goto('/assignments')
    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'CS 101' })],
      assignments: [makeAssignment({ title: 'Lab writeup', courseIndex: 0, dueDate: dayOffset(2) })],
    })

    await expect(statusTab(page, 'Upcoming', 1)).toBeVisible()

    await page.getByRole('button', { name: 'Mark complete' }).click()

    await expect(statusTab(page, 'Completed', 1)).toBeVisible()
    await expect(statusTab(page, 'Upcoming', 0)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark active again' })).toBeVisible()

    await page.getByRole('button', { name: 'Mark active again' }).click()

    await expect(statusTab(page, 'Upcoming', 1)).toBeVisible()
    await expect(statusTab(page, 'Completed', 0)).toBeVisible()
  })

  test('opens the add form from ?action=add and strips the query', async ({ app, page }) => {
    await app.goto('/assignments?action=add')

    await expect(page.getByRole('heading', { name: 'Add New Assignment' })).toBeVisible()
    await expect(page.getByPlaceholder(TITLE_PLACEHOLDER)).toHaveValue('')
    await expect.poll(() => app.currentPath()).toBe('/assignments')
  })
})
