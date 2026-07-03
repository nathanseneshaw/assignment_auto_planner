// Verifies the Course Planner results list *loads and renders section data*
// correctly — the open / full / closed distinction the user sees when deciding
// whether a class is joinable.
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ hash: '', query: {}, path: '/course-planner', meta: {} }),
}))
vi.mock('../../services/coursePlannerApi.js', () => ({
  listSchools: vi.fn(async () => ([{ code: 'rice', name: 'Rice University', enrollmentDataAvailable: true }])),
  getTerms: vi.fn(async () => ([{ code: '202610', label: 'Fall 2026' }])),
  getSubjects: vi.fn(async () => ([{ code: 'COMP', label: 'Computer Science' }])),
  getSections: vi.fn(async () => ([])),
}))

import CoursePlannerPage from '../CoursePlannerPage.vue'
import { useProfileStore } from '../../stores/profile'
import { useCoursePlannerStore } from '../../stores/coursePlanner'

function section(over = {}) {
  return {
    school: 'rice', termCode: '202610', crn: '1', subjectCode: 'COMP',
    courseNumber: '140', sectionNumber: '001', title: 'Intro to Programming',
    status: 'open', instructors: ['Dr. X'],
    enrollment: { max: 30, current: 10, available: 20 },
    meetings: [{ days: ['M', 'W'], startTime: '09:00', endTime: '10:00' }],
    ...over,
  }
}

const opts = { global: { mocks: { $router: { push: vi.fn() } } } }

/** Mount the page, then seed the results list as if a search had returned it. */
async function mountWithSections(sections) {
  useProfileStore().updateProfile({ school: 'rice' })
  const planner = useCoursePlannerStore()
  const w = mount(CoursePlannerPage, opts)
  await flushPromises(); await nextTick()
  // Drive the results panel out of its "pick a subject" empty state.
  planner.selectedTermCode = '202610'
  planner.selectedSubjectCode = 'COMP'
  planner.sections = sections
  await nextTick()
  return { w, planner }
}

beforeEach(() => { setActivePinia(createPinia()) })

describe('CoursePlanner section availability rendering', () => {
  it('renders an open section with its enrollment counts and an Add action', async () => {
    const { w } = await mountWithSections([section()])
    expect(w.text()).toContain('COMP 140')
    expect(w.text()).toContain('Open')
    // "10 / 30 enrolled · 20 open"
    expect(w.text()).toContain('10 / 30 enrolled')
    expect(w.text()).toContain('20 open')
    const addBtn = w.findAll('button').find((b) => b.text().trim() === 'Add')
    expect(addBtn, 'an open section should offer an Add button').toBeTruthy()
  })

  it('marks a full section (available 0) as Full and offers no Add button', async () => {
    const { w } = await mountWithSections([
      section({ crn: 'FULL', enrollment: { max: 30, current: 30, available: 0 } }),
    ])
    expect(w.text()).toContain('Full')
    const addBtn = w.findAll('button').find((b) => b.text().trim() === 'Add')
    expect(addBtn).toBeFalsy()
  })

  it('marks a closed section as Closed', async () => {
    const { w } = await mountWithSections([
      section({ crn: 'CLOSED', status: 'closed' }),
    ])
    expect(w.text()).toContain('Closed')
    const addBtn = w.findAll('button').find((b) => b.text().trim() === 'Add')
    expect(addBtn).toBeFalsy()
  })

  it('renders a mixed list: open is addable, full/closed are not', async () => {
    const { w } = await mountWithSections([
      section({ crn: 'A', courseNumber: '101' }),
      section({ crn: 'B', courseNumber: '202', enrollment: { max: 20, current: 20, available: 0 } }),
      section({ crn: 'C', courseNumber: '303', status: 'closed' }),
    ])
    expect(w.text()).toContain('COMP 101')
    expect(w.text()).toContain('COMP 202')
    expect(w.text()).toContain('COMP 303')
    // Exactly one Add button — only the open section.
    const addButtons = w.findAll('button').filter((b) => b.text().trim() === 'Add')
    expect(addButtons).toHaveLength(1)
  })

  it('adding an open section swaps its Add button for a Remove action', async () => {
    const { w, planner } = await mountWithSections([section()])
    const addBtn = w.findAll('button').find((b) => b.text().trim() === 'Add')
    await addBtn.trigger('click')
    await nextTick()
    expect(planner.savedSections).toHaveLength(1)
    const removeBtn = w.findAll('button').find((b) => b.text().trim() === 'Remove')
    expect(removeBtn, 'a saved section should offer a Remove button').toBeTruthy()
  })
})
