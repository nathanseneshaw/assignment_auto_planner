/**
 * End-to-end test: prove the UTD scraper returns data through BOTH clients.
 *
 *   Web:      open http://localhost:5173 in a real Chromium → fetch the UTD
 *             sections API from the page context (proves Vite proxy works
 *             AND the same code paths the Vue app uses are healthy).
 *   Electron: launch the actual Electron app via Playwright's _electron API
 *             → reach into the renderer's window → fetch the same endpoint.
 *
 * Prereqs (assumed already running):
 *   - Express server on :3001  (npm run server)
 *   - Vite dev server  on :5173 (npx vite)
 */
import { chromium, _electron as electron } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

const TERM = 'term_26f'
const SUBJECT = 'CS'
const QS = `term=${TERM}&subject=${SUBJECT}&termLabel=2026%20Fall&subjectLabel=Computer%20Science`

// Tag results so the summary at the end is unambiguous.
const results = []

// ── Web client test ─────────────────────────────────────────────────────────
{
  console.log('\n[WEB] Launching Chromium against http://localhost:5173 ...')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 })

    // The Vue app's apiBase.js hard-codes http://127.0.0.1:3001 in dev mode,
    // so fetch that directly from the page context to mirror what the app does.
    const data = await page.evaluate(async (qs) => {
      const r = await fetch(`http://127.0.0.1:3001/api/course-planner/utd/sections?${qs}`)
      return r.json()
    }, QS)

    const ok = data?.success && (data.count ?? 0) > 0
    console.log(`[WEB] success=${data?.success} count=${data?.count} first.crn=${data?.sections?.[0]?.crn}`)
    results.push({ client: 'web', ok, count: data?.count })
  } catch (e) {
    console.error('[WEB] FAIL', e.message)
    results.push({ client: 'web', ok: false, error: e.message })
  } finally {
    await browser.close()
  }
}

// ── Electron client test ────────────────────────────────────────────────────
{
  console.log('\n[ELECTRON] Launching app via Playwright _electron ...')
  // Must DELETE ELECTRON_RUN_AS_NODE, not set to "" — Electron checks
  // presence, not value (mirrors what scripts/launch-electron.cjs does).
  const env = { ...process.env, ELECTRON_DEV: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ cwd: PROJECT_ROOT, args: ['.'], env })
  try {
    // First window is the main BrowserWindow (loads http://localhost:5173 in dev mode).
    const win = await app.firstWindow({ timeout: 20000 })
    await win.waitForLoadState('domcontentloaded', { timeout: 15000 })

    // Verify our preload exposed only the sentinel (no .utd bridge anymore).
    const electronApi = await win.evaluate(() => ({
      isElectron: window.electronAPI?.isElectron,
      hasUtdBridge: !!window.electronAPI?.utd,
    }))
    console.log('[ELECTRON] window.electronAPI =', electronApi)

    // Hit the API from the renderer's context. In Electron-dev, the renderer
    // is served by Vite (proxy applies) — fall back to absolute :3001 either way.
    const data = await win.evaluate(async (qs) => {
      const r = await fetch(`http://127.0.0.1:3001/api/course-planner/utd/sections?${qs}`)
      return r.json()
    }, QS)

    const ok = data?.success && (data.count ?? 0) > 0
    console.log(`[ELECTRON] success=${data?.success} count=${data?.count} first.crn=${data?.sections?.[0]?.crn}`)
    results.push({ client: 'electron', ok, count: data?.count, electronApi })
  } catch (e) {
    console.error('[ELECTRON] FAIL', e.message)
    results.push({ client: 'electron', ok: false, error: e.message })
  } finally {
    await app.close()
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===')
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL'
  console.log(`  ${tag}  ${r.client.padEnd(8)}  count=${r.count ?? '-'}  ${r.error || ''}`)
}
const allOk = results.every((r) => r.ok)
if (!allOk) process.exitCode = 1
