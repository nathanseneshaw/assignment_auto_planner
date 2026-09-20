/**
 * The app shell: sidebar navigation, the responsive swap to the bottom nav,
 * the mobile drawer, and the feedback modal that MainLayout pins to every
 * signed-in page.
 *
 * The sidebar marks the active route with a small dot that fades in
 * (`opacity-0` -> `opacity-100`), which is the one active-state signal a user
 * can actually see, so that is what these tests assert.
 */
import { test, expect } from '../../fixtures/test.js'
import { schoolsResponse } from '../../mocks/auth.js'

/** The sidebar link for `name`, and its active-state indicator dot. */
function sidebarLink(page, name) {
  return page.locator('aside.app-sidebar').getByRole('link', { name, exact: true })
}

test.describe('navigation shell', () => {
  test('the sidebar reaches every route and marks the active one', async ({ app, api, page }) => {
    // The Course Planner page loads the school list as it mounts.
    api.json('/api/course-planner/schools', schoolsResponse)
    await app.goto('/dashboard')

    const destinations = [
      ['Tasks', '/tasks'],
      ['Assignments', '/assignments'],
      ['Planner', '/planner'],
      ['Courses', '/course-planner'],
      ['Dashboard', '/dashboard'],
    ]

    for (const [name, path] of destinations) {
      const link = sidebarLink(page, name)
      await link.click()
      await expect(page).toHaveURL(path)
      // The active row shows its indicator dot...
      await expect(link.locator('span').first()).toHaveCSS('opacity', '1')
      // ...and no other row does.
      const other = name === 'Tasks' ? 'Planner' : 'Tasks'
      await expect(sidebarLink(page, other).locator('span').first()).toHaveCSS('opacity', '0')
    }
  })

  test('the sidebar account button opens settings', async ({ app, api, page }) => {
    api.json('/api/course-planner/schools', schoolsResponse)
    await app.goto('/dashboard')

    await page.locator('aside.app-sidebar').getByRole('button', { name: /Student planner/ }).click()

    await expect(page).toHaveURL('/profile')
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible()
  })

  test('a narrow viewport swaps the sidebar for the bottom navigation bar', async ({ app, page }) => {
    await app.goto('/dashboard')

    const sidebar = page.locator('aside.app-sidebar')
    await expect(sidebar).toBeInViewport()
    // Only the sidebar carries a Planner link at desktop width.
    await expect(page.getByRole('link', { name: 'Planner', exact: true })).toHaveCount(1)

    await page.setViewportSize({ width: 390, height: 844 })

    // The sidebar slides off-canvas and the bottom nav takes over.
    await expect(sidebar).not.toBeInViewport()
    await expect(page.getByRole('link', { name: 'Planner', exact: true })).toHaveCount(2)
    await expect(page.getByRole('link', { name: 'Planner', exact: true }).last()).toBeInViewport()
  })

  test('the mobile menu button opens and closes the sidebar drawer', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await app.goto('/dashboard')

    const sidebar = page.locator('aside.app-sidebar')
    await expect(sidebar).not.toBeInViewport()

    // The hamburger is the first control in the top bar (it ships no label).
    await page.locator('header').getByRole('button').first().click()
    await expect(sidebar).toBeInViewport()

    await page.getByRole('button', { name: 'Close menu' }).click()
    await expect(sidebar).not.toBeInViewport()
  })

  test('the feedback modal will not submit without a rating', async ({ app, page }) => {
    await app.goto('/dashboard')

    await page.getByRole('button', { name: 'Feedback' }).click()
    await expect(page.getByRole('heading', { name: 'Share Feedback' })).toBeVisible()

    const submit = page.getByRole('button', { name: 'Submit' })
    await expect(submit).toBeDisabled()

    const stars = page.locator('form').getByRole('button')
    await expect(stars).toHaveCount(5)
    await stars.nth(3).click()

    await expect(page.getByText('Great', { exact: true })).toBeVisible()
    await expect(submit).toBeEnabled()
  })

  test('feedback submission reports a failure when the backend is unreachable', async ({ app, page }) => {
    await app.goto('/dashboard')

    await page.getByRole('button', { name: 'Feedback' }).click()
    await page.locator('form').getByRole('button').nth(4).click()
    await page.getByRole('button', { name: 'Submit' }).click()

    await expect(page.getByText('Failed to submit feedback. Please try again.')).toBeVisible()
  })
})
