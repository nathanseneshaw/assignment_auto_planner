/**
 * Completing and deleting a task from /tasks.
 *
 * The round checkbox on a task row carries no label text, so it is addressed by
 * the tooltip it exposes as its accessible name ("Mark complete" flipping to
 * "Mark active again"). Each of these tests seeds exactly one task so that
 * locator stays unambiguous.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeCourse, makeAssignment, makeTask, seedPlannerData, dayOffset } from '../../fixtures/seed.js'

test.describe('task actions', () => {
  test('completing a task flips the checkbox and moves the progress rail', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedPlannerData(app, {
      tasks: [makeTask({ title: 'Review lemmas', scheduledDate: dayOffset(0) })],
    })

    await expect(page.getByText('0 of 1 tasks complete')).toBeVisible()

    await page.getByRole('button', { name: 'Mark complete' }).click()

    await expect(page.getByRole('button', { name: 'Mark active again' })).toBeVisible()
    await expect(page.getByText('1 of 1 tasks complete')).toBeVisible()
  })

  test('completing a task rolls the parent assignment progress', async ({ app, page }) => {
    await app.goto('/tasks')
    const { assignments } = await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Discrete Math' })],
      assignments: [
        makeAssignment({
          title: 'Proof set 4',
          courseIndex: 0,
          dueDate: dayOffset(4),
          // updateProgress() recomputes from the assignment's own nested
          // checklist, so seed one for it to recompute from.
          tasks: [{ id: 'step-1', completed: true }, { id: 'step-2', completed: true }],
        }),
      ],
      tasks: [
        makeTask({ title: 'Finish proof 3', assignmentIndex: 0, scheduledDate: dayOffset(0) }),
      ],
    })

    // The row shows what it is linked to, and the roll-up has not run yet.
    await expect(page.getByText('Proof set 4')).toBeVisible()
    expect(assignments[0].progress).toBe(0)

    await page.getByRole('button', { name: 'Mark complete' }).click()
    await expect(page.getByRole('button', { name: 'Mark active again' })).toBeVisible()

    const stored = (await app.store('assignments').state()).assignments[0]
    expect(stored.progress).toBe(100)
    expect(stored.status).toBe('completed')
  })

  test('deleting a task goes through the confirmation dialog', async ({ app, page }) => {
    await app.goto('/tasks')
    await seedPlannerData(app, {
      tasks: [makeTask({ title: 'Review lemmas', scheduledDate: dayOffset(0) })],
    })

    await page.getByRole('button', { name: 'Delete task' }).click()
    await expect(page.getByRole('heading', { name: 'Delete Task' })).toBeVisible()
    await expect(
      page.getByText("Are you sure you want to delete 'Review lemmas'?")
    ).toBeVisible()

    // Backing out keeps the task.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Delete Task' })).not.toBeVisible()
    await expect(page.getByText('Review lemmas')).toBeVisible()

    await page.getByRole('button', { name: 'Delete task' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Review lemmas')).not.toBeVisible()
    await expect(page.getByText('No tasks yet.')).toBeVisible()
  })
})
