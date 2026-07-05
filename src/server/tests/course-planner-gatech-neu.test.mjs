/**
 * Tests for the gatech / neu wrappers around the banner-ssb factory:
 * both filter noise out of their Banner term lists so the term-window
 * dedup can't be shadowed by a mini-term with the same Season+Year.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as gatech from '../course-planner/gatech-scraper.js'
import * as neu from '../course-planner/neu-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockTerms(terms) {
  return async (url) => ({
    ok: true, status: 200, url,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => JSON.stringify(terms),
    json: async () => (String(url).includes('getTerms') ? terms : []),
  })
}

describe('gatech.getTerms', () => {
  it('drops Language Institute mini-terms', async () => {
    globalThis.fetch = mockTerms([
      { code: '202623', description: 'Language Institute 2026 (View Only)' },
      { code: '202622', description: 'Language Inst IEP: Spring 2 26 (View Only)' },
      { code: '202608', description: 'Fall 2026' },
      { code: '202605', description: 'Summer 2026' },
    ])
    const terms = await gatech.getTerms()
    assert.deepEqual(terms.map((t) => t.code), ['202608', '202605'])
  })
})

describe('neu.getTerms', () => {
  it('keeps only the plain semesters (no CPS / Law terms)', async () => {
    globalThis.fetch = mockTerms([
      { code: '202710', description: 'Fall 2026 Semester' },
      { code: '202655', description: 'Summer 2026 CPS Quarter' },
      { code: '202654', description: 'Summer 2026 Law Semester' },
      { code: '202650', description: 'Summer 2026 Semester' },
    ])
    const terms = await neu.getTerms()
    assert.deepEqual(terms.map((t) => t.code), ['202710', '202650'])
  })
})
