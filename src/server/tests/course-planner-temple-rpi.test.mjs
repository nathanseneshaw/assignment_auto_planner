/**
 * Smoke tests for the temple (Banner 9 SSB factory) and rpi (Banner classic
 * factory) wrappers: both are pure factory instances, so these just pin the
 * host wiring and one representative parse each. The factories themselves are
 * covered by course-planner-banner-ssb.test.mjs / -banner-classic.test.mjs.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as temple from '../course-planner/temple-scraper.js'
import * as rpi from '../course-planner/rpi-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function bannerResponse(url, body) {
  return {
    ok: true, status: 200, url,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  }
}

describe('temple.getTerms', () => {
  it('hits prd-xereg.temple.edu and maps Banner term JSON', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => {
      seenUrls.push(String(url))
      const body = String(url).includes('getTerms')
        ? [{ code: '202636', description: '2026 Fall' }, { code: '202626', description: '2026 Summer II' }]
        : []
      return bannerResponse(url, body)
    }
    const terms = await temple.getTerms()
    assert.deepEqual(terms, [
      { code: '202636', label: '2026 Fall' },
      { code: '202626', label: '2026 Summer II' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://prd-xereg.temple.edu/StudentRegistrationSsb/')))
  })
})

describe('rpi.getTerms', () => {
  it('hits sis.rpi.edu/rss and maps the p_term select', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => {
      seenUrls.push(String(url))
      return bannerResponse(url, `<select name="p_term">
        <option value="">None</option>
        <option value="202609">Fall 2026</option>
        <option value="202605">Summer 2026</option>
        <option value="202601">Spring 2026 (View only)</option>
      </select>`)
    }
    const terms = await rpi.getTerms()
    assert.deepEqual(terms, [
      { code: '202609', label: 'Fall 2026' },
      { code: '202605', label: 'Summer 2026' },
      { code: '202601', label: 'Spring 2026 (View only)' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://sis.rpi.edu/rss/bwckschd.p_disp_dyn_sched')))
  })
})
