/**
 * Course Planner: the signed-out visitor.
 *
 * `/course-planner` is the one app route with no `requiresAuth`, so a guest can
 * browse a live catalogue before making an account. Two consequences show up in
 * the page itself: the "no school yet" empty state offers the university picker
 * inline (a guest has no profile page to be sent to), and a sign-up nudge sits
 * above the hero.
 *
 * Two caveats about what this file can and cannot prove, both caused by the
 * same deliberate harness choice - the app runs with blank Supabase credentials
 * (`.env.e2e`):
 *
 *   - The router's auth guard is a no-op here, so "not bounced to /login" is
 *     only a check that nothing in the PAGE redirects. The guard itself is
 *     covered by src/router/__tests__/auth-guard.test.js, which mocks Supabase
 *     as configured so the guard actually runs.
 *   - The sign-up banner is gated on `isSupabaseConfigured` (there is no
 *     account to make in local mode), so it cannot render in this suite. Its
 *     copy, its /register link and its dismiss button are covered by
 *     src/pages/__tests__/coursePlanner-guest.test.js. What is asserted below
 *     is the gate: no nudge where signing up is impossible.
 */
import { test, expect } from '../../fixtures/test.js'
import { ENDPOINTS, SCHOOL_NAME, SUBJECT_OPTION, mockCatalog, pickSubject, pickTerm } from '../../mocks/course-planner.js'

/** The inline picker's search box - the one control unique to the guest state. */
function schoolSearch(page) {
  return page.getByPlaceholder('Search universities…')
}

test.describe('course planner as a guest', () => {
  test('opens without an account instead of bouncing to the login page', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)

    await app.goto('/course-planner')

    expect(await app.currentPath()).toBe('/course-planner')
    await expect(page.getByRole('heading', { name: 'Course Planner' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0)
  })

  test('offers the university picker inline rather than a link into the profile', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)

    await app.goto('/course-planner')

    await expect(page.getByRole('heading', { name: 'Pick your university first' })).toBeVisible()
    await expect(schoolSearch(page)).toBeVisible()
    // /profile is auth-walled, so the signed-in shortcut must not be offered.
    await expect(page.getByRole('button', { name: 'Open Profile' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: SCHOOL_NAME })).toBeVisible()
  })

  test('picking a school inline gets the guest all the way to a section list', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)
    await app.goto('/course-planner')

    // Filter to one school, then pick it - exactly the two steps a user takes.
    await schoolSearch(page).fill('Rice')
    await page.getByRole('button', { name: SCHOOL_NAME }).click()

    await api.waitForCall(ENDPOINTS.terms)
    await expect(schoolSearch(page)).toHaveCount(0)

    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.COMP)

    await expect(page.getByText('Results · 4')).toBeVisible()
    expect(api.unmatched).toHaveLength(0)
  })

  test('leaves out the sign-up nudge where there is no account to make', async ({
    app,
    api,
    page,
  }) => {
    mockCatalog(api)

    await app.goto('/course-planner')

    // Local mode: Supabase is unconfigured, so registration is not on offer.
    await expect(page.getByText("You're browsing as a guest")).toHaveCount(0)
    await expect(page.locator('a[href*="/register"]')).toHaveCount(0)
  })
})
