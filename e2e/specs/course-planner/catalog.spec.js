/**
 * Course Planner: getting to a list of sections.
 *
 * The page is a three-step cascade driven entirely by the backend - school
 * (from the profile) picks the catalogue, term picks the subject list, subject
 * picks the sections. Each step here is one stubbed endpoint and one visible
 * consequence.
 */
import { test, expect } from '../../fixtures/test.js'
import { profileSeed } from '../../fixtures/seed.js'
import {
  ENDPOINTS,
  SCHOOL_CODE,
  SCHOOL_NAME,
  SUBJECT_OPTION,
  mockCatalog,
  pickSubject,
  pickTerm,
} from '../../mocks/course-planner.js'

test.describe('course planner catalogue', () => {
  test('prompts for a university when the profile has no school', async ({ app, api, page }) => {
    mockCatalog(api)

    await app.goto('/course-planner')

    await expect(page.getByRole('heading', { name: 'Pick your university first' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Profile' })).toBeVisible()
    // Nothing to browse yet, so the page must not go looking for a catalogue.
    expect(api.callsTo(ENDPOINTS.terms)).toHaveLength(0)
    expect(api.unmatched).toHaveLength(0)
  })

  test("picking a school loads that school's terms", async ({ app, api, page }) => {
    mockCatalog(api)
    await app.goto('/course-planner')
    await expect(page.getByRole('heading', { name: 'Pick your university first' })).toBeVisible()

    // What the university picker on the profile page ultimately does.
    await app.store('profile').invoke('updateProfile', { school: SCHOOL_CODE })

    await api.waitForCall(ENDPOINTS.terms)
    await page.getByRole('button', { name: 'Select a term' }).click()
    await expect(page.getByRole('option', { name: 'Fall 2026' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Spring 2027' })).toBeVisible()
  })

  test('picking a term and a subject renders that subject\'s sections', async ({ app, api, page }) => {
    mockCatalog(api)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
    await app.goto('/course-planner')

    await expect(page.getByText(SCHOOL_NAME)).toBeVisible()

    await pickTerm(page)
    // Subjects are fetched for the term that was just chosen.
    await page.getByRole('button', { name: 'Select a subject' }).click()
    await expect(page.getByRole('option', { name: SUBJECT_OPTION.COMP })).toBeVisible()
    await page.getByRole('option', { name: SUBJECT_OPTION.COMP }).click()

    await expect(page.getByText('Algorithmic Thinking')).toBeVisible()
    await expect(page.getByText('Grace Hopper')).toBeVisible()
    await expect(page.getByText('5 / 40 enrolled · 35 open')).toBeVisible()
    // Six sections came back; the two unregisterable ones are filtered by default.
    await expect(page.getByText('Results · 4')).toBeVisible()
  })

  test('says so when a subject runs no classes in the term', async ({ app, api, page }) => {
    mockCatalog(api)
    app.seedLocalStorage(profileSeed({ school: SCHOOL_CODE }))
    await app.goto('/course-planner')

    await pickTerm(page)
    await pickSubject(page, SUBJECT_OPTION.PHYS)

    await expect(page.getByText('PHYS has no classes in Fall 2026.')).toBeVisible()
    expect(api.unmatched).toHaveLength(0)
  })
})
