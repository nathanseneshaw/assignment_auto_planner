/**
 * Syllabus import - the "Syllabus import" integration row on /profile.
 *
 * Like the ICS feeds above it, `syllabusService.parseSyllabus` mints a bearer
 * token from the Supabase session before it uploads, and `.env.e2e` leaves
 * Supabase unconfigured. The upload therefore fails at that guard and
 * `/api/syllabus/parse` is never requested, so the review modal (and everything
 * downstream of it) is out of reach at this level. What a browser test can
 * still prove is the whole client-side half: the signed-out gate, file
 * selection, client-side file validation, and how a failed parse is reported.
 *
 * File selection goes through Playwright's file chooser rather than
 * `setInputFiles` on the element, because the real <input type="file"> is
 * `display: none` and only reachable by clicking "Import".
 */
import { test, expect } from '../../fixtures/test.js'
import { pdfUpload, unsupportedUpload, NO_SUPABASE_ERROR } from '../../mocks/planner.js'

/** A Supabase user object, enough for the components' `authStore.user` checks. */
const SIGNED_IN_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'student@example.edu',
  user_metadata: { full_name: 'Test Student' },
}

test.beforeEach(async ({ api }) => {
  api.json('/api/course-planner/schools', { success: true, schools: [] })
})

/** Pick `file` through the row's Import button, which opens the real chooser. */
async function chooseSyllabus(page, file) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await (await chooser).setFiles(file)
}

test.describe('syllabus import on the profile page', () => {
  test('asks the user to sign in before a syllabus can be imported', async ({ app, page }) => {
    await app.goto('/profile')

    await expect(page.getByText('Syllabus import')).toBeVisible()
    await expect(page.getByText('Sign in to import a syllabus')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  })

  test('accepts a PDF and offers to parse it', async ({ app, page }) => {
    await app.goto('/profile')
    await app.store('auth').patch({ user: SIGNED_IN_USER })

    await expect(page.getByText('PDF or DOCX, up to 5 MB · AI pulls out due dates')).toBeVisible()

    await chooseSyllabus(page, pdfUpload('algorithms-syllabus.pdf'))

    await expect(page.getByText('algorithms-syllabus.pdf · ready to parse')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Parse' })).toBeEnabled()
  })

  test('rejects a file type it cannot read', async ({ app, page }) => {
    await app.goto('/profile')
    await app.store('auth').patch({ user: SIGNED_IN_USER })

    await chooseSyllabus(page, unsupportedUpload('notes.txt'))

    await expect(page.getByText('Only .pdf and .docx files are supported.')).toBeVisible()
    // The file was refused, so the row falls back to its "pick one" action.
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Parse' })).toHaveCount(0)
  })

  test('reports a failed parse on the row instead of hanging', async ({ app, page, api }) => {
    api.offline('/api/syllabus/parse')

    await app.goto('/profile')
    await app.store('auth').patch({ user: SIGNED_IN_USER })

    await chooseSyllabus(page, pdfUpload('algorithms-syllabus.pdf'))
    await page.getByRole('button', { name: 'Parse' }).click()

    await expect(page.getByText(NO_SUPABASE_ERROR)).toBeVisible()
    // Back out of the "Parsing…" state, so the user can retry.
    await expect(page.getByRole('button', { name: 'Parse' })).toBeEnabled()
    // The session guard rejects before the upload is attempted.
    expect(api.callsTo('/api/syllabus')).toHaveLength(0)
  })
})
