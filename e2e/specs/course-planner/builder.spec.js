/**
 * Course Planner: Builder mode.
 *
 * The student picks candidate COURSES, the store fetches every section for
 * them, and src/utils/scheduleCombos.js generates the conflict-free
 * combinations. The stubbed COMP catalogue offers two sections of COMP 140 and
 * one of COMP 182, none of which collide, so exactly two schedules exist.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import {
  COMP_140_001,
  COMP_182_001,
  SCHOOL_CODE,
  SUBJECT_OPTION,
  candidatesSeed,
  mockCatalog,
  pickSubject,
  pickTerm,
} from '../../mocks/course-planner.js'

/** Boot into Builder mode with both candidate courses already picked. */
async function generatedSchedules(app, api, page) {
  mockCatalog(api)
  app.seedLocalStorage({
    ...profileSeed({ school: SCHOOL_CODE }),
    'coursePlanner:candidates': candidatesSeed([COMP_140_001, COMP_182_001]),
  })
  await app.goto('/course-planner')
  await pickTerm(page)
  await page.getByRole('button', { name: 'Builder' }).click()
  await expect(page.getByText('Courses · 2/8')).toBeVisible()

  await page.getByRole('button', { name: 'Generate schedules' }).click()
  await expect(page.getByText('Schedule 1 of 2')).toBeVisible()
}

test.describe('course planner builder', () => {
  test('adds courses from the loaded subject and drops them again', async ({ app, api, page }) => {
    mockCatalog(api)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
    await app.goto('/course-planner')

    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)
    await page.getByRole('button', { name: 'Builder' }).click()

    await expect(
      page.getByText('Pick up to 8 courses below. The builder finds every conflict-free schedule.')
    ).toBeVisible()

    // Each Add hands the store the first section of that course group; the row
    // then reports "Added", so the next Add is always the following course.
    const addCourse = page.getByRole('button', { name: 'Add', exact: true })
    await addCourse.first().click()
    await expect(page.getByText('Courses · 1/8')).toBeVisible()
    await addCourse.first().click()
    await expect(page.getByText('Courses · 2/8')).toBeVisible()

    await page.getByTitle('Remove course').first().click()

    await expect(page.getByText('Courses · 1/8')).toBeVisible()
  })

  test('pages through every generated schedule', async ({ app, api, page }) => {
    await generatedSchedules(app, api, page)

    await expect(page.getByText('Previewing a generated schedule - not saved yet')).toBeVisible()
    await expect(page.getByText('COMP 140 · 001')).toBeVisible()
    await expect(page.getByText('COMP 182 · 001')).toBeVisible()

    await page.getByRole('button', { name: 'Next schedule' }).click()

    await expect(page.getByText('Schedule 2 of 2')).toBeVisible()
    await expect(page.getByText('COMP 140 · 002')).toBeVisible()
    await expect(page.getByText('COMP 140 · 001')).toHaveCount(0)

    await page.getByRole('button', { name: 'Previous schedule' }).click()

    await expect(page.getByText('Schedule 1 of 2')).toBeVisible()
    await expect(page.getByText('COMP 140 · 001')).toBeVisible()
  })

  test('applying a generated schedule replaces the saved plan', async ({ app, api, page }) => {
    await generatedSchedules(app, api, page)

    await page.getByRole('button', { name: 'Apply' }).click()

    await expect(page.getByRole('heading', { name: 'Replace saved plan?' })).toBeVisible()
    await expect(
      page.getByText(
        'Replace your saved plan for Rice University? Your current 0 saved sections will be removed.'
      )
    ).toBeVisible()

    await page.getByRole('button', { name: 'Replace plan' }).click()

    // Applying commits the preview and drops back to Browse.
    await expect(page.getByText('2 courses')).toBeVisible()
    await expect(page.getByText('Previewing a generated schedule - not saved yet')).toHaveCount(0)
    await expect(page.getByText('Pick a term + subject to see sections.')).toBeVisible()
    await expect(page.getByTitle(/^COMP 140/).first()).toBeVisible()
    await expect(page.getByTitle(/^COMP 182/).first()).toBeVisible()
  })
})
