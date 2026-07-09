/**
 * Smoke tests for the utk + wvu Banner 9 SSB factory wrappers: both are pure
 * factory instances, so these just pin the host wiring and one term parse
 * each. The factory itself is covered by course-planner-banner-ssb.test.mjs.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as utk from '../course-planner/utk-scraper.js'
import * as wvu from '../course-planner/wvu-scraper.js'

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

describe('utk.getTerms', () => {
  it('hits bannerreg.utk.edu and maps Banner term JSON', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => {
      seenUrls.push(String(url))
      const body = String(url).includes('getTerms')
        ? [{ code: '202640', description: 'Fall Sem 2026' }, { code: '202630', description: 'Summer Sem 2026' }]
        : []
      return bannerResponse(url, body)
    }
    const terms = await utk.getTerms()
    assert.deepEqual(terms, [
      { code: '202640', label: 'Fall Sem 2026' },
      { code: '202630', label: 'Summer Sem 2026' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://bannerreg.utk.edu/StudentRegistrationSsb/')))
  })
})

describe('wvu.getTerms', () => {
  it('hits starss.wvu.edu and maps Banner term JSON', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => {
      seenUrls.push(String(url))
      const body = String(url).includes('getTerms')
        ? [{ code: '202608', description: 'Fall 2026' }, { code: '202605', description: 'Summer 2026' }]
        : []
      return bannerResponse(url, body)
    }
    const terms = await wvu.getTerms()
    assert.deepEqual(terms, [
      { code: '202608', label: 'Fall 2026' },
      { code: '202605', label: 'Summer 2026' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://starss.wvu.edu/StudentRegistrationSsb/')))
  })
})
