/**
 * The router's global auth guard.
 *
 * IMPORTANT: the guard only enforces `requiresAuth` when Supabase is
 * configured. Under the real `src/lib/supabase` in a test run that flag is
 * false, the whole guard short-circuits, and every assertion below would pass
 * without proving anything. So the module is mocked as CONFIGURED here - that
 * mock is what makes this suite meaningful.
 *
 * The behaviour under test: the Course Planner is a public route (a signed-out
 * visitor can browse a catalogue before making an account), while every other
 * app route still bounces anonymous users to /login with a ?redirect= back to
 * where they were headed.
 */
import { setActivePinia, createPinia } from 'pinia'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Configured Supabase, but no client: nothing in the guard path calls one, and
// `authStore.init()` is never run, so the store stays signed-out by default.
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: null,
  getAuthCallback: () => ({ type: null, status: null, error: '' }),
  // The guard consumes this on every navigation; null = an ordinary app load.
  consumeAuthCallbackPin: () => null,
}))

// Route components are resolved lazily *after* the guard has already made its
// decision, and some of them import `/public` asset URLs (`/plannr-icon-light.svg`)
// that Vitest cannot load as modules. Stub every page this suite can land on:
// what is under test is where the guard sends you, not what renders there.
vi.mock('../../pages/LoginPage.vue', () => ({ default: { render: () => null } }))
vi.mock('../../pages/DashboardPage.vue', () => ({ default: { render: () => null } }))
vi.mock('../../pages/CoursePlannerPage.vue', () => ({ default: { render: () => null } }))
vi.mock('../../pages/AssignmentsPage.vue', () => ({ default: { render: () => null } }))
vi.mock('../../pages/TasksPage.vue', () => ({ default: { render: () => null } }))
vi.mock('../../pages/PlannerPage.vue', () => ({ default: { render: () => null } }))
vi.mock('../../pages/ProfilePage.vue', () => ({ default: { render: () => null } }))

import router from '../index.js'
import { useAuthStore } from '../../stores/auth'

/** Sign the current auth store in, the way a restored session would. */
function signIn() {
  const auth = useAuthStore()
  auth.session = { access_token: 'e2e-token', user: { id: 'u-1', email: 'student@example.edu' } }
  auth.user = auth.session.user
  return auth
}

/** Navigate and report where the guard actually left us. */
async function land(path) {
  await router.push(path)
  return router.currentRoute.value.fullPath
}

// A fresh Pinia per test, so the auth store starts signed out every time.
beforeEach(() => {
  setActivePinia(createPinia())
})

describe('router auth guard', () => {
  it('lets a signed-out visitor onto the Course Planner', async () => {
    expect(useAuthStore().isAuthenticated).toBe(false)

    expect(await land('/course-planner')).toBe('/course-planner')
  })

  it('still sends a signed-out visitor from the dashboard to login', async () => {
    expect(await land('/dashboard')).toBe('/login?redirect=/dashboard')
  })

  it('keeps the rest of the app behind the auth wall', async () => {
    for (const path of ['/assignments', '/tasks', '/planner', '/profile']) {
      expect(await land(path)).toBe(`/login?redirect=${path}`)
    }
  })

  it('carries no requiresAuth flag on the Course Planner route', async () => {
    // The route table is the thing that actually opened the page up, so assert
    // it directly - a re-added `requiresAuth: true` would re-close it.
    expect(router.resolve('/course-planner').meta.requiresAuth).toBeFalsy()
    expect(router.resolve('/dashboard').meta.requiresAuth).toBe(true)
  })

  it('lets a signed-in user onto the Course Planner unchanged', async () => {
    signIn()

    expect(await land('/course-planner')).toBe('/course-planner')
  })

  it('bounces a signed-in user off the login page', async () => {
    signIn()

    expect(await land('/login')).toBe('/dashboard')
  })
})
