/**
 * The two standalone "close this tab" pages that email links land on.
 *
 * Both read a snapshot of the URL the app booted with (`captureAuthCallback` in
 * lib/supabase), so they can only be driven with a full navigation - a
 * client-side route change would leave the snapshot empty. The router also pins
 * a tab that booted with `type=email_change` to /auth/verify-email, which is
 * why the email-change cases carry that parameter.
 */
import { test, expect } from '../../fixtures/test.js'
import { schoolsResponse } from '../../mocks/auth.js'

test.describe('signup confirmation page', () => {
  test('confirms the email and tells the user to close the tab', async ({ app, page }) => {
    await app.goto('/auth/confirm#access_token=e2e-token&type=signup')

    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible()
    await expect(page.getByText(/You can safely close this tab/)).toBeVisible()
    // The implicit-flow token is stripped from the address bar on mount.
    expect(await page.evaluate(() => window.location.hash)).toBe('')
  })

  test('reports an expired link and routes back to sign in', async ({ app, page }) => {
    await app.goto('/auth/confirm#error_description=Email+link+is+invalid+or+has+expired')

    await expect(page.getByRole('heading', { name: /Link did/ })).toBeVisible()
    await expect(page.getByText(/Email link is invalid or has expired/)).toBeVisible()

    await page.getByRole('link', { name: 'Go to sign in' }).click()

    await expect(page).toHaveURL('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('opened directly, falls back to the neutral close-this-tab state', async ({ app, page }) => {
    await app.goto('/auth/confirm')

    await expect(page.getByRole('heading', { name: 'You can close this tab' })).toBeVisible()
    await expect(page.getByText(/it may have expired/)).toBeVisible()
  })
})

test.describe('email-change verification page', () => {
  test('confirms the new address and tells the user to close the tab', async ({ app, page }) => {
    await app.goto('/auth/verify-email#access_token=e2e-token&type=email_change')

    // An `email_change` callback is pinned here, not bounced to /auth/confirm.
    expect(await app.currentPath()).toMatch(/^\/auth\/verify-email/)
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
    await expect(page.getByText(/Your email address has been updated/)).toBeVisible()
  })

  test('reports an expired link and routes to settings', async ({ app, api, page }) => {
    // Settings loads the supported-school list the moment it mounts.
    api.json('/api/course-planner/schools', schoolsResponse)
    await app.goto('/auth/verify-email#error_description=Email+link+is+invalid&type=email_change')

    await expect(page.getByRole('heading', { name: /Link did/ })).toBeVisible()
    await expect(page.getByText(/Email link is invalid/)).toBeVisible()

    await page.getByRole('link', { name: 'Go to settings' }).click()

    await expect(page).toHaveURL('/profile')
  })
})
