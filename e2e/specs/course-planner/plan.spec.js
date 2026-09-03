/**
 * Course Planner: the saved weekly plan.
 *
 * Adding a section from the results rail drops it onto the calendar grid for
 * the current school; the grid then reports overlaps back as conflicts.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import {
  COMP_140_001,
  MATH_101_001,
  SCHOOL_CODE,
  SUBJECT_OPTION,
  filterBox,
  mockCatalog,
  pickSubject,
  pickTerm,
  savedSeed,
} from '../../mocks/course-planner.js'

test.describe('course planner saved plan', () => {
  test('adding a section puts it on the weekly grid, and removing it takes it off', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
    await app.goto('/course-planner')

    await expect(page.getByText('Nothing scheduled yet')).toBeVisible()

    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)
    // Narrow to a single row so there is exactly one Add button to press.
    await filterBox(page).fill('Algorithmic')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(page.getByText('1 course')).toBeVisible()
    await expect(page.getByTitle(/^COMP 182/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()

    await page.getByRole('button', { name: 'Remove' }).click()

    await expect(page.getByText('Nothing scheduled yet')).toBeVisible()
    await expect(page.getByTitle(/^COMP 182/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
  })

  test('warns when two saved sections overlap', async ({ app, api, page }) => {
    mockCatalog(api)
    app.seedLocalStorage({
      ...profileSeed({ school: SCHOOL_CODE }),
      // COMP 140 runs 9:00-10:00 MW, MATH 101 runs 9:30-10:30 MW.
      'coursePlanner:saved': savedSeed([COMP_140_001, MATH_101_001]),
    })
    await app.goto('/course-planner')

    await expect(page.getByText('1 Schedule Conflict Detected')).toBeVisible()
    // The row is a flex list of separate spans, so assert its parts rather than
    // one run-together string.
    const conflict = page.getByRole('listitem').filter({ hasText: 'overlaps' })
    await expect(conflict).toContainText('COMP 140')
    await expect(conflict).toContainText('MATH 101')
    await expect(conflict).toContainText('Mon, Wed')
  })
})
