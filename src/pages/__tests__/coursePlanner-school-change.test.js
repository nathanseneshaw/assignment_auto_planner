// TEMP diagnostic — reproduce "changing university breaks the app".
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ hash: '', query: {}, path: '/profile', meta: {} }),
}))
vi.mock('../../services/coursePlannerApi.js', () => ({
  listSchools: vi.fn(async () => ([
    { code: 'rice', name: 'Rice University', enrollmentDataAvailable: true },
    { code: 'ttu', name: 'Texas Tech University', enrollmentDataAvailable: true },
  ])),
  getTerms: vi.fn(async () => ([{ code: '202610', label: 'Fall 2026' }])),
  getSubjects: vi.fn(async () => ([{ code: 'COMP', label: 'Computer Science' }])),
  getSections: vi.fn(async () => ([sampleSection()])),
}))

import CoursePlannerPage from '../CoursePlannerPage.vue'
import { useProfileStore } from '../../stores/profile'
import { useCoursePlannerStore } from '../../stores/coursePlanner'

function sampleSection(over = {}) {
  return {
    school: 'rice', termCode: '202610', crn: '12345', subjectCode: 'COMP',
    courseNumber: '140', sectionNumber: '001', title: 'Intro to Programming',
    status: 'open', instructors: ['Dr. X'],
    enrollment: { max: 30, current: 10, available: 20 },
    meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '10:00' }],
    ...over,
  }
}

const opts = { global: { mocks: { $router: { push: vi.fn() } } } }

describe('CoursePlanner school change', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('mounts with a school + saved section', async () => {
    useProfileStore().updateProfile({ school: 'rice' })
    useCoursePlannerStore().addSection(sampleSection())
    const w = mount(CoursePlannerPage, opts)
    await flushPromises(); await nextTick()
    expect(w.find('h1').text()).toContain('Course Planner')
  })

  it('survives the exact ProfilePage school-change while mounted', async () => {
    const profile = useProfileStore(); profile.updateProfile({ school: 'rice' })
    const planner = useCoursePlannerStore(); planner.addSection(sampleSection())
    const w = mount(CoursePlannerPage, opts)
    await flushPromises(); await nextTick()
    // This is literally what ProfilePage's selectedSchool setter runs:
    profile.updateProfile({ school: 'ttu' })
    planner.resetForSchoolChange()
    await flushPromises(); await nextTick()
    expect(w.html()).toBeTruthy()
  })

  it('mounts fresh after switching to a new school', async () => {
    useProfileStore().updateProfile({ school: 'ttu' })
    const w = mount(CoursePlannerPage, opts)
    await flushPromises(); await nextTick()
    expect(w.find('h1').text()).toContain('Course Planner')
  })
})

describe('ProfilePage university change (real picker)', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('clicking a different university does not throw', async () => {
    const ProfilePage = (await import('../ProfilePage.vue')).default
    useProfileStore().updateProfile({ school: 'rice' })
    const w = mount(ProfilePage, {
      global: {
        stubs: { IcsFeedsManager: true, SyllabusParser: true, RouterLink: true },
        mocks: { $router: { push: vi.fn() }, $route: { hash: '', query: {}, path: '/profile' } },
      },
    })
    await flushPromises(); await nextTick()

    const ttuBtn = w.findAll('button').find((b) => b.text().includes('Texas Tech'))
    expect(ttuBtn, 'Texas Tech option should render in the picker').toBeTruthy()
    await ttuBtn.trigger('click')
    await flushPromises(); await nextTick()

    expect(useProfileStore().profile.school).toBe('ttu')
    expect(w.html()).toBeTruthy()
  })
})
