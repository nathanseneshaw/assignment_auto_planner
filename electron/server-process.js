/**
 * Manages the embedded Express API server as a child process.
 *
 * In production, the server folder is shipped via electron-builder's
 * `extraResources` into `resources/server/`, so we can spawn it with
 * Electron's bundled Node binary (`process.execPath` + ELECTRON_RUN_AS_NODE)
 * without depending on a system Node install or asar packing.
 *
 * In development, the server is already started by `concurrently` in the
 * `electron:dev` script, so `startServer()` performs a health check first
 * and skips the spawn if the port is already responding.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { app } from 'electron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SERVER_PORT = 3001
const HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/api/health`
const HEALTH_TIMEOUT_MS = 15_000
const HEALTH_INTERVAL_MS = 200

let childProcess = null

/**
 * Resolve the server entry point. In dev, the source lives in the repo at
 * `src/server/index.js`. In a packaged build, electron-builder copies the
 * server folder to `resources/server/`.
 */
function resolveServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server', 'index.js')
  }
  return path.join(__dirname, '..', 'src', 'server', 'index.js')
}

/**
 * One-shot health probe — resolves to true if the server returns HTTP 200
 * within ~1s, false otherwise. Used both for the "is something already
 * listening?" pre-check and the post-spawn readiness poll.
 */
async function probeHealth(timeoutMs = 1000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Poll the health endpoint at a fixed interval until it returns 200 or the
 * overall deadline elapses. Resolves on success, rejects with a descriptive
 * error otherwise.
 */
async function waitForHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probeHealth()) return
    // If the child died during startup, fail fast instead of waiting the full
    // 15s — the stderr pipe will already have logged the underlying cause.
    if (childProcess && childProcess.exitCode !== null) {
      throw new Error(
        `[server] child exited with code ${childProcess.exitCode} before becoming healthy`
      )
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS))
  }
  throw new Error(`[server] did not become healthy within ${HEALTH_TIMEOUT_MS}ms`)
}

/**
 * Start the embedded API server. If something is already listening on the
 * health endpoint (e.g. `electron:dev`'s concurrently-spawned server), this
 * is a no-op. Otherwise spawns Electron's bundled Node as a child process
 * and waits until the health endpoint responds.
 */
export async function startServer() {
  if (await probeHealth()) {
    console.log('[server] already running, skipping spawn')
    return
  }

  const serverPath = resolveServerPath()
  if (!fs.existsSync(serverPath)) {
    throw new Error(`[server] entry point not found at ${serverPath}`)
  }

  console.log(`[server] spawning: ${serverPath}`)

  childProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(SERVER_PORT),
      // Intentionally NOT setting NODE_ENV=production: the embedded server is
      // a loopback-only sidecar to the desktop app, not an internet-facing
      // deployment. The src/server/index.js CORS-allowlist boot guard treats
      // NODE_ENV=production as "this is publicly reachable" — true on Vercel,
      // false here. Don't claim a stricter posture than reality.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  childProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`)
  })
  childProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[server] ${chunk}`)
  })

  childProcess.on('exit', (code, signal) => {
    console.log(`[server] child exited code=${code} signal=${signal}`)
    childProcess = null
  })

  await waitForHealthy()
  console.log('[server] healthy')
}

/**
 * Terminate the child process if we own one. Safe to call multiple times.
 */
export function stopServer() {
  if (!childProcess) return
  console.log('[server] stopping child process')
  try {
    childProcess.kill()
  } catch (err) {
    console.error('[server] error killing child:', err)
  }
  childProcess = null
}
