/**
 * Sign-in and create-account forms.
 *
 * Supabase is unconfigured in `.env.e2e`, and both pages react to that by
 * rendering a setup notice and DISABLING their submit button. A disabled
 * default button also kills implicit submission, so there is no way for a user
 * to post either form here - which means the only honest coverage at this
 * level is the notice, the disabled control, the native field constraints, and
 * the links that stitch the auth pages together.
 */
import { test, expect } from '../../fixtures/test.js'

test.describe('sign in', () => {
  test('shows the setup notice and disables submitting while auth is unavailable', async ({ app, page }) => {
    await app.goto('/login')

    await expect(page.getByText('VITE_SUPABASE_URL', { exact: true })).toBeVisible()
    await expect(page.getByText('VITE_SUPABASE_ANON_KEY', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  test('the email field rejects an empty or malformed address', async ({ app, page }) => {
    await app.goto('/login')

    const email = page.getByPlaceholder('you@school.edu')
    await expect(email).toBeVisible()

    // Required, so an empty value fails the browser's own constraint check.
    expect(await email.evaluate((el) => el.checkValidity())).toBe(false)

    await email.fill('not-an-email')
    expect(await email.evaluate((el) => el.checkValidity())).toBe(false)

    await email.fill('student@school.edu')
    expect(await email.evaluate((el) => el.checkValidity())).toBe(true)
  })

  test('links to create-account and back, carrying the redirect target', async ({ app, page }) => {
    await app.goto('/login?redirect=/tasks')

    await page.getByRole('link', { name: 'Create one' }).click()
    await expect(page).toHaveURL('/register?redirect=/tasks')
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()

    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL('/login?redirect=/tasks')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('offers a way back to the landing page', async ({ app, page }) => {
    await app.goto('/login')

    await page.getByRole('link', { name: /Back to home/ }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1, name: /Never miss a due date/ })).toBeVisible()
  })
})

test.describe('create account', () => {
  test('shows the setup notice and disables submitting while auth is unavailable', async ({ app, page }) => {
    await app.goto('/register')

    await expect(page.getByPlaceholder('Alex Student')).toBeVisible()
    await expect(page.getByPlaceholder('At least 6 characters')).toBeVisible()
    await expect(page.getByText('VITE_SUPABASE_ANON_KEY', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
  })
})
