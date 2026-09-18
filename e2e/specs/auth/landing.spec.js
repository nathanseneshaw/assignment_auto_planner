/**
 * Marketing landing page (`/`).
 *
 * Under test Supabase is unconfigured, and LandingPage branches hard on that:
 * the header sign-up buttons and the sticky CTA disappear entirely, and the
 * hero offers "Open the app" (straight into /dashboard) plus a note explaining
 * why. These tests assert that real branch, not the signed-out marketing one.
 */
import { test, expect } from '../../fixtures/test.js'
import { schoolsResponse } from '../../mocks/auth.js'

test.describe('landing page', () => {
  test('renders every marketing section', async ({ app, page }) => {
    await app.goto('/')

    await expect(page.getByRole('heading', { level: 1, name: /Never miss a due date/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Up and running in a minute' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'See Plannr in action' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Why students use it' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Take Plannr off the browser tab' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible()
  })

  test('the hero sign-in call to action routes to the login page', async ({ app, page }) => {
    await app.goto('/')

    await page.getByRole('link', { name: 'Sign in' }).click()

    await expect(page).toHaveURL('/login?redirect=/dashboard')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('the Course Planner call to action opens the planner without signing in', async ({
    app,
    api,
    page,
  }) => {
    // The planner loads the supported-school list as it mounts.
    api.json('/api/course-planner/schools', schoolsResponse)
    await app.goto('/')

    // Offered in both the signed-out and the unconfigured hero, so it needs no
    // `isSupabaseConfigured` branch of its own.
    await page.getByRole('link', { name: 'Try the Course Planner' }).click()

    await expect(page).toHaveURL('/course-planner')
    await expect(page.getByRole('heading', { name: 'Course Planner' })).toBeVisible()
  })

  test('the header links straight to the Course Planner', async ({ app, api, page }) => {
    api.json('/api/course-planner/schools', schoolsResponse)
    await app.goto('/')

    await page.locator('header').getByRole('link', { name: 'Course Planner' }).click()

    await expect(page).toHaveURL('/course-planner')
  })

  test('explains that auth is unavailable and offers a local way into the app', async ({ app, page }) => {
    await app.goto('/')

    // The signed-out marketing CTAs are gated behind `isSupabaseConfigured`.
    await expect(page.getByRole('link', { name: 'Get started free' })).toHaveCount(0)
    await expect(page.getByText(/Auth isn.t configured yet/)).toBeVisible()

    await page.getByRole('link', { name: 'Open the app' }).first().click()

    await expect(page).toHaveURL('/dashboard')
    await expect(page.locator('aside.app-sidebar').getByRole('link', { name: 'Planner', exact: true })).toBeVisible()
  })
})
