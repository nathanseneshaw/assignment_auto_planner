/**
 * Populate process.env with Supabase + config vars. Three sources, in order:
 *   1. Local .env / .env.local files (developer machine).
 *   2. Build-time baked credentials in env.generated.js (Electron packaged builds).
 *   3. Anything the parent process / platform already injected (Vercel, Render, CI).
 *
 * Precedence: variables already present in process.env always win, so dev
 * overrides (env.local) beat baked-in creds, and platform injections beat both.
 * `applyMerged` only sets keys that are currently undefined, which gives that
 * ordering regardless of which source loads first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseEnvFile(filePath) {
  const out = {}
  if (!fs.existsSync(filePath)) return out
  const raw = fs.readFileSync(filePath, 'utf8')
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
    }
    out[key] = val
  }
  return out
}

function applyMerged(merged) {
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
}

// Local dev: .env / .env.local on disk. Absent in packaged builds.
const base = parseEnvFile(path.join(__dirname, '.env'))
const local = parseEnvFile(path.join(__dirname, '.env.local'))
applyMerged({ ...base, ...local })

// Packaged Electron: build-time baked anon creds. Absent in dev.
const generatedPath = path.join(__dirname, 'env.generated.js')
if (fs.existsSync(generatedPath)) {
  const { bakedEnv } = await import('./env.generated.js')
  applyMerged(bakedEnv)
}
