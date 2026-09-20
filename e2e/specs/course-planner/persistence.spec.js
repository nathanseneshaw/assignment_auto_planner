/**
 * Course Planner: what survives a reload.
 *
 * Four localStorage keys back this page, and all four are read once at store
 * construction time:
 *
 *   coursePlanner:saved            saved sections, bucketed by school
 *   coursePlanner:work             weekly work shifts (global, not per school)
 *   coursePlanner:hideUnavailable  the availability preference
 *   coursePlanner:candidates       builder candidates, bucketed by school:term
 *
 * Both directions matter, so each is written by the UI and read back, or seeded
 * before boot and rendered.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import {
  COMP_140_001,
  COMP_182_001,
  SCHOOL_CODE,
  SUBJECT_OPTION,
  candidatesSeed,
  filterBox,
  mockCatalog,
  pickSubject,
  pickTerm,
  savedSeed,
} from '../../mocks/course-planner.js'

test.describe('course planner persistence', () => {
  test('renders a saved plan and work schedule seeded into localStorage', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)
    app.seedLocalStorage({
      ...profileSeed({ school: SCHOOL_CODE }),
      'coursePlanner:saved': savedSeed([COMP_140_001]),
      'coursePlanner:work': [{ id: 'w-1', days: ['F'], startTime: '13:00', endTime: '17:00' }],
    })

    await app.goto('/course-planner')

    await expect(page.getByText('1 course · 1 work shift')).toBeVisible()
    await expect(page.getByTitle(/^COMP 140/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit work hours' })).toBeVisible()
  })

  test('restores the availability preference and the builder candidates', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)
    app.seedLocalStorage({
      ...profileSeed({ school: SCHOOL_CODE }),
      'coursePlanner:hideUnavailable': false,
      // Candidates are bucketed per term, so they only surface once the term
      // that owns them is selected again.
      'coursePlanner:candidates': candidatesSeed([COMP_182_001]),
    })

    await app.goto('/course-planner')
    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)

    // Preference off: the closed and full sections are in the list from the start.
    await expect(page.getByText('Results · 6')).toBeVisible()
    await expect(page.getByText('Data Science Tools')).toBeVisible()

    await page.getByRole('button', { name: 'Builder' }).click()

    await expect(page.getByText('Courses · 1/8')).toBeVisible()
    await expect(page.getByText('Algorithmic Thinking', { exact: true })).toBeVisible()
    await expect(page.getByText('Added')).toBeVisible()
  })

  test('a section added in the UI is still on the grid after a reload', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
    await app.goto('/course-planner')

    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)
    await filterBox(page).fill('Algorithmic')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('1 course')).toBeVisible()

    const stored = await page.evaluate(() => localStorage.getItem('coursePlanner:saved'))
    expect(JSON.parse(stored)[SCHOOL_CODE].map((s) => s.crn)).toEqual([COMP_182_001.crn])

    await app.goto('/course-planner')

    await expect(page.getByText('1 course')).toBeVisible()
    await expect(page.getByTitle(/^COMP 182/).first()).toBeVisible()
  })

  test('work hours saved from the modal survive a reload', async ({ app, api, page }) => {
    mockCatalog(api)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
    await app.goto('/course-planner')

    await page.getByRole('button', { name: 'Add work hours' }).click()
    await expect(page.getByRole('heading', { name: 'Weekly work schedule' })).toBeVisible()
    // The draft shift already carries the default 9:00 to 17:00 window; it only
    // needs a day before it validates.
    await page.getByRole('button', { name: 'Fri', exact: true }).click()
    await page.getByRole('button', { name: 'Save schedule' }).click()

    await expect(page.getByText('1 work shift')).toBeVisible()

    await app.goto('/course-planner')

    await expect(page.getByText('1 work shift')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit work hours' })).toBeVisible()
  })
})
