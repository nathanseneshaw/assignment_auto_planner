/**
 * Smoke tests for the auburn + alabama Banner classic factory wrappers. The
 * factory is covered by course-planner-banner-classic.test.mjs; these pin the
 * host wiring and the one behavioral difference: Auburn runs the per-CRN
 * seats walk, Alabama has it disabled (its public detail pages omit the
 * Registration Availability table entirely).
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import * as auburn from '../course-planner/auburn-scraper.js'
import * as alabama from '../course-planner/alabama-scraper.js'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function response(url, body) {
  return {
    ok: true, status: 200, url,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

const LISTING = `<table class="datadisplaytable">
<tr><th class="ddtitle"><a>Principles of Financial Accounting - 14782 - ACCT 2110 - 001</a></th></tr>
<tr><td class="dddefault">
  3.000 Credits
  <table class="datadisplaytable">
    <tr><th class="ddheader">Type</th><th class="ddheader">Time</th></tr>
    <tr>
      <td class="dddefault">Class</td>
      <td class="dddefault">9:00 am - 9:50 am</td>
      <td class="dddefault">MWF</td>
      <td class="dddefault">Lowder Hall 113</td>
      <td class="dddefault">08/17</td>
      <td class="dddefault">12/04</td>
      <td class="dddefault">Jane Doe (P)</td>
    </tr>
  </table>
</td></tr>
</table>`

const DETAIL = `<table class="datadisplaytable">
<tr><th class="ddlabel"><SPAN class="fieldlabeltext">Seats</SPAN></th>
<td class="dddefault">430</td><td class="dddefault">363</td><td class="dddefault">67</td></tr>
</table>`

describe('auburn.getSections', () => {
  it('hits ssbprod.auburn.edu/pls/PROD and fills seats from detail pages', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => {
      seenUrls.push(String(url))
      if (String(url).includes('p_disp_detail_sched')) return response(url, DETAIL)
      if (String(url).includes('p_get_crse_unsec')) return response(url, LISTING)
      return response(url, '<html></html>')
    }
    const sections = await auburn.getSections({
      termCode: '202710', subjectCode: 'ACCT', termLabel: 'Fall 2026', subjectLabel: 'Accounting',
    })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].school, 'auburn')
    assert.equal(sections[0].crn, '14782')
    assert.deepEqual(sections[0].enrollment, { max: 430, current: 363, available: 67 })
    assert.equal(sections[0].status, 'open')
    assert.ok(seenUrls.every((u) => u.startsWith('https://ssbprod.auburn.edu/pls/PROD/')))
    assert.ok(seenUrls.some((u) => u.includes('p_disp_detail_sched')))
  })
})

describe('alabama.getSections', () => {
  it('hits ssb.ua.edu/pls/PROD and never fetches detail pages (no public seats)', async () => {
    const seenUrls = []
    globalThis.fetch = async (url) => {
      seenUrls.push(String(url))
      if (String(url).includes('p_get_crse_unsec')) return response(url, LISTING)
      return response(url, '<html></html>')
    }
    const sections = await alabama.getSections({
      termCode: '202640', subjectCode: 'ACCT', termLabel: 'Fall 2026', subjectLabel: 'Accounting',
    })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].school, 'alabama')
    assert.deepEqual(sections[0].enrollment, { max: null, current: null, available: null })
    assert.equal(sections[0].status, 'unknown')
    assert.deepEqual(sections[0].meetings, [
      { days: ['M', 'W', 'F'], startTime: '09:00', endTime: '09:50', location: 'Lowder Hall 113' },
    ])
    assert.ok(seenUrls.every((u) => u.startsWith('https://ssb.ua.edu/pls/PROD/')))
    assert.ok(!seenUrls.some((u) => u.includes('p_disp_detail_sched')))
  })
})
