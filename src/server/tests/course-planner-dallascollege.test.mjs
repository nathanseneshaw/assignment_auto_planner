/**
 * Tests for the Dallas College scraper.
 *
 * Everything except getSubjects is the shared colleague.js factory (covered by
 * course-planner-colleague.test.mjs); what's school-specific is trimming the
 * subject code that Dallas College repeats inside its own subject description.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as dallascollege from '../course-planner/dallascollege-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

const LANDING_HTML =
  '<html><body><input name="__RequestVerificationToken" value="t" /></body></html>'

function mockRes(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
  }
}

/**
 * Serve `subjects` as the per-term facet on the section search — the path the
 * app actually uses, since the router always passes a term through. Entries are
 * given as `{ Code, Description }` and mapped to the facet's `{ Value,
 * Description, Count }` shape here.
 */
function withSubjects(subjects) {
  const facet = subjects.map((s) => ({ Value: s.Code, Description: s.Description, Count: 1 }))
  globalThis.fetch = async (url) => {
    // AdvancedSearch first: "GetCatalogAdvancedSearchAsync" also contains
    // the substring "SearchAsync".
    if (String(url).includes('AdvancedSearch')) return mockRes({ Terms: [], Subjects: subjects })
    if (String(url).includes('SearchAsync')) return mockRes({ Sections: [], TotalPages: 1, Subjects: facet })
    return mockRes(LANDING_HTML)
  }
}

describe('dallascollege getSubjects', () => {
  it('strips a leading duplicate subject code across their separator styles', async () => {
    withSubjects([
      { Code: 'ACNT', Description: 'ACNT Accounting-WECM' },
      { Code: 'AERM', Description: 'AERM -Aircraft MechaniTech-CE' },
      { Code: 'ARTZ', Description: 'ARTZ - Art - CE' },
      { Code: 'AUMT', Description: 'AUMT-Auto.Mechanic/Tech-WECM' },
    ])
    const byCode = Object.fromEntries(
      (await dallascollege.getSubjects('2026FA')).map((s) => [s.code, s.label])
    )
    assert.equal(byCode.ACNT, 'Accounting-WECM')
    assert.equal(byCode.AERM, 'Aircraft MechaniTech-CE')
    assert.equal(byCode.ARTZ, 'Art - CE')
    assert.equal(byCode.AUMT, 'Auto.Mechanic/Tech-WECM')
  })

  it('matches the code case-insensitively', async () => {
    withSubjects([{ Code: 'BMGT', Description: 'Bmgt - Business Mngmnt-Wecm' }])
    const [s] = await dallascollege.getSubjects('2026FA')
    assert.equal(s.label, 'Business Mngmnt-Wecm')
  })

  it('leaves a description alone when it does not start with the code', async () => {
    withSubjects([
      { Code: 'AIRP', Description: 'Aircraft/Navigator/Prof' },
      // Their data has a typo here: code CAEDCE, description prefixed "CAEDE".
      { Code: 'CAEDCE', Description: 'CAEDE Community Engagement' },
    ])
    const byCode = Object.fromEntries(
      (await dallascollege.getSubjects('2026FA')).map((s) => [s.code, s.label])
    )
    assert.equal(byCode.AIRP, 'Aircraft/Navigator/Prof')
    assert.equal(byCode.CAEDCE, 'CAEDE Community Engagement')
  })

  it('keeps the original when trimming would empty the label', async () => {
    withSubjects([{ Code: 'AUDZ', Description: 'AUDZ' }])
    const [s] = await dallascollege.getSubjects('2026FA')
    assert.equal(s.label, 'AUDZ')
  })

  it('does not let a code that is a prefix of a longer word eat the label', async () => {
    withSubjects([{ Code: 'ART', Description: 'ARTZ - Art - CE' }])
    const [s] = await dallascollege.getSubjects('2026FA')
    assert.equal(s.label, 'ARTZ - Art - CE')
  })
})
