/**
 * Unit tests for the shared Supabase JWT auth middleware.
 *
 * Two things make this module awkward to test, and both are handled explicitly
 * below rather than worked around:
 *
 *  1. SUPABASE_URL / SUPABASE_ANON_KEY are read into module-level consts at
 *     IMPORT time. Mutating process.env after importing would do nothing, so
 *     every env scenario sets process.env first and then does a dynamic
 *     `import()` with a unique query string to defeat the ESM module cache.
 *     `loadAuth()` below encapsulates that (and always restores the real env).
 *
 *  2. `authCache` is module-level mutable state. Because each `loadAuth()` call
 *     yields a *fresh* module instance, every cache test starts from an empty
 *     cache with no bleed between tests or between runs of the file.
 *
 * No real network calls: supabase-js resolves `fetch` lazily off globalThis at
 * call time, so stubbing `globalThis.fetch` intercepts both GoTrue
 * (`/auth/v1/user`) and PostgREST (`/rest/v1/...`).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'

const URL_OK = 'https://fake-project.supabase.co'
const ANON_OK = 'anon-test-key'
const DEFAULT_ENV = { SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: ANON_OK }

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

function applyEnv(values) {
  for (const k of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, k)) process.env[k] = values[k]
    else delete process.env[k]
  }
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED_ENV[k]
  }
}

let loadSeq = 0
/** Import a FRESH copy of supabase-auth.js under the given env. */
async function loadAuth(values = DEFAULT_ENV) {
  applyEnv(values)
  try {
    return await import(`../supabase-auth.js?instance=${++loadSeq}`)
  } finally {
    restoreEnv()
  }
}

// -- fetch stubbing ----------------------------------------------------------

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch })
afterEach(() => { globalThis.fetch = savedFetch })

const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * Install a fetch stub. `user` is what GoTrue's /auth/v1/user returns (or a
 * status number to fail with). Returns a record of every intercepted call.
 */
function stubSupabaseFetch({ user = { id: 'user-1', email: 'a@example.edu' }, authStatus = 200 } = {}) {
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    const headers = new Headers(init.headers || {})
    calls.push({ url, method: init.method || 'GET', authorization: headers.get('authorization'), body: init.body })
    if (url.includes('/auth/v1/user')) {
      if (authStatus !== 200) {
        return json({ code: authStatus, error_code: 'bad_jwt', msg: 'invalid claim' }, authStatus)
      }
      return json(user)
    }
    return json([])
  }
  calls.auth = () => calls.filter((c) => c.url.includes('/auth/v1/user'))
  calls.rest = () => calls.filter((c) => c.url.includes('/rest/v1/'))
  return calls
}

// -- request/response doubles ------------------------------------------------

function makeReq(authorization) {
  return { headers: authorization === undefined ? {} : { authorization } }
}

function makeRes() {
  const res = { statusCode: null, body: undefined }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}

/** Run requireUser and report whether it called next(). */
async function run(requireUser, req) {
  const res = makeRes()
  let nextCalls = 0
  await requireUser(req, res, () => { nextCalls++ })
  return { req, res, nextCalls, passed: nextCalls > 0 }
}

// -- JWT helpers -------------------------------------------------------------

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

/** Build an unsigned-but-well-formed JWT. `exp` is in seconds, as in a real one. */
function makeJwt(payload = {}) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.not-a-real-signature`
}

const jwtExpiringInSeconds = (secs, extra = {}) =>
  makeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + secs, ...extra })

// ---------------------------------------------------------------------------
// getSupabaseEnv
// ---------------------------------------------------------------------------

describe('getSupabaseEnv', () => {
  it('throws a configuration message when neither URL nor anon key is set', async () => {
    const { getSupabaseEnv } = await loadAuth({})
    assert.throws(() => getSupabaseEnv(), (err) => {
      assert.match(err.message, /Supabase env not configured/)
      assert.match(err.message, /SUPABASE_URL/)
      assert.match(err.message, /SUPABASE_ANON_KEY/)
      return true
    })
  })

  it('throws when only SUPABASE_URL is set', async () => {
    const { getSupabaseEnv } = await loadAuth({ SUPABASE_URL: URL_OK })
    assert.throws(() => getSupabaseEnv(), /Supabase env not configured/)
  })

  it('throws when only SUPABASE_ANON_KEY is set', async () => {
    const { getSupabaseEnv } = await loadAuth({ SUPABASE_ANON_KEY: ANON_OK })
    assert.throws(() => getSupabaseEnv(), /Supabase env not configured/)
  })

  it('reads the VITE_-prefixed fallbacks', async () => {
    const { getSupabaseEnv } = await loadAuth({
      VITE_SUPABASE_URL: 'https://vite-fallback.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'vite-anon',
    })
    assert.deepEqual(getSupabaseEnv(), { url: 'https://vite-fallback.supabase.co', anon: 'vite-anon' })
  })

  it('prefers the unprefixed vars over the VITE_ fallbacks', async () => {
    const { getSupabaseEnv } = await loadAuth({
      SUPABASE_URL: URL_OK,
      SUPABASE_ANON_KEY: ANON_OK,
      VITE_SUPABASE_URL: 'https://should-not-win.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'should-not-win',
    })
    assert.deepEqual(getSupabaseEnv(), { url: URL_OK, anon: ANON_OK })
  })

  it('mixes sources: unprefixed URL + VITE_ anon key', async () => {
    const { getSupabaseEnv } = await loadAuth({ SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: 'vite-anon' })
    assert.deepEqual(getSupabaseEnv(), { url: URL_OK, anon: 'vite-anon' })
  })
})

// ---------------------------------------------------------------------------
// clientFor
// ---------------------------------------------------------------------------

describe('clientFor', () => {
  it('returns null for every non-bearer Authorization header', async () => {
    const { clientFor } = await loadAuth()
    const rejected = [
      undefined,                 // header entirely absent
      '',                        // present but empty
      'Basic dXNlcjpwYXNz',      // wrong scheme
      'Token abc.def.ghi',       // wrong scheme
      'Bearerabc.def.ghi',       // missing the space
      'bearer',                  // scheme with no space/token
      'xBearer abc',             // does not start with bearer
    ]
    for (const header of rejected) {
      assert.equal(clientFor(makeReq(header)), null, `expected null for header ${JSON.stringify(header)}`)
    }
  })

  it('is case-insensitive on the bearer prefix', async () => {
    const { clientFor } = await loadAuth()
    for (const header of ['Bearer tok', 'bearer tok', 'BEARER tok', 'BeArEr tok']) {
      assert.ok(clientFor(makeReq(header)), `expected a client for header ${header}`)
    }
  })

  it('forwards the raw Authorization header verbatim so RLS applies to queries', async () => {
    const { clientFor } = await loadAuth()
    const calls = stubSupabaseFetch()
    const rawHeader = 'BeArEr eyJhbGciOi.PAYLOAD.sig'

    const supabase = clientFor(makeReq(rawHeader))
    await supabase.from('courses').select('id')

    const rest = calls.rest()
    assert.equal(rest.length, 1)
    // Verbatim: same casing, same token. Anything else and PostgREST would
    // evaluate RLS against the wrong (or no) JWT.
    assert.equal(rest[0].authorization, rawHeader)
  })

  it('throws the env error when the server is unconfigured but the header IS bearer', async () => {
    const { clientFor } = await loadAuth({})
    assert.throws(() => clientFor(makeReq('Bearer tok')), /Supabase env not configured/)
  })

  it('short-circuits to null before touching env for a non-bearer header', async () => {
    // Ordering matters: an unconfigured server must still answer 401 (not 500)
    // to an unauthenticated caller.
    const { clientFor } = await loadAuth({})
    assert.equal(clientFor(makeReq('Basic abc')), null)
    assert.equal(clientFor(makeReq(undefined)), null)
  })
})

// ---------------------------------------------------------------------------
// requireUser
// ---------------------------------------------------------------------------

describe('requireUser', () => {
  it('401s with the exact body when the Authorization header is missing', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch()
    const { res, passed } = await run(requireUser, makeReq(undefined))

    assert.equal(passed, false)
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.body, { success: false, error: 'Missing Authorization bearer token' })
    // No token means no reason to call GoTrue at all.
    assert.equal(calls.auth().length, 0)
  })

  it('401s for a non-bearer scheme without a network round-trip', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch()
    const { res, passed } = await run(requireUser, makeReq('Basic dXNlcjpwYXNz'))
    assert.equal(passed, false)
    assert.equal(res.statusCode, 401)
    assert.equal(calls.auth().length, 0)
  })

  it('401s when auth.getUser() returns an error', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ authStatus: 401 })
    const { res, req, passed } = await run(requireUser, makeReq(`Bearer ${makeJwt({ sub: 'u' })}`))

    assert.equal(passed, false)
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.body, { success: false, error: 'Invalid or expired token' })
    assert.equal(req.user, undefined)
    assert.equal(req.supabase, undefined)
    assert.equal(calls.auth().length, 1)
  })

  it('never calls next() when GoTrue answers 200 with an unusable body', async () => {
    // Defensive: a 200 whose body is `null` makes auth-js throw rather than
    // return { error }, so this lands in requireUser's catch-all. The exact
    // status is 500 (not 401) - what matters is that the request is refused and
    // no req.user is attached.
    const { requireUser } = await loadAuth()
    stubSupabaseFetch({ user: null })
    const { req, res, nextCalls } = await run(requireUser, makeReq(`Bearer ${makeJwt({ sub: 'u' })}`))
    assert.equal(nextCalls, 0)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.success, false)
    assert.equal(req.user, undefined)
    assert.equal(req.supabase, undefined)
  })

  it('500s (not 401) when building the client throws unexpectedly', async () => {
    // A misconfigured SUPABASE_URL makes createClient throw synchronously.
    const { requireUser } = await loadAuth({ SUPABASE_URL: 'not-a-url', SUPABASE_ANON_KEY: ANON_OK })
    stubSupabaseFetch()
    const { res, passed } = await run(requireUser, makeReq('Bearer tok'))

    assert.equal(passed, false)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.success, false)
    assert.match(res.body.error, /supabaseUrl/i)
  })

  it('500s when the server has no Supabase env but the caller sent a bearer token', async () => {
    const { requireUser } = await loadAuth({})
    stubSupabaseFetch()
    const { res } = await run(requireUser, makeReq('Bearer tok'))
    assert.equal(res.statusCode, 500)
    assert.match(res.body.error, /Supabase env not configured/)
  })

  it('attaches req.user and an RLS-scoped req.supabase on success', async () => {
    const { requireUser } = await loadAuth()
    const user = { id: 'user-42', email: 'student@example.edu', aud: 'authenticated' }
    const calls = stubSupabaseFetch({ user })
    const header = `Bearer ${makeJwt({ sub: 'user-42' })}`
    const { req, res, nextCalls, passed } = await run(requireUser, makeReq(header))

    assert.equal(passed, true)
    assert.equal(nextCalls, 1, 'next() must be called exactly once')
    assert.equal(res.statusCode, null, 'no response should have been written')
    assert.equal(req.user.id, 'user-42')
    assert.equal(req.user.email, 'student@example.edu')
    assert.ok(req.supabase, 'req.supabase must be attached')

    // The attached client must carry the caller's JWT so PostgREST enforces RLS.
    await req.supabase.from('assignments').select('id')
    assert.equal(calls.rest().at(-1).authorization, header)
  })

  it('accepts a lowercase bearer prefix end-to-end', async () => {
    const { requireUser } = await loadAuth()
    stubSupabaseFetch({ user: { id: 'lower-case-user' } })
    const { req, passed } = await run(requireUser, makeReq(`bearer ${makeJwt({ sub: 'x' })}`))
    assert.equal(passed, true)
    assert.equal(req.user.id, 'lower-case-user')
  })
})

// ---------------------------------------------------------------------------
// auth cache
// ---------------------------------------------------------------------------

describe('requireUser - auth cache', () => {
  it('serves the second request for the same token from cache (one GoTrue call)', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'cached-user' } })
    const header = `Bearer ${jwtExpiringInSeconds(3600)}`

    const first = await run(requireUser, makeReq(header))
    const second = await run(requireUser, makeReq(header))

    assert.equal(first.passed, true)
    assert.equal(second.passed, true)
    assert.equal(second.req.user.id, 'cached-user')
    assert.ok(second.req.supabase, 'a cache hit must still attach a fresh scoped client')
    assert.equal(calls.auth().length, 1, 'cache hit must skip the second network round-trip')
  })

  it('keys the cache on the token, not the user (a second token round-trips)', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'same-user' } })

    await run(requireUser, makeReq(`Bearer ${jwtExpiringInSeconds(3600, { jti: 'a' })}`))
    await run(requireUser, makeReq(`Bearer ${jwtExpiringInSeconds(3600, { jti: 'b' })}`))

    assert.equal(calls.auth().length, 2)
  })

  it('never caches a token past its own exp, even inside the 60s TTL', async () => {
    // This is the security property: a token that expires in 5s must not be
    // honoured from cache for the full 60s TTL.
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'short-lived' } })
    const header = `Bearer ${jwtExpiringInSeconds(5)}`

    await run(requireUser, makeReq(header))
    assert.equal(calls.auth().length, 1)

    // Travel 10s forward: past the token's exp, but well within the 60s TTL.
    const realNow = Date.now
    Date.now = () => realNow() + 10_000
    try {
      await run(requireUser, makeReq(header))
    } finally {
      Date.now = realNow
    }

    assert.equal(calls.auth().length, 2, 'expired-by-exp entry must be re-validated, not reused')
  })

  it('control: a long-lived token IS still cached after the same 10s of travel', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'long-lived' } })
    const header = `Bearer ${jwtExpiringInSeconds(3600)}`

    await run(requireUser, makeReq(header))
    const realNow = Date.now
    Date.now = () => realNow() + 10_000
    try {
      await run(requireUser, makeReq(header))
    } finally {
      Date.now = realNow
    }

    assert.equal(calls.auth().length, 1, '10s < 60s TTL and < exp, so the cache must still hit')
  })

  it('evicts an entry once the 60s TTL elapses for a token with no exp bound', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'ttl-user' } })
    const header = 'Bearer opaque-token-without-an-exp'

    await run(requireUser, makeReq(header))
    assert.equal(calls.auth().length, 1)

    const realNow = Date.now
    Date.now = () => realNow() + 61_000
    try {
      await run(requireUser, makeReq(header))
    } finally {
      Date.now = realNow
    }
    assert.equal(calls.auth().length, 2, 'entry older than the TTL must be evicted')
  })

  it('does not cache a token whose exp is already in the past', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'already-expired' } })
    const header = `Bearer ${jwtExpiringInSeconds(-120)}`

    await run(requireUser, makeReq(header))
    await run(requireUser, makeReq(header))

    assert.equal(calls.auth().length, 2, 'a past-exp entry is written but is immediately stale')
  })

  it('decodes exp from a base64url payload containing - and _ characters', async () => {
    // base64url-only characters ("-" / "_") appear when the payload bytes need
    // them; a plain base64 decode would corrupt these. Padding is also omitted.
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'b64url-user' } })
    const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 5, note: 'safe??~~>>>' }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    assert.match(encoded, /[-_]/, 'fixture must actually exercise base64url characters')
    const header = `Bearer ${b64url({ alg: 'HS256' })}.${encoded}.sig`

    await run(requireUser, makeReq(header))
    const realNow = Date.now
    Date.now = () => realNow() + 10_000
    try {
      await run(requireUser, makeReq(header))
    } finally {
      Date.now = realNow
    }
    // exp was decoded correctly, so the 10s jump invalidated it.
    assert.equal(calls.auth().length, 2)
  })

  it('never throws on a malformed token and falls back to the plain 60s TTL', async () => {
    const { requireUser } = await loadAuth()
    const malformed = [
      'no-dots-at-all',
      'only.two',                                  // payload is not valid JSON
      `${b64url({ a: 1 })}.@@@not-base64@@@.sig`,  // undecodable payload
      `${b64url({ a: 1 })}..sig`,                  // empty payload
      `${b64url({ a: 1 })}.${b64url([1, 2, 3])}.sig`, // JSON, but an array (no .exp)
      `${b64url({ a: 1 })}.${b64url({ exp: 'soon' })}.sig`, // exp is not a number
      `${b64url({ a: 1 })}.${b64url({ exp: null })}.sig`,
    ]

    for (const token of malformed) {
      const calls = stubSupabaseFetch({ user: { id: `u-${token.length}` } })
      const header = `Bearer ${token}`
      const first = await run(requireUser, makeReq(header))
      assert.equal(first.passed, true, `requireUser must not throw for token ${token}`)
      assert.equal(first.res.statusCode, null)

      // Undecodable/absent exp means the full TTL applies, so this hits cache.
      const second = await run(requireUser, makeReq(header))
      assert.equal(second.passed, true)
      assert.equal(calls.auth().length, 1, `token ${token} should have been cached for the full TTL`)
    }
  })

  it('caps the cache at 1000 entries, evicting the oldest first', async () => {
    const { requireUser } = await loadAuth()
    const calls = stubSupabaseFetch({ user: { id: 'bulk' } })
    const tok = (i) => `Bearer bulk-token-${i}`

    // Fill the cache to exactly AUTH_CACHE_MAX.
    for (let i = 0; i < 1000; i++) await run(requireUser, makeReq(tok(i)))
    assert.equal(calls.auth().length, 1000)

    // Still all cached: no new GoTrue calls.
    await run(requireUser, makeReq(tok(0)))
    await run(requireUser, makeReq(tok(999)))
    assert.equal(calls.auth().length, 1000)

    // One more entry pushes the map over the cap and evicts the oldest key.
    await run(requireUser, makeReq(tok(1000)))
    assert.equal(calls.auth().length, 1001)

    // token 0 was the oldest, so it is gone and must re-validate...
    await run(requireUser, makeReq(tok(0)))
    assert.equal(calls.auth().length, 1002)

    // ...while a newer entry is untouched.
    await run(requireUser, makeReq(tok(999)))
    assert.equal(calls.auth().length, 1002)
  })

  it('keeps caches isolated per module instance (no bleed across loads)', async () => {
    const header = `Bearer ${jwtExpiringInSeconds(3600, { jti: 'isolation' })}`

    const a = await loadAuth()
    const callsA = stubSupabaseFetch({ user: { id: 'a' } })
    await run(a.requireUser, makeReq(header))
    await run(a.requireUser, makeReq(header))
    assert.equal(callsA.auth().length, 1)

    const b = await loadAuth()
    const callsB = stubSupabaseFetch({ user: { id: 'b' } })
    await run(b.requireUser, makeReq(header))
    assert.equal(callsB.auth().length, 1, 'a fresh module instance starts with an empty cache')
  })
})
