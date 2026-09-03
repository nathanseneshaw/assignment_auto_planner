/**
 * Subtasks on /tasks.
 *
 * Subtasks are hidden until the task row is clicked, then added through an
 * inline field. Their checkbox has neither text nor a tooltip, so it is reached
 * from the subtask's own title - the first button in the row that contains it.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeTask, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

/** Reveal a task's subtask drawer by clicking its title. */
async function expandTask(page, title) {
  await page.getByText(title, { exact: true }).click()
}

/** Type a subtask into the inline field and commit it with Enter. */
async function addSubtask(page, title) {
  await page.getByRole('button', { name: 'Add subtask' }).click()
  await page.getByPlaceholder('Subtask name').fill(title)
  await page.keyboard.press('Enter')
}

/** The round toggle sitting to the left of a subtask's title. */
function subtaskCheckbox(page, title) {
  return page
    .getByText(title, { exact: true })
    .locator('xpath=../..')
    .getByRole('button')
    .first()
}

test.describe('subtasks', () => {
  test('adds a subtask to an expanded task', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedPlannerData(app, {
      tasks: [makeTask({ title: 'Review lemmas', scheduledDate: dayOffset(0) })],
    })

    // The drawer is closed to start with.
    await expect(page.getByRole('button', { name: 'Add subtask' })).not.toBeVisible()

    await expandTask(page, 'Review lemmas')
    await expect(page.getByRole('button', { name: 'Add subtask' })).toBeVisible()

    await addSubtask(page, 'Draft outline')
    await expect(page.getByText('Draft outline')).toBeVisible()
  })

  test('completing a subtask updates the row counter', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedPlannerData(app, {
      tasks: [makeTask({ title: 'Review lemmas', scheduledDate: dayOffset(0) })],
    })

    await expandTask(page, 'Review lemmas')
    await addSubtask(page, 'Draft outline')
    await expect(page.getByText('Draft outline')).toBeVisible()

    await subtaskCheckbox(page, 'Draft outline').click()

    // The counter on the task row reads completed/total.
    await expect(page.getByText('1/1', { exact: true })).toBeVisible()
  })
})
