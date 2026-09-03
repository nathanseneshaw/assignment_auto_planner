/**
 * Marketing landing page (`/`).
 *
 * Under test Supabase is unconfigured, and LandingPage branches hard on that:
 * the header sign-up buttons and the sticky CTA disappear entirely, and the
 * hero offers "Open the app" (straight into /dashboard) plus a note explaining
 * why. These tests assert that real branch, not the signed-out marketing one.
 */
import { test, expect } from '../../fixtures/test.js'

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
