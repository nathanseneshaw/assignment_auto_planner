import { lookup as dnsLookup } from 'node:dns/promises'

const FETCH_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

/**
 * Block requests aimed at our own network: localhost, link-local, RFC1918, etc.
 * Resolves DNS first so an attacker can't sneak an internal IP behind a public hostname.
 */
async function assertPublicUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'webcal:') {
    throw new Error('Only http(s) / webcal URLs are allowed')
  }
  // webcal:// is iCalendar over http; normalize for fetching
  if (parsed.protocol === 'webcal:') parsed.protocol = 'https:'

  const host = parsed.hostname
  if (!host) throw new Error('URL has no host')

  let addresses
  try {
    addresses = await dnsLookup(host, { all: true })
  } catch {
    throw new Error(`Could not resolve host: ${host}`)
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`URL resolves to a non-public address (${address}) and is blocked`)
    }
  }

  return parsed.toString()
}

function isPrivateAddress(addr) {
  if (!addr) return true
  const a = String(addr)
  if (a === '::1') return true
  if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true
  if (a === '0.0.0.0') return true

  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [o1, o2] = [Number(m[1]), Number(m[2])]
  if (o1 === 10) return true
  if (o1 === 127) return true
  if (o1 === 0) return true
  if (o1 === 169 && o2 === 254) return true
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true
  if (o1 === 192 && o2 === 168) return true
  if (o1 >= 224) return true // multicast / reserved
  return false
}

/**
 * Fetch a public ICS feed URL. Returns the body text.
 * - 10s connect/read timeout
 * - 2MB body cap
 * - SSRF guard
 */
export async function fetchIcsFeed(url) {
  let currentUrl = await assertPublicUrl(url)

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  let res
  try {
    // Walk redirects manually so we can re-validate each hop against the SSRF
    // guard  otherwise a public host could 302 us to 127.0.0.1 or cloud
    // metadata (169.254.169.254) which assertPublicUrl on the original URL
    // would never catch.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: {
          Accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1',
          'User-Agent': 'Plannr/1.0 (+ICS sync)',
        },
      })

      if (res.status < 300 || res.status >= 400) break

      const location = res.headers.get('location')
      if (!location) break
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Feed exceeded ${MAX_REDIRECTS} redirects`)
      }
      const nextUrl = new URL(location, currentUrl).toString()
      currentUrl = await assertPublicUrl(nextUrl)
    }
  } catch (e) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') throw new Error('Feed fetch timed out after 10s')
    throw new Error(`Feed fetch failed: ${e?.message || e}`)
  }
  clearTimeout(timer)

  if (!res.ok) {
    throw new Error(`Feed returned HTTP ${res.status}`)
  }

  // Read with a hard byte cap to avoid OOM on a malicious endpoint.
  const reader = res.body?.getReader?.()
  if (!reader) {
    const text = await res.text()
    if (text.length > MAX_BODY_BYTES) {
      throw new Error(`Feed body too large (>${MAX_BODY_BYTES} bytes)`)
    }
    return text
  }

  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      try { await reader.cancel() } catch { /* ignore */ }
      throw new Error(`Feed body too large (>${MAX_BODY_BYTES} bytes)`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
}

/** Exported for tests. */
export const _internal = { assertPublicUrl, isPrivateAddress }
