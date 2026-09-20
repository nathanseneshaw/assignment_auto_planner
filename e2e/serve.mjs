/**
 * Builds (when stale) and serves the app for the Playwright suite.
 *
 * Why a build instead of the Vite dev server: in dev the app is served as
 * hundreds of individual unbundled ES modules per page load. With several
 * Playwright workers loading pages at once, that single Node process becomes
 * the bottleneck and simple tests stretch from ~2s to ~30s. Serving a built
 * bundle turns each page load into a handful of static requests, so the suite
 * stays fast and parallel-safe as it grows.
 *
 * The build is skipped when `dist-e2e/` is already newer than every input it
 * depends on, so iterating on specs (which are not build inputs) costs nothing.
 * Pass `--force` to rebuild unconditionally.
 *
 * `--base=/` overrides the repo's relative `base: './'`. Relative asset URLs
 * break under history-mode routing on nested paths: at `/auth/confirm`,
 * `./assets/app.js` resolves to `/auth/assets/app.js` and 404s.
 */
import { spawn } from 'node:child_process'
import { statSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = 'dist-e2e'
const PORT = process.env.E2E_PORT || '5174'

/** Files and trees whose change should invalidate the built bundle. */
const BUILD_INPUTS = ['src', 'index.html', 'vite.config.js', 'package.json', '.env.e2e', '.env.local']

function newestMtime(path) {
  if (!existsSync(path)) return 0
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.mtimeMs
  let newest = stat.mtimeMs
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    // Test directories are not build inputs; editing a spec must not force a rebuild.
    if (entry.isDirectory() && (entry.name === '__tests__' || entry.name === 'tests')) continue
    newest = Math.max(newest, newestMtime(join(path, entry.name)))
  }
  return newest
}

function needsBuild() {
  if (process.argv.includes('--force')) return true
  const builtIndex = join(ROOT, OUT_DIR, 'index.html')
  if (!existsSync(builtIndex)) return true
  const builtAt = statSync(builtIndex).mtimeMs
  return BUILD_INPUTS.some((input) => newestMtime(join(ROOT, input)) > builtAt)
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`vite ${args[0]} exited with ${code}`))
    )
  })
}

if (needsBuild()) {
  console.log('[e2e] building app for tests...')
  await run(['build', '--mode', 'e2e', '--base=/', '--outDir', OUT_DIR, '--emptyOutDir'])
} else {
  console.log(`[e2e] reusing existing ${OUT_DIR} build`)
}

await run([
  'preview',
  '--mode',
  'e2e',
  '--outDir',
  OUT_DIR,
  '--host',
  '127.0.0.1',
  '--port',
  PORT,
  '--strictPort',
])
