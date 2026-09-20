/**
 * Tests for src/server/index.js — the Express bootstrap.
 *
 * Two hazards shape this file:
 *
 *  1. Importing index.js calls `app.listen(PORT, HOST)` immediately unless
 *     `process.env.VERCEL` is set. It is therefore set BEFORE any dynamic
 *     import below, so the suite never leaves a socket bound to :3001.
 *  2. `parseAllowedOrigins()` and the production guard both run at import time
 *     and neither is exported, so each configuration is exercised by importing
 *     the module afresh under a different query string (which gives it a new
 *     module instance while its own `./load-env.js` import stays cached).
 *
 * The servers started here bind an ephemeral port (`listen(0)`) and are closed
 * — connections included — before each test returns.
 */
process.env.VERCEL = '1'

import assert from 'node:assert'
import { describe, it, after } from 'node:test'

// Each imported copy of index.js registers its own process-level error
// handlers; raise the cap so Node does not emit a MaxListeners warning.
process.setMaxListeners(30)

const DESKTOP_ORIGIN = 'https://plannr-desktop.app'
const CORS_KEYS = ['ALLOWED_ORIGINS', 'FRONTEND_URL', 'NODE_ENV']

/**
 * Import a fresh copy of index.js with exactly the given CORS-relevant env.
 * Any other value of those three vars is removed for the duration of the
 * import so a developer's shell cannot change the result.
 */
async function loadApp(tag, env = {}) {
  const saved = {}
  for (const key of CORS_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  try {
    const mod = await import(`../index.js?cfg=${tag}`)
    return mod.default
  } finally {
    for (const key of CORS_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

const openServers = new Set()

/** Run `fn(baseUrl)` against an ephemeral-port server, then close it fully. */
async function withServer(app, fn) {
  const server = app.listen(0)
  openServers.add(server)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    openServers.delete(server)
  }
}

after(() => {
  // Belt and braces: nothing may outlive the suite.
  for (const server of openServers) {
    server.closeAllConnections?.()
    server.close()
  }
  assert.equal(openServers.size, 0, 'a test left a listening server behind')
})

/** GET a path, optionally with an Origin header, returning status + ACAO. */
async function get(base, path, origin) {
  const res = await fetch(`${base}${path}`, {
    headers: { Connection: 'close', ...(origin ? { Origin: origin } : {}) },
  })
  return {
    status: res.status,
    acao: res.headers.get('access-control-allow-origin'),
    body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text(),
  }
}

// ── routes ────────────────────────────────────────────────────────────────────

describe('server routes', () => {
  it('GET /api/health reports ok with a timestamp', async () => {
    const app = await loadApp('health')
    await withServer(app, async (base) => {
      const res = await get(base, '/api/health')
      assert.equal(res.status, 200)
      assert.equal(res.body.status, 'ok')
      assert.ok(
        !Number.isNaN(Date.parse(res.body.timestamp)),
        `timestamp is not a date: ${res.body.timestamp}`
      )
    })
  })

  it('GET / describes the service and points at the health probe', async () => {
    const app = await loadApp('root')
    await withServer(app, async (base) => {
      const res = await get(base, '/')
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, {
        service: 'assignment-planner-api',
        health: '/api/health',
      })
    })
  })

  it('answers 404 for an unknown path', async () => {
    const app = await loadApp('notfound')
    await withServer(app, async (base) => {
      const res = await get(base, '/definitely-not-a-route')
      assert.equal(res.status, 404)
    })
  })
})

// ── CORS: empty allowlist (development) ───────────────────────────────────────

describe('CORS with no configured allowlist', () => {
  it('reflects any origin (dev convenience)', async () => {
    const app = await loadApp('cors-open')
    await withServer(app, async (base) => {
      const a = await get(base, '/api/health', 'https://anything.example')
      assert.equal(a.acao, 'https://anything.example')
      const b = await get(base, '/api/health', 'http://localhost:5173')
      assert.equal(b.acao, 'http://localhost:5173')
    })
  })

  it('serves requests that carry no Origin header at all', async () => {
    const app = await loadApp('cors-noorigin')
    await withServer(app, async (base) => {
      const res = await get(base, '/api/health')
      assert.equal(res.status, 200)
    })
  })

  it('treats a whitespace-only ALLOWED_ORIGINS as no allowlist', async () => {
    // parseAllowedOrigins trims and drops empties; if it did not, the list
    // would be non-empty and every real origin would be rejected.
    const app = await loadApp('cors-blank', { ALLOWED_ORIGINS: '  ,  , ' })
    await withServer(app, async (base) => {
      const res = await get(base, '/api/health', 'https://anything.example')
      assert.equal(res.acao, 'https://anything.example')
    })
  })
})

// ── CORS: configured allowlist ────────────────────────────────────────────────

describe('CORS with a configured allowlist', () => {
  it('allows listed origins and rejects everything else', async () => {
    const app = await loadApp('cors-list', {
      ALLOWED_ORIGINS: 'https://plannr.app,https://www.plannr.app',
    })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://plannr.app')).acao, 'https://plannr.app')
      assert.equal(
        (await get(base, '/api/health', 'https://www.plannr.app')).acao,
        'https://www.plannr.app'
      )
      const denied = await get(base, '/api/health', 'https://evil.example')
      assert.equal(denied.acao, null, 'a rejected origin must get no CORS header')
      assert.equal(denied.status, 200, 'rejection is a CORS decision, not an HTTP error')
    })
  })

  it('trims whitespace around comma-separated entries', async () => {
    const app = await loadApp('cors-spaces', {
      ALLOWED_ORIGINS: '  https://a.example ,   https://b.example  ',
    })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://a.example')).acao, 'https://a.example')
      assert.equal((await get(base, '/api/health', 'https://b.example')).acao, 'https://b.example')
    })
  })

  it('merges FRONTEND_URL into the allowlist', async () => {
    const app = await loadApp('cors-frontend', {
      ALLOWED_ORIGINS: 'https://a.example',
      FRONTEND_URL: 'https://front.example',
    })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://a.example')).acao, 'https://a.example')
      assert.equal(
        (await get(base, '/api/health', 'https://front.example')).acao,
        'https://front.example'
      )
      assert.equal((await get(base, '/api/health', 'https://c.example')).acao, null)
    })
  })

  it('accepts FRONTEND_URL on its own as the whole allowlist', async () => {
    const app = await loadApp('cors-frontonly', { FRONTEND_URL: 'https://only.example' })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://only.example')).acao, 'https://only.example')
      assert.equal((await get(base, '/api/health', 'https://other.example')).acao, null)
    })
  })

  it('de-duplicates without changing behaviour when the same origin is listed twice', async () => {
    // The Set in parseAllowedOrigins collapses the duplicate; the list length
    // is internal, so what is asserted is that duplication cannot break the
    // allow/deny decision.
    const app = await loadApp('cors-dupe', {
      ALLOWED_ORIGINS: 'https://dupe.example,https://dupe.example,https://other.example',
      FRONTEND_URL: 'https://dupe.example',
    })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://dupe.example')).acao, 'https://dupe.example')
      assert.equal((await get(base, '/api/health', 'https://nope.example')).acao, null)
    })
  })

  it('always allows the Plannr desktop origin, listed or not', async () => {
    const app = await loadApp('cors-desktop', { ALLOWED_ORIGINS: 'https://plannr.app' })
    await withServer(app, async (base) => {
      const res = await get(base, '/api/health', DESKTOP_ORIGIN)
      assert.equal(res.acao, DESKTOP_ORIGIN)
    })
  })

  it('answers a preflight for an allowed origin', async () => {
    const app = await loadApp('cors-preflight', { ALLOWED_ORIGINS: 'https://plannr.app' })
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Connection: 'close',
          Origin: 'https://plannr.app',
          'Access-Control-Request-Method': 'GET',
        },
      })
      assert.equal(res.status, 204)
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://plannr.app')
    })
  })
})

// ── the production guard ──────────────────────────────────────────────────────

describe('production CORS guard', () => {
  it('refuses to boot in production with an empty allowlist', async () => {
    await assert.rejects(
      () => loadApp('prod-empty', { NODE_ENV: 'production' }),
      /Refusing to start.*ALLOWED_ORIGINS \/ FRONTEND_URL are empty/s,
      'an empty allowlist in prod would fall through to allow-any-origin'
    )
  })

  it('refuses to boot in production when ALLOWED_ORIGINS is only separators', async () => {
    await assert.rejects(
      () => loadApp('prod-blank', { NODE_ENV: 'production', ALLOWED_ORIGINS: ' , , ' }),
      /Refusing to start/
    )
  })

  it('boots in production when ALLOWED_ORIGINS is set', async () => {
    const app = await loadApp('prod-ok', {
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://plannr.app',
    })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://plannr.app')).acao, 'https://plannr.app')
      assert.equal((await get(base, '/api/health', 'https://evil.example')).acao, null)
    })
  })

  it('boots in production when only FRONTEND_URL is set', async () => {
    const app = await loadApp('prod-front', {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://plannr.app',
    })
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health', 'https://plannr.app')).acao, 'https://plannr.app')
    })
  })

  it('does not guard outside production', async () => {
    const app = await loadApp('dev-empty', { NODE_ENV: 'development' })
    assert.equal(typeof app, 'function', 'a dev boot with no allowlist is allowed')
  })
})

// ── no stray listener ─────────────────────────────────────────────────────────

describe('import safety', () => {
  it('never binds the default port when VERCEL is set', async () => {
    assert.equal(process.env.VERCEL, '1')
    const app = await loadApp('nolisten')
    // If index.js had called listen() itself, this second bind on the same
    // default port would be the one that fails — and the suite would hang.
    await withServer(app, async (base) => {
      assert.equal((await get(base, '/api/health')).status, 200)
    })
    assert.equal(openServers.size, 0)
  })
})
