/**
 * Course Planner: the two filters that stack over the results rail.
 *
 *  - the text query, which lives on the page
 *  - the availability preference, which lives in the store (persisted, and
 *    shared with the Builder rail) and is driven by src/utils/sectionAvailability.js
 *
 * The catalogue stub holds six COMP sections, two of which no student could
 * register for: COMP 215 is closed and COMP 310 is at capacity.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import {
  SCHOOL_CODE,
  SUBJECT_OPTION,
  filterBox,
  mockCatalog,
  pickSubject,
  pickTerm,
} from '../../mocks/course-planner.js'

/** Land on a loaded COMP section list, which is where all three tests start. */
async function browseComp(app, api, page) {
  mockCatalog(api)
  app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
  await app.goto('/course-planner')
  await pickTerm(page)
  await pickSubject(page, SUBJECT_OPTION.COMP)
  await expect(page.getByText('Results · 4')).toBeVisible()
}

test.describe('course planner results', () => {
  test('narrows the results to the sections matching the query', async ({ app, api, page }) => {
    await browseComp(app, api, page)

    await filterBox(page).fill('Hopper')

    await expect(page.getByText('Results · 1')).toBeVisible()
    await expect(page.getByText('Algorithmic Thinking')).toBeVisible()
    await expect(page.getByText('Intro to Programming')).toHaveCount(0)
  })

  test('hides full and closed sections until the preference is unchecked', async ({ app, api, page }) => {
    await browseComp(app, api, page)

    await expect(page.getByText('2 hidden')).toBeVisible()
    await expect(page.getByText('Data Science Tools')).toHaveCount(0)
    await expect(page.getByText('Advanced Program Design')).toHaveCount(0)

    await page.getByText('Hide full & closed sections').click()

    await expect(page.getByText('Results · 6')).toBeVisible()
    await expect(page.getByText('Data Science Tools')).toBeVisible()
    await expect(page.getByText('Advanced Program Design')).toBeVisible()
    await expect(page.getByText('2 hidden')).toHaveCount(0)
  })

  test('offers a way back when every match is full or closed', async ({ app, api, page }) => {
    await browseComp(app, api, page)

    // COMP 215 is the only section whose course number contains "215", and it
    // is closed, so the filtered list would otherwise read as empty.
    await filterBox(page).fill('215')

    await expect(page.getByText('The only matching section is full or closed.')).toBeVisible()

    await page.getByRole('button', { name: 'Show them anyway' }).click()

    await expect(page.getByText('Data Science Tools')).toBeVisible()
    // It is visible but still unregisterable: no Add button anywhere in the rail.
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)
  })
})
