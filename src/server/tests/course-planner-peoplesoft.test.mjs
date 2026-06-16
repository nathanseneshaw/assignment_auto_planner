/**
 * Tests for peoplesoft.js shared helpers.
 * These functions power UTA, UT Tyler, and the UH system.
 * We test the exported pure helpers directly (extractCdataHtml, parseSearchResults,
 * buildFormBody, setIcAction) plus loadSearchForm via mocked fetch.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { cacheFlush } from '../course-planner/cache.js'
import {
  extractCdataHtml,
  parseSearchResults,
  buildFormBody,
  setIcAction,
  loadSearchForm,
} from '../course-planner/peoplesoft.js'
import * as cheerio from 'cheerio'

let savedFetch
beforeEach(() => { savedFetch = globalThis.fetch; cacheFlush() })
afterEach(() => { globalThis.fetch = savedFetch })

function mockRes(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

// ── extractCdataHtml ──────────────────────────────────────────────────────────

describe('extractCdataHtml', () => {
  it('extracts content from CDATA blocks', () => {
    const xml = `<?xml?><response><![CDATA[<div>Hello</div>]]></response>`
    assert.ok(extractCdataHtml(xml).includes('<div>Hello</div>'))
  })

  it('concatenates multiple CDATA blocks', () => {
    const xml = `<r><![CDATA[Part A]]><![CDATA[Part B]]></r>`
    const out = extractCdataHtml(xml)
    assert.ok(out.includes('Part A'))
    assert.ok(out.includes('Part B'))
  })

  it('returns text unchanged when no CDATA present', () => {
    const html = '<div>plain html</div>'
    assert.equal(extractCdataHtml(html), html)
  })

  it('returns empty string for empty CDATA', () => {
    const xml = `<r><![CDATA[]]></r>`
    const out = extractCdataHtml(xml)
    assert.equal(out.trim(), '')
  })
})

// ── buildFormBody ─────────────────────────────────────────────────────────────

describe('buildFormBody', () => {
  it('collects text input values', () => {
    const $ = cheerio.load('<form id="win0"><input name="MYFIELD" value="hello" /></form>')
    const body = buildFormBody($)
    assert.equal(body.get('MYFIELD'), 'hello')
  })

  it('collects select selected option value', () => {
    const $ = cheerio.load(`
      <form id="win0">
        <select name="MYSEL">
          <option value="A">Option A</option>
          <option value="B" selected>Option B</option>
        </select>
      </form>
    `)
    const body = buildFormBody($)
    assert.equal(body.get('MYSEL'), 'B')
  })

  it('skips inputs without a name attribute', () => {
    const $ = cheerio.load('<form id="win0"><input value="x" /></form>')
    const body = buildFormBody($)
    assert.equal([...body.keys()].length, 0)
  })

  it('handles checked checkboxes', () => {
    const $ = cheerio.load('<form id="win0"><input type="checkbox" name="CB" value="Y" checked /></form>')
    const body = buildFormBody($)
    assert.equal(body.get('CB'), 'Y')
  })

  it('skips unchecked checkboxes', () => {
    const $ = cheerio.load('<form id="win0"><input type="checkbox" name="CB" value="Y" /></form>')
    const body = buildFormBody($)
    assert.equal(body.get('CB'), undefined)
  })
})

// ── setIcAction ───────────────────────────────────────────────────────────────

describe('setIcAction', () => {
  it('sets required ICAJAX bookkeeping fields', () => {
    const body = new URLSearchParams()
    setIcAction(body, { icsid: 'abc123', action: 'MY_BTN', stateNum: 3 })
    assert.equal(body.get('ICAJAX'), '1')
    assert.equal(body.get('ICSID'), 'abc123')
    assert.equal(body.get('ICAction'), 'MY_BTN')
    assert.equal(body.get('ICStateNum'), '3')
  })

  it('defaults stateNum to 1', () => {
    const body = new URLSearchParams()
    setIcAction(body, { icsid: 'x', action: 'Y' })
    assert.equal(body.get('ICStateNum'), '1')
  })
})

// ── loadSearchForm ────────────────────────────────────────────────────────────

describe('loadSearchForm', () => {
  it('parses ICSID from the form HTML', async () => {
    const html = `<html><body><input name="ICSID" value="sess-id-99" /></body></html>`
    globalThis.fetch = async () => mockRes(html)
    const { icsid } = await loadSearchForm('https://ps.example.edu/CLASS_SEARCH.GBL')
    assert.equal(icsid, 'sess-id-99')
  })

  it('returns empty string when ICSID is absent', async () => {
    globalThis.fetch = async () => mockRes('<html><body></body></html>')
    const { icsid } = await loadSearchForm('https://ps.example.edu/CLASS_SEARCH.GBL')
    assert.equal(icsid, '')
  })
})

// ── parseSearchResults ────────────────────────────────────────────────────────

describe('parseSearchResults', () => {
  // Build minimal PeopleSoft results HTML (the CDATA content)
  function psResultsHtml({ crn = '12345', subjectCode = 'ACCT', courseNumber = '2301',
    title = 'Principles of Accounting', classname = '001-LEC',
    daytime = 'MoWe 9:00AM - 10:30AM', room = 'BUS 101',
    instructor = 'Jane Smith', statusAlt = 'Open' } = {}) {
    return `
      <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0">
        <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$0">${subjectCode} ${courseNumber} - ${title}</div>
        <span id="MTG_CLASS_NBR$0">${crn}</span>
        <span id="MTG_CLASSNAME$0">${classname}</span>
        <span id="MTG_DAYTIME$0">${daytime}</span>
        <span id="MTG_ROOM$0">${room}</span>
        <span id="MTG_INSTR$0">${instructor}</span>
        <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0">
          <img alt="${statusAlt}" />
        </div>
      </div>
    `
  }

  it('parses a single section with open status', () => {
    const results = parseSearchResults(psResultsHtml(), {
      school: 'uta', termCode: '202510', termLabel: 'Fall 2025', subjectLabel: 'Accounting',
    })
    assert.equal(results.length, 1)
    const s = results[0]
    assert.equal(s.school, 'uta')
    assert.equal(s.crn, '12345')
    assert.equal(s.subjectCode, 'ACCT')
    assert.equal(s.courseNumber, '2301')
    assert.equal(s.title, 'Principles of Accounting')
    assert.equal(s.sectionNumber, '001')
    assert.equal(s.status, 'open')
    assert.equal(s.meetings.length, 1)
    assert.deepEqual(s.meetings[0].days, ['M', 'W'])
    assert.equal(s.meetings[0].startTime, '09:00')
    assert.equal(s.meetings[0].endTime, '10:30')
    assert.equal(s.meetings[0].location, 'BUS 101')
    assert.deepEqual(s.instructors, ['Jane Smith'])
  })

  it('maps status alt "Closed" to "closed"', () => {
    const results = parseSearchResults(psResultsHtml({ statusAlt: 'Closed' }), {
      school: 'uta', termCode: '202510',
    })
    assert.equal(results[0].status, 'closed')
  })

  it('maps status alt "Wait List" to "closed"', () => {
    const results = parseSearchResults(psResultsHtml({ statusAlt: 'Wait List' }), {
      school: 'uta', termCode: '202510',
    })
    assert.equal(results[0].status, 'closed')
  })

  it('drops TBA meeting (no daytime pattern)', () => {
    const results = parseSearchResults(psResultsHtml({ daytime: 'TBA' }), {
      school: 'uta', termCode: '202510',
    })
    assert.equal(results[0].meetings.length, 0)
  })

  it('merges multiple meeting rows for the same CRN', () => {
    const html = `
      <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0">
        <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP$0">PHYS 1000 - Physics</div>
        <span id="MTG_CLASS_NBR$0">55555</span>
        <span id="MTG_CLASSNAME$0">001-LEC</span>
        <span id="MTG_DAYTIME$0">MoWe 9:00AM - 10:00AM</span>
        <span id="MTG_ROOM$0">SCI 100</span>
        <span id="MTG_INSTR$0">Dr. Newton</span>
        <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0"><img alt="Open" /></div>
        <span id="MTG_CLASS_NBR$1">55555</span>
        <span id="MTG_CLASSNAME$1">001-LAB</span>
        <span id="MTG_DAYTIME$1">Fr 1:00PM - 3:00PM</span>
        <span id="MTG_ROOM$1">SCI 200</span>
        <span id="MTG_INSTR$1">Dr. Newton</span>
        <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$1"><img alt="Open" /></div>
      </div>
    `
    const results = parseSearchResults(html, { school: 'uta', termCode: '202510' })
    assert.equal(results.length, 1)
    assert.equal(results[0].crn, '55555')
    assert.equal(results[0].meetings.length, 2)
  })

  it('works on plain HTML (no CDATA wrapping)', () => {
    const results = parseSearchResults(psResultsHtml(), { school: 'uta', termCode: '202510' })
    assert.equal(results.length, 1)
  })

  it('works when content is wrapped in CDATA', () => {
    const inner = psResultsHtml()
    const xml = `<?xml version="1.0"?><r><![CDATA[${inner}]]></r>`
    const results = parseSearchResults(xml, { school: 'uta', termCode: '202510' })
    assert.equal(results.length, 1)
  })

  it('filters out Staff placeholder instructor', () => {
    const results = parseSearchResults(psResultsHtml({ instructor: 'Staff', statusAlt: 'Open' }), {
      school: 'uta', termCode: '202510',
    })
    assert.deepEqual(results[0].instructors, [])
  })

  it('returns empty array for page with no section groups', () => {
    const results = parseSearchResults('<html><body>No results</body></html>', {
      school: 'uta', termCode: '202510',
    })
    assert.deepEqual(results, [])
  })
})
