/**
 * Populate `src/server/node_modules/` with the runtime dependencies the
 * embedded Express server needs at runtime in a packaged Electron build.
 *
 * Background: there is only one canonical `package.json` (the root one).
 * Vercel installs from it directly. For Electron we still need to ship a
 * self-contained server folder because electron-builder's `extraResources`
 * copies `src/server/**` into `resources/server/`, and the spawned Node
 * child process resolves modules starting from that path. This script
 * recursively copies the required packages (and their transitive deps)
 * from the root install into `src/server/node_modules/` just before the
 * Electron build runs.
 *
 * Dev mode does not need this: when running `node src/server/index.js`
 * from the repo root, Node's normal module resolution walks up the tree
 * and finds the packages in the root `node_modules/`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const ROOT_MODULES = path.join(ROOT, 'node_modules')
const TARGET_MODULES = path.join(ROOT, 'src', 'server', 'node_modules')

// The packages `src/server/**/*.js` actually imports at runtime.
// Keep this in sync with the imports in `src/server/`.
const SERVER_RUNTIME_DEPS = [
  '@supabase/supabase-js',
  'cors',
  'express',
  'express-rate-limit',
  'node-ical',
  'ws',
]

function readPackageJson(packageDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Resolve a dep `name` for a package living at `fromDir` by walking up the
 * node_modules chain, the same way Node does. Returns the absolute source
 * directory, or null if not installed anywhere reachable.
 */
function resolveDep(name, fromDir) {
  let dir = fromDir
  while (true) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function copyPackage(name, fromDir, copied) {
  if (copied.has(name)) return
  const sourceDir = resolveDep(name, fromDir)
  if (!sourceDir) {
    throw new Error(
      `copy-server-deps: cannot resolve "${name}" from "${fromDir}". ` +
        'Run `npm install` at the repo root first.'
    )
  }
  copied.add(name)

  const targetDir = path.join(TARGET_MODULES, name)
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.cpSync(sourceDir, targetDir, { recursive: true, dereference: true })

  const pkg = readPackageJson(sourceDir)
  if (pkg?.dependencies) {
    for (const dep of Object.keys(pkg.dependencies)) {
      copyPackage(dep, sourceDir, copied)
    }
  }
  if (pkg?.optionalDependencies) {
    for (const dep of Object.keys(pkg.optionalDependencies)) {
      // Best-effort — skip silently if missing (npm may have pruned it).
      try {
        copyPackage(dep, sourceDir, copied)
      } catch {}
    }
  }
}

function main() {
  if (fs.existsSync(TARGET_MODULES)) {
    fs.rmSync(TARGET_MODULES, { recursive: true, force: true })
  }

  const copied = new Set()
  for (const dep of SERVER_RUNTIME_DEPS) {
    copyPackage(dep, path.join(ROOT, 'src', 'server'), copied)
  }

  console.log(
    `copy-server-deps: copied ${copied.size} packages into ` +
      `${path.relative(ROOT, TARGET_MODULES)}`
  )
}

main()
