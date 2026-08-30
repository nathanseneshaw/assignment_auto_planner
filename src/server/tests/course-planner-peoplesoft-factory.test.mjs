/**
 * Tests for the peoplesoft.js changes that the Louisville / Nevada-Reno batch
 * needed. Each one was a silent failure found live, so each gets a case:
 *
 *  1. buildFormBody only looked for `#win0`. Louisville, Mizzou and Nebraska all
 *     serve `<form id="CLASS_SEARCH" name="win0">`, which produced an EMPTY form
 *     snapshot and therefore a criteria-less search that returned nothing.
 *  2. buildFormBody posted the on-page buttons. Nebraska rejected every search
 *     with "The value for the field 'Clear' was over by 4 characters" because
 *     the visible "Clear" label overflows the underlying field.
 *  3. The criteria-bounce retry only recognised "Select at least N search
 *     criteria"; Mizzou-style instances say "Specify additional selection
 *     criteria to narrow your search" instead.
 *  4. createPeopleSoftScraper's `byCareer` sweep, for instances that reject a
 *     subject-only search.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import * as cheerio from 'cheerio'
import { cacheFlush } from '../course-planner/cache.js'
import { buildFormBody, createPeopleSoftScraper } from '../course-planner/peoplesoft.js'

let savedFetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

describe('buildFormBody form lookup', () => {
  it('finds the form by id when it is #win0', () => {
    const $ = cheerio.load('<form id="win0"><input name="A" value="1"></form>')
    assert.equal(buildFormBody($).get('A'), '1')
  })

  it('falls back to name="win0" when the id is the component name', () => {
    const $ = cheerio.load(
      '<form id="CLASS_SEARCH" name="win0"><input name="A" value="1"><select name="B"><option value="x" selected>x</option></select></form>'
    )
    const body = buildFormBody($)
    assert.equal(body.get('A'), '1')
    assert.equal(body.get('B'), 'x')
  })

  it('never posts buttons, whose labels overflow the underlying field', () => {
    const $ = cheerio.load(`<form name="win0">
      <input name="KEEP" value="1">
      <input type="button" name="CLASS_SRCH_WRK2_SSR_PB_CLEAR" value="Clear">
      <input type="submit" name="SUBMIT" value="Search">
    </form>`)
    const body = buildFormBody($)
    assert.equal(body.get('KEEP'), '1')
    assert.equal(body.get('CLASS_SRCH_WRK2_SSR_PB_CLEAR'), null)
    assert.equal(body.get('SUBMIT'), null)
  })
})

// ── createPeopleSoftScraper ───────────────────────────────────────────────────

const FORM = `<html><body><form id="CLASS_SEARCH" name="win0">
  <input name="ICSID" value="sid-1">
  <select name="CLASS_SRCH_WRK2_INSTITUTION$31$"><option value="COLUM" selected>Columbia</option></select>
  <select name="CLASS_SRCH_WRK2_STRM$35$"><option value="">Any</option><option value="5443">2026 Fall</option></select>
  <select name="SSR_CLSRCH_WRK_SUBJECT_SRCH$0"><option value="">Any</option><option value="CMP_SC">Computer Science</option></select>
  <select name="SSR_CLSRCH_WRK_ACAD_CAREER$2"><option value="">Any</option><option value="UGRD">Undergrad</option><option value="GRAD">Grad</option></select>
  <input type="checkbox" name="SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3" checked value="Y">
  <input type="button" name="CLASS_SRCH_WRK2_SSR_PB_CLEAR" value="Clear">
</form></body></html>`

/** A minimal results page carrying one section for the given CRN. */
function resultsFor(crn) {
  return `<div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0">
    <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$0">CMP SC 1050 - Algorithm Design</div>
    <span id="MTG_CLASS_NBR$0">${crn}</span>
    <span id="MTG_CLASSNAME$0">01-LEC Regular</span>
    <span id="MTG_DAYTIME$0">Mo 10:00AM - 10:50AM</span>
    <span id="MTG_ROOM$0">Hall 1</span>
    <span id="MTG_INSTR$0">A Smith</span>
  </div>`
}

const BOUNCE = '<div>Specify additional selection criteria to narrow your search.</div>'

/**
 * Serve the form on GET and a scripted response on each POST. `plan` maps the
 * career posted (or '' when none) to the response body.
 */
function mockInstance(plan) {
  const posts = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? new URLSearchParams(init.body) : null
    if (body) posts.push(body)
    const text = body
      ? plan(body.get('SSR_CLSRCH_WRK_ACAD_CAREER$2') || '', posts.length)
      : FORM
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
      text: async () => text,
      json: async () => ({}),
    }
  }
  return posts
}

describe('createPeopleSoftScraper', () => {
  it('reads terms and subjects off the search form', async () => {
    mockInstance(() => resultsFor('1'))
    const scraper = createPeopleSoftScraper({
      school: 'test-ps',
      url: 'https://ps.test/CLASS_SEARCH',
      institution: 'COLUM',
    })
    const terms = await scraper.getTerms()
    assert.deepEqual(terms, [{ code: '5443', label: '2026 Fall' }])
    const subjects = await scraper.getSubjects('5443')
    assert.deepEqual(subjects, [{ code: 'CMP_SC', label: 'Computer Science' }])
  })

  it('sets institution, term and subject and drops the open-only checkbox', async () => {
    const posts = mockInstance(() => resultsFor('1'))
    const scraper = createPeopleSoftScraper({
      school: 'test-ps-criteria',
      url: 'https://ps.test/CLASS_SEARCH',
      institution: 'COLUM',
    })
    await scraper.getSections({ termCode: '5443', subjectCode: 'CMP_SC' })
    const search = posts[0]
    assert.equal(search.get('CLASS_SRCH_WRK2_INSTITUTION$31$'), 'COLUM')
    assert.equal(search.get('CLASS_SRCH_WRK2_STRM$35$'), '5443')
    assert.equal(search.get('SSR_CLSRCH_WRK_SUBJECT_SRCH$0'), 'CMP_SC')
    // "Show Open Classes Only" would hide full sections, which a planner needs.
    assert.equal(search.get('SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3'), null)
  })

  it('retries the Mizzou-style criteria bounce instead of returning empty', async () => {
    let attempt = 0
    mockInstance(() => {
      attempt += 1
      return attempt === 1 ? BOUNCE : resultsFor('9001')
    })
    const scraper = createPeopleSoftScraper({
      school: 'test-ps-bounce',
      url: 'https://ps.test/CLASS_SEARCH',
      institution: 'COLUM',
    })
    const sections = await scraper.getSections({ termCode: '5443', subjectCode: 'CMP_SC' })
    assert.equal(attempt > 1, true, 'should have retried the bounce')
    assert.equal(sections.length, 1)
    assert.equal(sections[0].crn, '9001')
  })

  it('sweeps every career and merges on CRN when byCareer is set', async () => {
    const posts = mockInstance((career) => {
      if (career === 'UGRD') return resultsFor('100')
      if (career === 'GRAD') return resultsFor('200')
      return BOUNCE
    })
    const scraper = createPeopleSoftScraper({
      school: 'test-ps-career',
      url: 'https://ps.test/CLASS_SEARCH',
      institution: 'COLUM',
      byCareer: true,
    })
    const sections = await scraper.getSections({ termCode: '5443', subjectCode: 'CMP_SC' })
    const careersPosted = new Set(
      posts.map((p) => p.get('SSR_CLSRCH_WRK_ACAD_CAREER$2')).filter(Boolean)
    )
    assert.deepEqual([...careersPosted].sort(), ['GRAD', 'UGRD'])
    assert.deepEqual(
      sections.map((s) => s.crn).sort(),
      ['100', '200']
    )
  })

  it('does not send a career at all when byCareer is off', async () => {
    const posts = mockInstance(() => resultsFor('1'))
    const scraper = createPeopleSoftScraper({
      school: 'test-ps-nocareer',
      url: 'https://ps.test/CLASS_SEARCH',
      institution: 'COLUM',
    })
    await scraper.getSections({ termCode: '5443', subjectCode: 'CMP_SC' })
    assert.ok(posts.every((p) => !p.get('SSR_CLSRCH_WRK_ACAD_CAREER$2')))
  })
})
