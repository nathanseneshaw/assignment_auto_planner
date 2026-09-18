// The Course Planner is the one app page a signed-out visitor can open, so it
// carries two pieces of UI nobody else sees: a sign-up nudge, and the school
// picker inline (a guest has no profile page to be sent to).
//
// Why this lives in Vitest rather than the e2e suite: the banner is gated on
// `isSupabaseConfigured`, and the e2e app runs with blank Supabase credentials
// on purpose - there is no way to render the banner in a browser test. Here the
// module can simply be mocked as configured.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Configured, but with no client: the page only reads the flag, and nothing
// here calls `authStore.init()`, so the store stays signed out unless a test
// says otherwise.
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: null }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ hash: '', query: {}, path: '/course-planner', meta: {} }),
}))
vi.mock('../../services/coursePlannerApi.js', () => ({
  listSchools: vi.fn(async () => ([
    { code: 'rice', name: 'Rice University', enrollmentDataAvailable: true },
    { code: 'ttu', name: 'Texas Tech University', enrollmentDataAvailable: true },
  ])),
  getTerms: vi.fn(async () => ([{ code: '202610', label: 'Fall 2026' }])),
  getSubjects: vi.fn(async () => ([{ code: 'COMP', label: 'Computer Science' }])),
  getSections: vi.fn(async () => ([])),
}))

import CoursePlannerPage from '../CoursePlannerPage.vue'
import { useAuthStore } from '../../stores/auth'
import { useProfileStore } from '../../stores/profile'
import { useCoursePlannerStore } from '../../stores/coursePlanner'

// vue-router is mocked away, so RouterLink is not globally registered. A real
// anchor stub keeps the link's target assertable.
const opts = {
  global: {
    mocks: { $router: { push: vi.fn() } },
    stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
  },
}

/** Mount the page and let `listSchools()` settle. */
async function mountPage() {
  const w = mount(CoursePlannerPage, opts)
  await flushPromises(); await nextTick()
  return w
}

/** Put the auth store in the state a restored session leaves it in. */
function signIn() {
  const auth = useAuthStore()
  auth.session = { access_token: 't', user: { id: 'u-1', email: 'student@example.edu' } }
  auth.user = auth.session.user
}

beforeEach(() => { setActivePinia(createPinia()) })

describe('CoursePlanner guest access', () => {
  it('nudges a signed-out visitor to sign up, and comes back here afterwards', async () => {
    const w = await mountPage()

    expect(w.text()).toContain("You're browsing as a guest")
    const signUp = w.find('a[href="/register?redirect=/course-planner"]')
    expect(signUp.exists(), 'the banner links to registration').toBe(true)
    expect(signUp.text()).toContain('Sign up free')
  })

  it('lets the visitor dismiss the sign-up nudge', async () => {
    const w = await mountPage()

    const dismiss = w.find('button[aria-label="Dismiss"]')
    expect(dismiss.exists()).toBe(true)
    await dismiss.trigger('click')
    await nextTick()

    expect(w.text()).not.toContain("You're browsing as a guest")
    // Dismissing the banner must not take the page down with it.
    expect(w.find('h1').text()).toContain('Course Planner')
  })

  it('offers the school picker inline instead of the auth-walled profile link', async () => {
    const w = await mountPage()

    expect(w.text()).toContain('Pick your university first')
    // /profile is behind requiresAuth, so sending a guest there is a dead end.
    expect(w.text()).not.toContain('Open Profile')
    expect(w.find('input[placeholder="Search universities…"]').exists()).toBe(true)
    expect(w.findAll('button').some((b) => b.text().includes('Rice University'))).toBe(true)
  })

  it('points the planner at the catalog the guest picks', async () => {
    const w = await mountPage()

    const rice = w.findAll('button').find((b) => b.text().includes('Rice University'))
    await rice.trigger('click')
    await flushPromises(); await nextTick()

    expect(useProfileStore().profile.school).toBe('rice')
    expect(useCoursePlannerStore().schoolCode).toBe('rice')
    // The empty state is gone: the picker was the whole point of it.
    expect(w.text()).not.toContain('Pick your university first')
  })

  it('leaves the signed-in page exactly as it was', async () => {
    signIn()
    const w = await mountPage()

    expect(w.text()).not.toContain("You're browsing as a guest")
    expect(w.text()).toContain('Open Profile')
    expect(w.find('input[placeholder="Search universities…"]').exists()).toBe(false)
  })
})
