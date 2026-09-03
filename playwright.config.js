/**
 * Playwright end-to-end configuration.
 *
 * The suite drives the real Vue app served by Vite in a dedicated `e2e` mode
 * (see `.env.e2e`), which blanks the Supabase credentials. That single switch
 * puts the app in local-only mode: the router auth guard becomes a no-op and no
 * store can reach a real backend, so every test starts from an identical,
 * offline, deterministic app.
 *
 * Backend HTTP (course planner, ICS, syllabus) is stubbed per test through the
 * `api` fixture in e2e/fixtures/test.js. Anything not explicitly stubbed is
 * failed with a 503 so a forgotten mock surfaces as a test failure rather than
 * a silent hang.
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 5174)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.spec.js',
  // Vue route transitions plus store hydration make sub-second assertions
  // flaky; 30s per test is comfortable without hiding real hangs.
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  // A `.only` left in a spec silently shrinks CI coverage, so fail the run.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Off by default, and deliberately so. Playwright records video for EVERY
    // test under `retain-on-failure` and discards it afterwards; with parallel
    // headless workers rendering through software GL, that encoding starves the
    // CPU badly enough that context teardown blows the test timeout and healthy
    // tests fail. Set E2E_VIDEO=1 when you actually need footage of a failure.
    video: process.env.E2E_VIDEO ? 'retain-on-failure' : 'off',
    testIdAttribute: 'data-testid',
    // Deterministic viewport: several layouts switch to the mobile nav below
    // the `md` breakpoint, and tests that want that opt in explicitly.
    viewport: { width: 1280, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // e2e/serve.mjs builds the app (only when stale) and serves the bundle.
    // Serving a build rather than the dev server is what keeps the suite fast
    // under parallel workers - see the comment at the top of that file.
    //
    // It binds 127.0.0.1 explicitly: Vite's default `localhost` can resolve to
    // ::1 first on Windows, which makes Playwright's readiness probe against
    // the IPv4 baseURL time out even though the server is up.
    command: 'node e2e/serve.mjs',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Generous: covers a cold production build on a slow machine.
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
