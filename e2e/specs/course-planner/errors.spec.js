/**
 * Course Planner: what the page does when the catalogue backend misbehaves.
 *
 * Every scrape is a live hit against a university site, so failures are normal
 * operating conditions here rather than edge cases. Each of the three fetches
 * degrades differently, and none of them may take the page down.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import {
  ENDPOINTS,
  SCHOOL_CODE,
  SUBJECT_OPTION,
  mockCatalog,
  pickSubject,
  pickTerm,
} from '../../mocks/course-planner.js'

test.describe('course planner error states', () => {
  test('keeps browsing usable when the schools list fails', async ({ app, api, page }) => {
    mockCatalog(api)
    // Registered last, so it wins over the catalogue default.
    api.fail(ENDPOINTS.schools)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))

    await app.goto('/course-planner')

    // The friendly school name is the only casualty: it falls back to a label.
    await expect(page.getByText('Course catalog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Course Planner' })).toBeVisible()

    // Terms still load, so the catalogue is still browsable.
    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)
    await expect(page.getByText('Results · 4')).toBeVisible()
  })

  test('reports a dropped connection under the term dropdown', async ({ app, api, page }) => {
    mockCatalog(api)
    api.offline(ENDPOINTS.terms)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))

    await app.goto('/course-planner')

    await expect(page.getByText(/failed to fetch/i)).toBeVisible()
    // No terms arrived, so the dropdown holds nothing but its placeholder.
    await page.getByRole('button', { name: 'Select a term' }).click()
    await expect(page.getByRole('option')).toHaveCount(1)
  })

  test("surfaces the server's message when a sections search fails", async ({ app, api, page }) => {
    mockCatalog(api)
    api.fail(ENDPOINTS.sections, {
      status: 502,
      body: { success: false, error: 'rice sections failed: catalog timed out' },
    })
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))

    await app.goto('/course-planner')
    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)

    await expect(page.getByText('rice sections failed: catalog timed out')).toBeVisible()
  })
})
