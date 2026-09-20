/**
 * Calendar (ICS) feeds - the "Connected integrations" section of /profile.
 *
 * IMPORTANT, and the reason these tests look the way they do: `icsService`
 * builds an `Authorization` header from the Supabase session *before* it calls
 * the backend, and `.env.e2e` leaves Supabase unconfigured. Every feed
 * operation therefore fails at that client-side guard with
 * "Supabase is not configured" and no HTTP request is ever issued.
 *
 * So the endpoints stubbed here are deliberately never reached; they are
 * registered as `api.fail` / `api.offline` to prove the failure the user sees
 * is the guard rather than a hung request, and each such test asserts that the
 * network was not touched. Rendering of the connected-feed list is driven by
 * seeding the `icsFeeds` store with rows shaped exactly like the server's
 * `ics_feeds` select, which is the same data path a real GET would produce.
 */
import { test, expect } from '../../fixtures/test.js'
import { makeIcsFeed, NO_SUPABASE_ERROR } from '../../mocks/planner.js'

const FEED_URL = 'https://canvas.instructure.com/feeds/calendars/user_abc123.ics'
/** The real placeholder on the add-feed URL field (IcsFeedsManager.vue). */
const URL_PLACEHOLDER = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics'

test.beforeEach(async ({ api }) => {
  // /profile loads the Course Planner school list on mount. Not this area's
  // concern, but leaving it unstubbed pollutes `api.unmatched`.
  api.json('/api/course-planner/schools', { success: true, schools: [] })
})

test.describe('ICS feeds on the profile page', () => {
  test('offers a Connect action when no calendar feed is subscribed', async ({ app, page }) => {
    await app.goto('/profile')

    await expect(page.getByText('Calendar feed (ICS)')).toBeVisible()
    await expect(page.getByText('Canvas, Brightspace, Blackboard · subscribe via URL')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
    // Nothing is connected, so no "add another" row exists yet.
    await expect(page.getByText('Add another feed')).toHaveCount(0)
  })

  test('asks for a URL before a feed can be added', async ({ app, page }) => {
    await app.goto('/profile')

    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.getByText('Add a calendar feed')).toBeVisible()

    await page.getByRole('button', { name: 'Add feed' }).click()

    await expect(page.getByText('Paste an ICS calendar URL.')).toBeVisible()
    // The panel stays open so the user can correct it in place.
    await expect(page.getByPlaceholder(URL_PLACEHOLDER)).toBeVisible()
  })

  test('surfaces an error instead of hanging when the feed backend cannot be reached', async ({ app, page, api }) => {
    api.offline('/api/ics/feeds')
    api.offline('/api/ics/sync')

    await app.goto('/profile')

    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByPlaceholder(URL_PLACEHOLDER).fill('https://example.edu/calendar/mine.ics')
    await page.getByRole('button', { name: 'Add feed' }).click()

    // The add form reports the failure inline rather than spinning forever.
    await expect(page.getByText(NO_SUPABASE_ERROR)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add feed' })).toBeEnabled()
    // ...and it never got as far as the network: the session guard rejects first.
    expect(api.callsTo('/api/ics')).toHaveLength(0)
  })

  test('lists each subscribed feed with its URL and sync status', async ({ app, page }) => {
    await app.goto('/profile')

    await app.store('icsFeeds').patch({
      feeds: [
        makeIcsFeed({ id: 'feed-ok', label: 'Canvas', url: FEED_URL }),
        makeIcsFeed({
          id: 'feed-bad',
          label: 'Brightspace',
          url: 'https://d2l.example.edu/d2l/le/calendar/feed/user_9.ics',
          last_sync_status: 'error',
          last_sync_error: 'The feed URL could not be fetched or parsed.',
        }),
      ],
    })

    await expect(page.getByText('Canvas', { exact: true })).toBeVisible()
    await expect(page.getByText(FEED_URL)).toBeVisible()
    await expect(page.getByText('Not synced yet')).toBeVisible()
    await expect(page.getByRole('button', { name: /Connected/ })).toBeVisible()

    // A feed whose last sync failed shows the server's reason and a Retry action.
    await expect(page.getByText('Brightspace', { exact: true })).toBeVisible()
    await expect(page.getByText('The feed URL could not be fetched or parsed.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible()

    // With feeds present the onboarding row is replaced by "add another".
    await expect(page.getByText('Add another feed')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0)
  })

  test('asks for confirmation before removing a feed and keeps it on cancel', async ({ app, page }) => {
    await app.goto('/profile')

    await app.store('icsFeeds').patch({
      feeds: [makeIcsFeed({ id: 'feed-ok', label: 'Canvas', url: FEED_URL })],
    })

    await page.getByRole('button', { name: 'Remove feed' }).click()

    await expect(page.getByRole('heading', { name: 'Remove this feed?' })).toBeVisible()
    await expect(
      page.getByText('All courses and assignments imported from this feed will be permanently deleted.')
    ).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('heading', { name: 'Remove this feed?' })).toHaveCount(0)
    await expect(page.getByText('Canvas', { exact: true })).toBeVisible()
  })

  test('reports a failed sync instead of leaving the row spinning', async ({ app, page, api }) => {
    api.offline('/api/ics/sync')

    const alerts = []
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message())
      return dialog.dismiss()
    })

    await app.goto('/profile')
    await app.store('icsFeeds').patch({
      feeds: [makeIcsFeed({ id: 'feed-ok', label: 'Canvas', url: FEED_URL })],
    })

    await page.getByRole('button', { name: /Connected/ }).click()

    // The error is reported and the row settles back out of its syncing state.
    await expect.poll(() => alerts).toContain(NO_SUPABASE_ERROR)
    await expect(page.getByRole('button', { name: /Connected/ })).toBeEnabled()
    expect(api.callsTo('/api/ics/sync')).toHaveLength(0)
  })
})
