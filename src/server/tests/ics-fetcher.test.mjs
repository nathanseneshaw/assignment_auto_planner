import assert from 'node:assert'
import { describe, it } from 'node:test'
import { _internal } from '../ics-fetcher.js'
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
