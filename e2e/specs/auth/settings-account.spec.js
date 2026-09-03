/**
 * The account half of Settings (`/profile`): identity header, the dark-mode
 * switch, and the university selector that feeds the Course Planner.
 *
 * Name and email are not editable here - they are read from the locally stored
 * profile (or, in a configured install, from the Supabase user) - so the only
 * account field a user can actually change offline is the university.
 *
 * The "Account & security" block (change email / change password) is rendered
 * only when `isSupabaseConfigured && authStore.user`, so it never appears under
 * test. Its absence is asserted rather than pretended around.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import { schoolsResponse } from '../../mocks/auth.js'

test.describe('settings - account', () => {
  test.beforeEach(async ({ api }) => {
    api.json('/api/course-planner/schools', schoolsResponse)
  })

  test('renders the identity held in the local profile', async ({ app, page }) => {
    app.seedLocalStorage(profileSeed({ name: 'Jordan Lee', email: 'jordan@school.edu' }))
    await app.goto('/profile')

    await expect(page.getByRole('heading', { level: 1, name: 'Jordan Lee' })).toBeVisible()
    await expect(page.getByRole('main').getByText('jordan@school.edu')).toBeVisible()
  })

  test('the Supabase-backed account controls are absent while auth is unavailable', async ({ app, page }) => {
    await app.goto('/profile')

    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Account & security' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change email' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0)
  })

  test('the dark mode switch flips the theme and survives a reload', async ({ app, page }) => {
    await app.goto('/profile')

    const toggle = page.getByRole('switch')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await toggle.click()

    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(await page.evaluate(() => window.localStorage.getItem('theme'))).toBe('1')

    await app.goto('/profile')

    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  test('dark mode is stripped on the public auth pages and restored in the app', async ({ app, page }) => {
    await app.goto('/profile')
    await page.getByRole('switch').click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await app.navigate('/login')
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await app.navigate('/dashboard')
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('choosing a university persists to the profile store and localStorage', async ({ app, page }) => {
    await app.goto('/profile')

    await expect(page.getByText('No university selected')).toBeVisible()

    await page.getByRole('button', { name: 'Rice University' }).click()

    await expect(page.getByText('selected')).toBeVisible()
    expect((await app.store('profile').state()).profile.school).toBe('rice')
    expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('profile')).school)).toBe('rice')
  })

  test('surfaces the error when the supported-school list cannot be loaded', async ({ app, api, page }) => {
    api.fail('/api/course-planner/schools', { status: 500, body: { error: 'Catalog is offline' } })
    await app.goto('/profile')

    await expect(page.getByText('Catalog is offline')).toBeVisible()
    await expect(page.getByText('No university selected')).toBeVisible()
  })
})
