/**
 * Unit tests for the syllabus rate limiters.
 *
 * These are module-level singletons backed by express-rate-limit's in-memory
 * store, so every test uses its own key namespace (or resets the key first) to
 * stay independent. We drive the middleware directly with a minimal fake
 * req/res instead of standing up an HTTP server: that keeps the suite fast and
 * - critically - lets us hand the keyGenerator arbitrary `req.ip` values, which
 * is impossible over a real loopback socket.
 *
 * express-rate-limit exposes `getKey`/`resetKey` on the returned middleware, so
 * we can inspect the actual bucket a request landed in rather than inferring it.
 */
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { syllabusParseRateLimit, syllabusSaveRateLimit } from '../rate-limit.js'

/** Minimal stand-in for the bits of an Express response the limiter touches. */
function fakeRes() {
  const headers = new Map()
  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    body: undefined,
    setHeader(k, v) { headers.set(String(k).toLowerCase(), String(v)); return res },
    getHeader(k) { return headers.get(String(k).toLowerCase()) },
    status(code) { res.statusCode = code; return res },
    on() { return res },
  }
  return res
}

/**
 * Run a limiter against one fake request. Resolves once the request has either
 * been passed through (`allowed: true`) or short-circuited by the 429 handler.
 */
function invoke(limiter, req) {
  return new Promise((resolve, reject) => {
    const res = fakeRes()
    let settled = false
    res.json = (body) => {
      res.body = body
      res.writableEnded = true
      if (!settled) { settled = true; resolve({ req, res, allowed: false }) }
      return res
    }
    limiter(req, res, (err) => {
      if (err) return reject(err)
      if (!settled) { settled = true; resolve({ req, res, allowed: true }) }
    })
  })
}

const asUser = (id, ip = '198.51.100.1') => ({ user: { id }, ip, headers: {} })
const asAnon = (ip) => ({ ip, headers: {} })

// -- keyGenerator: per-user bucketing ----------------------------------------

describe('syllabus rate limiters - keyGenerator buckets by req.user.id', () => {
  it('gives two different users independent buckets on the same IP', async () => {
    const a = 'kg-user-a'
    const b = 'kg-user-b'
    const sharedIp = '198.51.100.77'
    await syllabusParseRateLimit.resetKey(a)
    await syllabusParseRateLimit.resetKey(b)
    await syllabusParseRateLimit.resetKey(sharedIp)

    const r1 = await invoke(syllabusParseRateLimit, asUser(a, sharedIp))
    const r2 = await invoke(syllabusParseRateLimit, asUser(a, sharedIp))
    const r3 = await invoke(syllabusParseRateLimit, asUser(b, sharedIp))

    assert.equal(r1.allowed, true)
    assert.equal(r2.allowed, true)
    assert.equal(r3.allowed, true)

    // The whole point of the custom keyGenerator: user A's traffic must not
    // count against user B, even though they share a source IP.
    assert.equal((await syllabusParseRateLimit.getKey(a)).totalHits, 2)
    assert.equal((await syllabusParseRateLimit.getKey(b)).totalHits, 1)
    // ...and the shared IP must never have been used as a key.
    assert.equal(await syllabusParseRateLimit.getKey(sharedIp), undefined)

    assert.equal(r2.req.rateLimit.used, 2)
    assert.equal(r3.req.rateLimit.used, 1)
    assert.equal(r3.req.rateLimit.remaining, 9)
  })

  it('falls back to req.ip when req.user is absent, and keeps IPs separate', async () => {
    const ip1 = '203.0.113.9'
    const ip2 = '203.0.113.10'
    await syllabusParseRateLimit.resetKey(ip1)
    await syllabusParseRateLimit.resetKey(ip2)

    await invoke(syllabusParseRateLimit, asAnon(ip1))
    await invoke(syllabusParseRateLimit, asAnon(ip1))
    await invoke(syllabusParseRateLimit, asAnon(ip2))

    assert.equal((await syllabusParseRateLimit.getKey(ip1)).totalHits, 2)
    assert.equal((await syllabusParseRateLimit.getKey(ip2)).totalHits, 1)
  })

  it('treats an anonymous IP and a signed-in user on that IP as different buckets', async () => {
    const ip = '203.0.113.55'
    const uid = 'kg-user-on-ip'
    await syllabusParseRateLimit.resetKey(ip)
    await syllabusParseRateLimit.resetKey(uid)

    await invoke(syllabusParseRateLimit, asAnon(ip))
    await invoke(syllabusParseRateLimit, asUser(uid, ip))

    assert.equal((await syllabusParseRateLimit.getKey(ip)).totalHits, 1)
    assert.equal((await syllabusParseRateLimit.getKey(uid)).totalHits, 1)
  })

  it('applies the same per-user bucketing to the save limiter', async () => {
    const a = 'kg-save-a'
    const b = 'kg-save-b'
    await syllabusSaveRateLimit.resetKey(a)
    await syllabusSaveRateLimit.resetKey(b)

    await invoke(syllabusSaveRateLimit, asUser(a))
    await invoke(syllabusSaveRateLimit, asUser(a))
    await invoke(syllabusSaveRateLimit, asUser(a))
    await invoke(syllabusSaveRateLimit, asUser(b))

    assert.equal((await syllabusSaveRateLimit.getKey(a)).totalHits, 3)
    assert.equal((await syllabusSaveRateLimit.getKey(b)).totalHits, 1)
  })

  it('keeps the parse and save limiters in separate stores for the same user id', async () => {
    const uid = 'kg-shared-id'
    await syllabusParseRateLimit.resetKey(uid)
    await syllabusSaveRateLimit.resetKey(uid)

    await invoke(syllabusParseRateLimit, asUser(uid))
    await invoke(syllabusParseRateLimit, asUser(uid))
    await invoke(syllabusSaveRateLimit, asUser(uid))

    assert.equal((await syllabusParseRateLimit.getKey(uid)).totalHits, 2)
    assert.equal((await syllabusSaveRateLimit.getKey(uid)).totalHits, 1)
  })
})

// -- limits + window ---------------------------------------------------------

describe('syllabus rate limiters - configured limits and window', () => {
  it('reports 10 per hour for parse via req.rateLimit and the draft-7 policy header', async () => {
    const uid = 'cfg-parse'
    await syllabusParseRateLimit.resetKey(uid)
    const { req, res } = await invoke(syllabusParseRateLimit, asUser(uid))

    assert.equal(req.rateLimit.limit, 10)
    assert.equal(req.rateLimit.used, 1)
    assert.equal(req.rateLimit.remaining, 9)
    // `w=3600` pins windowMs at exactly one hour.
    assert.equal(res.getHeader('RateLimit-Policy'), '10;w=3600')
    assert.match(res.getHeader('RateLimit'), /^limit=10, remaining=9, reset=\d+$/)
    // legacyHeaders: false
    assert.equal(res.getHeader('X-RateLimit-Limit'), undefined)
    assert.equal(res.getHeader('X-RateLimit-Remaining'), undefined)
  })

  it('reports 60 per hour for save via req.rateLimit and the draft-7 policy header', async () => {
    const uid = 'cfg-save'
    await syllabusSaveRateLimit.resetKey(uid)
    const { req, res } = await invoke(syllabusSaveRateLimit, asUser(uid))

    assert.equal(req.rateLimit.limit, 60)
    assert.equal(res.getHeader('RateLimit-Policy'), '60;w=3600')
    assert.equal(res.getHeader('X-RateLimit-Limit'), undefined)
  })
})

// -- the 429 handler ---------------------------------------------------------

describe('syllabus rate limiters - 429 handler', () => {
  it('allows exactly 10 parse requests then returns the RATE_LIMITED body', async () => {
    const uid = 'limit-parse-user'
    await syllabusParseRateLimit.resetKey(uid)

    for (let i = 1; i <= 10; i++) {
      const { allowed } = await invoke(syllabusParseRateLimit, asUser(uid))
      assert.equal(allowed, true, `request ${i} should have been allowed`)
    }

    const eleventh = await invoke(syllabusParseRateLimit, asUser(uid))
    assert.equal(eleventh.allowed, false)
    assert.equal(eleventh.res.statusCode, 429)
    assert.deepEqual(eleventh.res.body, {
      success: false,
      error: 'Syllabus parse limit reached (10 per hour). Please wait before trying again.',
      code: 'RATE_LIMITED',
    })
    // Clients need Retry-After to back off sensibly.
    assert.match(String(eleventh.res.getHeader('Retry-After')), /^\d+$/)
    assert.equal(eleventh.req.rateLimit.remaining, 0)
  })

  it('allows exactly 60 save requests then returns the RATE_LIMITED body', async () => {
    const uid = 'limit-save-user'
    await syllabusSaveRateLimit.resetKey(uid)

    for (let i = 1; i <= 60; i++) {
      const { allowed } = await invoke(syllabusSaveRateLimit, asUser(uid))
      assert.equal(allowed, true, `request ${i} should have been allowed`)
    }

    const overflow = await invoke(syllabusSaveRateLimit, asUser(uid))
    assert.equal(overflow.allowed, false)
    assert.equal(overflow.res.statusCode, 429)
    assert.deepEqual(overflow.res.body, {
      success: false,
      error: 'Syllabus save limit reached (60 per hour). Please wait before trying again.',
      code: 'RATE_LIMITED',
    })
  })

  it('does not leak an exhausted bucket onto another user', async () => {
    const hot = 'overflow-user'
    const cold = 'fresh-user'
    await syllabusParseRateLimit.resetKey(hot)
    await syllabusParseRateLimit.resetKey(cold)

    for (let i = 0; i < 11; i++) await invoke(syllabusParseRateLimit, asUser(hot))
    const blocked = await invoke(syllabusParseRateLimit, asUser(hot))
    assert.equal(blocked.allowed, false)

    const other = await invoke(syllabusParseRateLimit, asUser(cold))
    assert.equal(other.allowed, true)
    assert.equal(other.req.rateLimit.used, 1)
  })

  it('returns a JSON body, not express-rate-limit default text message', async () => {
    const uid = 'json-body-user'
    await syllabusParseRateLimit.resetKey(uid)
    for (let i = 0; i < 10; i++) await invoke(syllabusParseRateLimit, asUser(uid))
    const { res } = await invoke(syllabusParseRateLimit, asUser(uid))
    assert.equal(typeof res.body, 'object')
    assert.equal(res.body.success, false)
    assert.equal(res.body.code, 'RATE_LIMITED')
  })
})
