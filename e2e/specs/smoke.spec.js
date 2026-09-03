/**
 * Harness smoke test.
 *
 * This spec exists to prove the e2e plumbing itself works, independent of any
 * feature area: the app boots in local mode, the auth guard is disabled, the
 * Pinia test hook is reachable, seeding through real store actions lands in the
 * rendered DOM, and unmocked backend calls fail loudly instead of hanging.
 *
 * If a feature spec starts failing, run this one first - a green smoke test
 * says the problem is in the feature, not the harness.
 */
import { test, expect } from '../fixtures/test.js'
import { makeCourse, makeAssignment, seedPlannerData } from '../fixtures/seed.js'

test.describe('e2e harness', () => {
  test('boots the app in local mode with the auth guard disabled', async ({ app, page }) => {
    await app.goto('/dashboard')

    // Supabase is unconfigured in `.env.e2e`, so a `requiresAuth` route must
    // render rather than bounce to /login.
    expect(await app.currentPath()).toBe('/dashboard')
    await expect(page.locator('#app')).toBeVisible()
  })

  test('exposes live Pinia stores through the test hook', async ({ app }) => {
    await app.goto('/dashboard')

    const courses = app.store('courses')
    expect((await courses.state()).courses).toEqual([])

    const created = await courses.invoke('addCourse', makeCourse({ name: 'Harness 101' }))
    expect(created.id).toBeTruthy()
    expect((await courses.state()).courses).toHaveLength(1)
  })

  test('seeded data reaches the rendered UI', async ({ app, page }) => {
    await app.goto('/assignments')

    await seedPlannerData(app, {
      courses: [makeCourse({ name: 'Astrophysics', code: 'AST 300' })],
      assignments: [makeAssignment({ title: 'Orbital mechanics writeup', courseIndex: 0 })],
    })

    await expect(page.getByText('Orbital mechanics writeup')).toBeVisible()
  })

  test('localStorage seeding is applied before the app boots', async ({ app }) => {
    app.seedLocalStorage({ theme: '1' })
    await app.goto('/dashboard')

    const profile = await app.store('profile').state()
    expect(profile.profile.darkMode).toBe(true)
  })

  test('an unmocked backend call is failed with 503 and recorded', async ({ app, api, page }) => {
    await app.goto('/dashboard')

    const status = await page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:3001/api/health')
      return res.status
    })

    expect(status).toBe(503)
    expect(api.unmatched.map((r) => r.pathname)).toContain('/api/health')
  })

  test('a stubbed backend call returns the stubbed body', async ({ app, api, page }) => {
    api.json('/api/health', { ok: true, source: 'e2e-stub' })
    await app.goto('/dashboard')

    const body = await page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:3001/api/health')
      return res.json()
    })

    expect(body).toEqual({ ok: true, source: 'e2e-stub' })
    expect(api.callsTo('/api/health')).toHaveLength(1)
    expect(api.unmatched).toHaveLength(0)
  })
})
