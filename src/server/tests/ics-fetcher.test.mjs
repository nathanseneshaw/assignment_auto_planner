import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { fetchIcsFeed, _internal } from '../ics-fetcher.js'
const { isPrivateAddress, assertPublicUrl } = _internal

// ── isPrivateAddress ──────────────────────────────────────────────────────────

describe('isPrivateAddress — blocks private/reserved ranges', () => {
  const SHOULD_BLOCK = [
    ['loopback 127.0.0.1',              '127.0.0.1'],
    ['loopback range 127.255.255.255',  '127.255.255.255'],
    ['RFC1918 10.0.0.1',                '10.0.0.1'],
    ['RFC1918 10.255.255.255',          '10.255.255.255'],
    ['RFC1918 192.168.0.1',             '192.168.0.1'],
    ['RFC1918 192.168.255.255',         '192.168.255.255'],
    ['RFC1918 172.16.0.1',              '172.16.0.1'],
    ['RFC1918 172.31.255.255',          '172.31.255.255'],
    ['link-local 169.254.0.1',          '169.254.0.1'],
    ['AWS metadata 169.254.169.254',    '169.254.169.254'],
    ['all-zeros 0.0.0.0',              '0.0.0.0'],
    ['multicast 224.0.0.1',            '224.0.0.1'],
    ['multicast 239.255.255.255',       '239.255.255.255'],
    ['reserved 255.255.255.255',        '255.255.255.255'],
    ['IPv6 loopback ::1',              '::1'],
    ['IPv6 link-local fe80::1',        'fe80::1'],
    ['IPv6 ULA fc00::1',               'fc00::1'],
    ['IPv6 ULA fd00::1',               'fd00::1'],
  ]

  const SHOULD_ALLOW = [
    ['Google DNS 8.8.8.8',              '8.8.8.8'],
    ['Cloudflare 1.1.1.1',             '1.1.1.1'],
    ['Cloudflare 1.0.0.1',             '1.0.0.1'],
    ['public 104.26.x',                '104.26.10.229'],
    ['just below 172.16 (172.15.x)',   '172.15.255.255'],
    ['just above 172.31 (172.32.x)',   '172.32.0.0'],
    ['11.x (not 10.x)',                '11.0.0.1'],
    ['191.168.x (not 192.168.x)',      '191.168.0.1'],
    ['public 203.x',                   '203.0.113.1'],
  ]

  for (const [label, ip] of SHOULD_BLOCK) {
    it(`blocks ${label}`, () => {
      assert.ok(isPrivateAddress(ip), `Expected ${ip} to be identified as private`)
    })
  }

  for (const [label, ip] of SHOULD_ALLOW) {
    it(`allows ${label}`, () => {
      assert.ok(!isPrivateAddress(ip), `Expected ${ip} to be identified as public`)
    })
  }

  it('blocks empty string', () => {
    assert.ok(isPrivateAddress(''))
  })

  it('blocks null', () => {
    assert.ok(isPrivateAddress(null))
  })
})

// ── assertPublicUrl — pre-DNS validation ─────────────────────────────────────
// These tests cover checks that fire before any DNS lookup, so they work
// without network access.

describe('assertPublicUrl — pre-DNS validation', () => {
  it('throws "Invalid URL" for a completely malformed URL', async () => {
    await assert.rejects(
      () => assertPublicUrl('not-a-url'),
      /Invalid URL/
    )
  })

  it('throws "Invalid URL" for an empty string', async () => {
    await assert.rejects(
      () => assertPublicUrl(''),
      /Invalid URL/
    )
  })

  it('rejects ftp:// protocol', async () => {
    await assert.rejects(
      () => assertPublicUrl('ftp://files.example.com/feed.ics'),
      /Only http/
    )
  })

  it('rejects file:// protocol', async () => {
    await assert.rejects(
      () => assertPublicUrl('file:///etc/passwd'),
      /Only http/
    )
  })

  it('rejects mailto: protocol', async () => {
    await assert.rejects(
      () => assertPublicUrl('mailto:user@example.com'),
      /Only http/
    )
  })

  it('rejects javascript: protocol', async () => {
    await assert.rejects(
      () => assertPublicUrl('javascript:alert(1)'),
      /Only http/
    )
  })

  it('accepts http:// without throwing on protocol check', async () => {
    // Will proceed past protocol check and fail on DNS (unresolvable test host)
    await assert.rejects(
      () => assertPublicUrl('http://this.host.does.not.exist.invalid/feed.ics'),
      (err) => !/Only http/.test(err.message) // protocol check passed; DNS failed
    )
  })

  it('accepts https:// without throwing on protocol check', async () => {
    await assert.rejects(
      () => assertPublicUrl('https://this.host.does.not.exist.invalid/feed.ics'),
      (err) => !/Only http/.test(err.message)
    )
  })

  it('normalizes webcal:// to https:// (no protocol error)', async () => {
    // webcal is allowed; DNS resolution of a non-existent host should be the error
    await assert.rejects(
      () => assertPublicUrl('webcal://this.host.does.not.exist.invalid/feed.ics'),
      (err) => !/Only http/.test(err.message)
    )
  })
})

// ── assertPublicUrl — IP-literal hosts (still no DNS query) ───────────────────
// `dns.lookup` short-circuits on numeric addresses, so these exercise the real
// resolve-then-check path offline.

describe('assertPublicUrl — resolved-address blocking', () => {
  it('blocks a loopback IP literal', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://127.0.0.1/feed.ics'),
      /resolves to a non-public address \(127\.0\.0\.1\)/
    )
  })

  it('blocks the cloud metadata endpoint', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://169.254.169.254/latest/meta-data/'),
      /resolves to a non-public address \(169\.254\.169\.254\)/
    )
  })

  it('blocks an RFC1918 IP literal even on a non-standard port', async () => {
    await assert.rejects(
      () => assertPublicUrl('http://10.0.0.5:8080/internal.ics'),
      /non-public address/
    )
  })

  it('allows a public IP literal and returns a normalized absolute URL', async () => {
    assert.equal(await assertPublicUrl('https://93.184.216.34/feed.ics'), 'https://93.184.216.34/feed.ics')
  })

  /*
   * BUG PIN (latent): assertPublicUrl intends to rewrite webcal:// to https://
   * via `parsed.protocol = 'https:'`, but the WHATWG URL protocol setter refuses
   * to swap a non-special scheme (webcal:) for a special one (https:), so the
   * assignment is a silent no-op and the webcal:// URL is handed to fetch() as-is.
   * Unreachable from the routes today because ics-routes.normalizeUrlInput
   * rewrites webcal:// before the URL is ever stored or fetched — but a direct
   * fetchIcsFeed('webcal://...') would fail on an unsupported protocol.
   */
  it('does NOT actually rewrite webcal:// to https:// (WHATWG URL forbids the swap)', async () => {
    const out = await assertPublicUrl('webcal://93.184.216.34/feed.ics')
    assert.equal(out, 'webcal://93.184.216.34/feed.ics')
    assert.notEqual(out, 'https://93.184.216.34/feed.ics')
  })
})

// ── fetchIcsFeed ─────────────────────────────────────────────────────────────
// Every test drives an IP-literal host so the SSRF guard runs for real without
// emitting a DNS query, and stubs globalThis.fetch so no socket is ever opened.

const PUBLIC_IP = '93.184.216.34'
const OTHER_PUBLIC_IP = '104.26.10.229'
const feedUrl = (path = '/feed.ics', host = PUBLIC_IP) => `https://${host}${path}`
const MAX_BODY_BYTES = 2 * 1024 * 1024   // mirrors the constant in ics-fetcher.js
const ICS_BODY = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

describe('fetchIcsFeed', () => {
  const realFetch = globalThis.fetch
  let calls

  beforeEach(() => { calls = [] })
  afterEach(() => { globalThis.fetch = realFetch })

  /** `handler({ url, init, hop })` returns a Response (or throws). */
  const stub = (handler) => {
    globalThis.fetch = async (url, init) => {
      const hop = calls.length
      calls.push({ url, init })
      return handler({ url, init, hop })
    }
  }

  it('returns the body text on a 200', async () => {
    stub(() => new Response(ICS_BODY, { status: 200 }))
    assert.equal(await fetchIcsFeed(feedUrl()), ICS_BODY)
    assert.equal(calls.length, 1)
  })

  it('sends the documented request shape (manual redirects, UA, Accept, abort signal)', async () => {
    stub(() => new Response(ICS_BODY, { status: 200 }))
    await fetchIcsFeed(feedUrl('/x.ics'))

    const { url, init } = calls[0]
    assert.equal(url, feedUrl('/x.ics'))
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'manual')
    assert.match(init.headers['User-Agent'], /^Plannr\//)
    assert.match(init.headers.Accept, /text\/calendar/)
    assert.ok(init.signal, 'an AbortSignal must be attached for the 10s timeout')
    assert.equal(init.signal.aborted, false)
  })

  it('surfaces a non-2xx status as "Feed returned HTTP <status>"', async () => {
    for (const status of [401, 403, 404, 500]) {
      stub(() => new Response('nope', { status }))
      await assert.rejects(() => fetchIcsFeed(feedUrl()), new RegExp(`Feed returned HTTP ${status}`))
    }
  })

  it('maps an AbortError to the 10s timeout message', async () => {
    stub(() => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) })
    await assert.rejects(() => fetchIcsFeed(feedUrl()), /Feed fetch timed out after 10s/)
  })

  it('wraps any other transport error as "Feed fetch failed: ..."', async () => {
    stub(() => { throw new Error('ECONNREFUSED') })
    await assert.rejects(() => fetchIcsFeed(feedUrl()), /Feed fetch failed: ECONNREFUSED/)
  })

  it('follows a redirect to another public host', async () => {
    stub(({ hop }) =>
      hop === 0
        ? new Response('', { status: 302, headers: { location: feedUrl('/final.ics', OTHER_PUBLIC_IP) } })
        : new Response(ICS_BODY, { status: 200 })
    )
    assert.equal(await fetchIcsFeed(feedUrl()), ICS_BODY)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, feedUrl('/final.ics', OTHER_PUBLIC_IP))
  })

  it('resolves a relative Location against the current URL', async () => {
    stub(({ hop }) =>
      hop === 0
        ? new Response('', { status: 301, headers: { location: '/moved/here.ics' } })
        : new Response(ICS_BODY, { status: 200 })
    )
    await fetchIcsFeed(feedUrl('/old.ics'))
    assert.equal(calls[1].url, feedUrl('/moved/here.ics'))
  })

  /*
   * The reason redirects are walked manually: a public host that 302s to an
   * internal address would defeat a guard that only checked the original URL.
   */
  it('re-validates every redirect hop — a hop to loopback is blocked', async () => {
    stub(() => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret.ics' } }))
    await assert.rejects(
      () => fetchIcsFeed(feedUrl()),
      /non-public address \(127\.0\.0\.1\)/
    )
    assert.equal(calls.length, 1, 'the internal address must never be requested')
  })

  it('re-validates every redirect hop — a hop to cloud metadata is blocked', async () => {
    stub(() => new Response('', { status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
    await assert.rejects(() => fetchIcsFeed(feedUrl()), /non-public address \(169\.254\.169\.254\)/)
    assert.equal(calls.length, 1)
  })

  it('blocks a private hop even after a legitimate public redirect first', async () => {
    stub(({ hop }) =>
      hop === 0
        ? new Response('', { status: 302, headers: { location: feedUrl('/next.ics', OTHER_PUBLIC_IP) } })
        : new Response('', { status: 302, headers: { location: 'http://10.1.2.3/internal.ics' } })
    )
    await assert.rejects(() => fetchIcsFeed(feedUrl()), /non-public address \(10\.1\.2\.3\)/)
    assert.equal(calls.length, 2)
  })

  it('allows exactly 3 redirects', async () => {
    stub(({ hop }) =>
      hop < 3
        ? new Response('', { status: 302, headers: { location: feedUrl(`/hop${hop + 1}.ics`) } })
        : new Response(ICS_BODY, { status: 200 })
    )
    assert.equal(await fetchIcsFeed(feedUrl('/hop0.ics')), ICS_BODY)
    assert.equal(calls.length, 4)   // 3 redirects + the final response
  })

  it('rejects a redirect loop once the 3-hop budget is spent', async () => {
    stub(({ hop }) => new Response('', { status: 302, headers: { location: feedUrl(`/hop${hop + 1}.ics`) } }))
    await assert.rejects(() => fetchIcsFeed(feedUrl('/hop0.ics')), /exceeded 3 redirects/)
    assert.equal(calls.length, 4, 'stops fetching once the budget is spent')
  })

  it('treats a 3xx with no Location header as the final response', async () => {
    stub(() => new Response('', { status: 302 }))
    await assert.rejects(() => fetchIcsFeed(feedUrl()), /Feed returned HTTP 302/)
    assert.equal(calls.length, 1)
  })

  it('caps the streamed body at 2MB', async () => {
    const oneMb = new Uint8Array(1024 * 1024)
    stub(() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oneMb)
        controller.enqueue(oneMb)
        controller.enqueue(oneMb)   // 3MB > the 2MB cap
        controller.close()
      },
    }), { status: 200 }))

    await assert.rejects(() => fetchIcsFeed(feedUrl()), new RegExp(`Feed body too large \\(>${MAX_BODY_BYTES} bytes\\)`))
  })

  it('returns a streamed body that stays under the cap intact', async () => {
    const encoder = new TextEncoder()
    stub(() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('BEGIN:VCALENDAR\r\n'))
        controller.enqueue(encoder.encode('VERSION:2.0\r\nEND:VCALENDAR\r\n'))
        controller.close()
      },
    }), { status: 200 }))

    assert.equal(await fetchIcsFeed(feedUrl()), ICS_BODY)
  })

  it('decodes a multi-chunk UTF-8 body correctly', async () => {
    const body = 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Cours d’été\r\nEND:VCALENDAR\r\n'
    const bytes = new TextEncoder().encode(body)
    stub(() => new Response(new ReadableStream({
      start(controller) {
        // Split mid-multibyte-character to prove the bytes are joined before decoding.
        controller.enqueue(bytes.slice(0, 30))
        controller.enqueue(bytes.slice(30))
        controller.close()
      },
    }), { status: 200 }))

    assert.equal(await fetchIcsFeed(feedUrl()), body)
  })

  it('caps an oversized body on the non-streaming fallback path too', async () => {
    // A response object with no `body` stream exercises the res.text() branch.
    stub(() => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'x'.repeat(MAX_BODY_BYTES + 1),
    }))
    await assert.rejects(() => fetchIcsFeed(feedUrl()), /Feed body too large/)
  })

  it('returns the text on the non-streaming fallback path when it fits', async () => {
    stub(() => ({ ok: true, status: 200, headers: new Headers(), text: async () => ICS_BODY }))
    assert.equal(await fetchIcsFeed(feedUrl()), ICS_BODY)
  })

  it('rejects a non-http(s) URL before opening any socket', async () => {
    stub(() => { throw new Error('should never be called') })
    await assert.rejects(() => fetchIcsFeed('ftp://93.184.216.34/feed.ics'), /Only http/)
    await assert.rejects(() => fetchIcsFeed('file:///etc/passwd'), /Only http/)
    assert.equal(calls.length, 0)
  })

  it('rejects a private target before opening any socket', async () => {
    stub(() => { throw new Error('should never be called') })
    await assert.rejects(() => fetchIcsFeed('http://192.168.1.1/feed.ics'), /non-public address/)
    assert.equal(calls.length, 0)
  })
})
