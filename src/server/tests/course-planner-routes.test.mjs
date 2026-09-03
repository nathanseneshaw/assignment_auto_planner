/**
 * Tests for course-planner-routes.js, the public Course Planner HTTP router.
 *
 * The router is a plain Express Router with no injection seams, so it is mounted
 * on a throwaway app and driven over a real loopback socket with node:http. The
 * client side deliberately does NOT use fetch: every test replaces
 * globalThis.fetch with a stub that throws, so nothing in this file can reach a
 * university and an unstubbed scraper call fails loudly instead of hanging.
 *
 * Cornell stands in as "a real school" wherever a route must reach a scraper.
 * cornell-scraper.js is a thin JSON client (classes.cornell.edu/api/2.0), so a
 * stubbed fetch fully determines what the router receives. Where the router's
 * own handling of an odd *section* shape is the thing under test, the scraper's
 * cacheMemo entry is seeded directly with cacheSet, which bypasses fetch
 * entirely, which also proves the route made no network call at all.
 *
 * Rate limiting: coursePlannerLimiter is module-global, so its 30 req/min
 * budget is shared by every test in this file. Each request therefore carries a
 * unique X-Forwarded-For (with `trust proxy` set the way src/server/index.js
 * sets it) so requests bucket separately; the limiter itself is tested on its
 * own dedicated IPs.
 */
import assert from 'node:assert'
import http from 'node:http'
import { after, before, beforeEach, afterEach, describe, it } from 'node:test'
import express from 'express'
import { cacheFlush, cacheSet } from '../course-planner/cache.js'
import router from '../course-planner-routes.js'

const CORNELL_TERMS_KEY = 'cornell:terms'
const cornellSectionsKey = (term, subject) => `cornell:sections:${term}:${subject}`

// ── harness ───────────────────────────────────────────────────────────────────

let server
let port

before(async () => {
  const app = express()
  // Mirror src/server/index.js. A number (not `true`) keeps express-rate-limit's
  // ERR_ERL_PERMISSIVE_TRUST_PROXY validation quiet while still letting each
  // request pick its own rate-limit bucket via X-Forwarded-For.
  app.set('trust proxy', 1)
  app.use(router)
  server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  port = server.address().port
})

after(() => {
  server?.close()
})

let ipCounter = 0
/** A fresh RFC1918 address per request so the shared limiter never interferes. */
function nextIp() {
  ipCounter += 1
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

/** GET over a real socket. Never uses fetch, which the tests have stubbed out. */
function request(path, { ip = nextIp() } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { 'X-Forwarded-For': ip } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(body) } catch { /* express' HTML 404 page */ }
          resolve({ status: res.statusCode, headers: res.headers, body, json })
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

let savedFetch
let savedConsoleError
let consoleErrors
let fetchedUrls

beforeEach(() => {
  savedFetch = globalThis.fetch
  cacheFlush()
  fetchedUrls = []
  // Default: any scraper that tries to go out fails loudly rather than silently
  // reaching the internet. Tests that need a scraper install their own stub.
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url))
    throw new Error(`unexpected network call: ${url}`)
  }
  // handleError console.errors on every 502; capture instead of spamming output.
  consoleErrors = []
  savedConsoleError = console.error
  console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')) }
})

afterEach(() => {
  globalThis.fetch = savedFetch
  console.error = savedConsoleError
  cacheFlush()
})

/** A minimal Response for the Cornell JSON API. */
function jsonOk(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    headers: { get: () => null, getSetCookie: () => [], forEach: () => {} },
  }
}

/** Install a fetch stub that answers Cornell endpoints by URL substring. */
function stubCornell(routes) {
  globalThis.fetch = async (url) => {
    const href = String(url)
    fetchedUrls.push(href)
    const key = Object.keys(routes).find((k) => href.includes(k))
    if (!key) throw new Error(`unstubbed URL: ${href}`)
    const value = routes[key]
    return jsonOk(typeof value === 'function' ? value(href) : value)
  }
}

const rosters = (list) => ({ 'rosters.json': { status: 'success', data: { rosters: list } } })
const subjects = (list) => ({ 'subjects.json': { status: 'success', data: { subjects: list } } })
const classes = (list) => ({ 'classes.json': { status: 'success', data: { classes: list } } })

/** One Cornell class wrapping the given classSections. */
function cornellClass(classSections, extra = {}) {
  return {
    catalogNbr: '1110',
    titleLong: 'Introduction to Computing',
    enrollGroups: [{ unitsMinimum: 4, classSections }],
    ...extra,
  }
}

const lecture = (meetings, extra = {}) => ({
  ssrComponent: 'LEC',
  section: '001',
  classNbr: '1001',
  openStatus: 'O',
  meetings,
  ...extra,
})

const meeting = (extra = {}) => ({
  pattern: 'MW',
  timeStart: '09:05AM',
  timeEnd: '09:55AM',
  bldgDescr: 'Gates Hall',
  facilityDescr: '114',
  ...extra,
})

/**
 * The season the term window considers "in progress", derived independently of
 * term-window.js so the expectation is a real cross-check rather than a
 * restatement of the implementation. Keeps the /terms tests date-independent.
 */
function currentSeasonAndYear(now = new Date()) {
  const month = now.getMonth() + 1
  const season = month <= 4 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall'
  return { season, year: now.getFullYear() }
}

/** The term that follows `season year` in Winter < Spring < Summer < Fall order. */
function nextTerm({ season, year }) {
  const order = ['Winter', 'Spring', 'Summer', 'Fall']
  const i = order.indexOf(season)
  return i === order.length - 1
    ? { season: 'Winter', year: year + 1 }
    : { season: order[i + 1], year }
}

// ── GET /schools ──────────────────────────────────────────────────────────────

describe('GET /api/course-planner/schools', () => {
  it('returns 200 with success:true and a non-empty school list', async () => {
    const res = await request('/api/course-planner/schools')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'], /application\/json/)
    assert.equal(res.json.success, true)
    assert.ok(Array.isArray(res.json.schools))
    // The catalog is ~83 schools; assert a floor rather than an exact count so
    // adding a school does not break the test.
    assert.ok(res.json.schools.length >= 60, `only ${res.json.schools.length} schools`)
  })

  it('strips the internal scraper module from every entry', async () => {
    const res = await request('/api/course-planner/schools')
    for (const entry of res.json.schools) {
      assert.ok(!('scraper' in entry), `${entry.code} leaked a scraper key`)
    }
    // Belt and braces: the raw body must not mention it either, which would
    // catch a scraper hidden inside a nested field.
    assert.ok(!res.body.includes('scraper'), 'response body mentions "scraper"')
  })

  it('exposes exactly code / name / enrollmentDataAvailable on each entry', async () => {
    const res = await request('/api/course-planner/schools')
    for (const entry of res.json.schools) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['code', 'enrollmentDataAvailable', 'name'],
        `unexpected keys on ${entry.code}: ${Object.keys(entry)}`
      )
    }
  })

  it('gives every entry a non-empty code and name and a boolean flag', async () => {
    const res = await request('/api/course-planner/schools')
    for (const entry of res.json.schools) {
      assert.equal(typeof entry.code, 'string')
      assert.ok(entry.code.length > 0)
      assert.equal(typeof entry.name, 'string')
      assert.ok(entry.name.trim().length > 0, `${entry.code} has a blank name`)
      assert.equal(
        typeof entry.enrollmentDataAvailable,
        'boolean',
        `${entry.code}.enrollmentDataAvailable is not a boolean`
      )
    }
  })

  it('uses url-safe lowercase codes that are unique across the catalog', async () => {
    const codes = (await request('/api/course-planner/schools')).json.schools.map((s) => s.code)
    for (const code of codes) assert.match(code, /^[a-z0-9]+$/)
    assert.equal(new Set(codes).size, codes.length, 'duplicate school code')
    // A code that collides with an Object.prototype member would silently
    // defeat the unknown-school 404 (see the getScraper suite below).
    for (const code of codes) {
      assert.ok(!(code in Object.prototype), `${code} shadows an Object.prototype key`)
    }
  })

  it('reports both enrollment-data states (the flag is not degenerate)', async () => {
    const flags = (await request('/api/course-planner/schools')).json.schools.map(
      (s) => s.enrollmentDataAvailable
    )
    assert.ok(flags.includes(true), 'no school reports enrollment data')
    assert.ok(flags.includes(false), 'no school reports missing enrollment data')
  })

  it('lists a few known schools', async () => {
    const codes = (await request('/api/course-planner/schools')).json.schools.map((s) => s.code)
    for (const code of ['rice', 'tamu', 'utd', 'cornell', 'mit']) {
      assert.ok(codes.includes(code), `missing ${code}`)
    }
  })

  it('every advertised code resolves back to a SCHOOLS entry', async () => {
    // /subjects runs getScraper first and only then rejects the missing ?term=,
    // so 400 proves the lookup hit an entry and 404 proves it did not. A code
    // that did not match its own SCHOOLS key would 404 here.
    const codes = (await request('/api/course-planner/schools')).json.schools.map((s) => s.code)
    const results = await Promise.all(
      codes.map(async (code) => [code, (await request(`/api/course-planner/${code}/subjects`)).status])
    )
    const unresolved = results.filter(([, status]) => status !== 400)
    assert.deepEqual(unresolved, [], `codes that did not resolve: ${JSON.stringify(unresolved)}`)
    assert.equal(fetchedUrls.length, 0, 'the 400 path must not touch a scraper')
  })

  it('never touches the network', async () => {
    await request('/api/course-planner/schools')
    assert.deepEqual(fetchedUrls, [])
  })
})

// ── getScraper: unknown-school 404 ────────────────────────────────────────────

describe('getScraper unknown-school handling', () => {
  it('404s with the structured error shape', async () => {
    const res = await request('/api/course-planner/nope/terms')
    assert.equal(res.status, 404)
    assert.deepEqual(res.json, { success: false, error: 'Unknown school: nope' })
  })

  it('404s on /subjects and /sections too, before the missing-param check', async () => {
    for (const route of ['subjects', 'sections']) {
      const res = await request(`/api/course-planner/nope/${route}`)
      assert.equal(res.status, 404, route)
      assert.equal(res.json.error, 'Unknown school: nope')
    }
  })

  it('404s on a known code in the wrong case (lookup is case-sensitive)', async () => {
    const res = await request('/api/course-planner/RICE/terms')
    assert.equal(res.status, 404)
    assert.equal(res.json.error, 'Unknown school: RICE')
  })

  it('404s on a known code with trailing whitespace (no trimming)', async () => {
    const res = await request('/api/course-planner/rice%20/terms')
    assert.equal(res.status, 404)
    assert.equal(res.json.error, 'Unknown school: rice ')
  })

  it('404s on a url-encoded path-traversal attempt without touching the fs', async () => {
    const res = await request(`/api/course-planner/${encodeURIComponent('../../etc/passwd')}/terms`)
    assert.equal(res.status, 404)
    assert.equal(res.json.error, 'Unknown school: ../../etc/passwd')
  })

  it('404s on a very long school param without truncating it', async () => {
    const long = 'x'.repeat(4000)
    const res = await request(`/api/course-planner/${long}/terms`)
    assert.equal(res.status, 404)
    assert.equal(res.json.error, `Unknown school: ${long}`)
  })

  it('404s on numeric and punctuation-only school params', async () => {
    for (const school of ['0', '-', encodeURIComponent('<script>'), encodeURIComponent('null')]) {
      const res = await request(`/api/course-planner/${school}/terms`)
      assert.equal(res.status, 404, school)
      assert.equal(res.json.success, false)
    }
  })

  it('an empty school segment matches no route at all (express 404, not JSON)', async () => {
    const res = await request('/api/course-planner//terms')
    assert.equal(res.status, 404)
    assert.equal(res.json, null, 'expected the express HTML 404, not the JSON error shape')
    assert.match(res.body, /Cannot GET/)
  })

  it('makes no scraper call on any unknown-school request', async () => {
    await request('/api/course-planner/nope/sections?term=a&subject=b')
    assert.deepEqual(fetchedUrls, [])
  })
})

// ── getScraper: Object.prototype keys (known gap, behavior pinned) ────────────

describe('getScraper prototype-key lookup', () => {
  // SCHOOLS is a plain object literal, so SCHOOLS.constructor / .__proto__ /
  // .toString all resolve to truthy inherited members and slip past the
  // `if (!entry)` guard. Nothing is written, so this is not prototype
  // *pollution*, but the 404 is lost: /terms falls through to a 502 built from
  // `entry.code`, which is undefined. These tests pin today's behavior; see the
  // task report for the suggested Object.hasOwn / null-prototype fix.
  const PROTO_KEYS = [
    '__proto__',
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    '__defineGetter__',
  ]

  for (const key of PROTO_KEYS) {
    it(`/terms on "${key}" is a 502, not the 404 it should be`, async () => {
      const res = await request(`/api/course-planner/${encodeURIComponent(key)}/terms`)
      assert.equal(res.status, 502, `${key} should have 404'd`)
      assert.equal(res.json.success, false)
      // entry.code is undefined for an inherited member, so the context reads
      // "undefined terms" instead of a school code.
      assert.equal(
        res.json.error,
        "undefined terms failed: Cannot read properties of undefined (reading 'getTerms')"
      )
    })
  }

  it('/subjects on a prototype key reports a missing ?term= instead of 404', async () => {
    const res = await request('/api/course-planner/constructor/subjects')
    assert.equal(res.status, 400)
    assert.deepEqual(res.json, { success: false, error: 'Missing ?term=<code>' })
  })

  it('/sections on a prototype key reports missing params instead of 404', async () => {
    const res = await request('/api/course-planner/__proto__/sections')
    assert.equal(res.status, 400)
    assert.deepEqual(res.json, {
      success: false,
      error: 'Missing ?term=<code>&subject=<code>',
    })
  })

  it('/subjects on a prototype key with params 502s rather than calling anything', async () => {
    const res = await request('/api/course-planner/toString/subjects?term=FA26')
    assert.equal(res.status, 502)
    assert.equal(res.json.success, false)
    assert.match(res.json.error, /^undefined subjects failed: /)
    assert.deepEqual(fetchedUrls, [], 'no scraper exists to call')
  })

  it('a prototype key never mutates SCHOOLS (the /schools list is unchanged)', async () => {
    const before = (await request('/api/course-planner/schools')).json.schools
    await request('/api/course-planner/__proto__/terms')
    await request('/api/course-planner/constructor/terms')
    const afterList = (await request('/api/course-planner/schools')).json.schools
    assert.deepEqual(afterList, before)
  })
})

// ── GET /:school/terms ────────────────────────────────────────────────────────

describe('GET /api/course-planner/:school/terms', () => {
  it('trims a long roster list to the current term plus the next one', async () => {
    const current = currentSeasonAndYear()
    const upcoming = nextTerm(current)
    const y = current.year
    // Deliberately messy dialects: the route must both trim and relabel.
    stubCornell(
      rosters([
        { slug: 'ANCIENT', descr: 'Fall 2004' },
        { slug: `WI${y}`, descr: `WINTER ${y}` },
        { slug: `SP${y}`, descr: `${y} Spring` },
        { slug: `SU${y}`, descr: `Summer${y}` },
        { slug: `FA${y}`, descr: `Autumn ${y}` },
        { slug: `WI${y + 1}`, descr: `IAP ${y + 1}` },
        { slug: `SP${y + 1}`, descr: `Spring ${y + 1} (View Only)` },
        { slug: `SU${y + 1}`, descr: `Summer ${y + 1}` },
        { slug: `FA${y + 1}`, descr: `Fall ${y + 1}` },
      ])
    )
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 200)
    assert.equal(res.json.success, true)
    const code = ({ season, year }) => `${season.slice(0, 2).toUpperCase()}${year}`
    assert.deepEqual(res.json.terms, [
      { code: code(current), label: `${current.season} ${current.year}` },
      { code: code(upcoming), label: `${upcoming.season} ${upcoming.year}` },
    ])
  })

  it('never returns more than two terms and drops ancient ones', async () => {
    const y = new Date().getFullYear()
    stubCornell(
      rosters([
        { slug: 'a', descr: 'Fall 2004' },
        { slug: 'b', descr: 'Spring 2005' },
        { slug: 'c', descr: `Spring ${y}` },
        { slug: 'd', descr: `Summer ${y}` },
        { slug: 'e', descr: `Fall ${y}` },
        { slug: 'f', descr: `Spring ${y + 1}` },
        { slug: 'g', descr: `Fall ${y + 1}` },
      ])
    )
    const { terms } = (await request('/api/course-planner/cornell/terms')).json
    assert.equal(terms.length, 2)
    assert.ok(!terms.some((t) => /200[45]/.test(t.label)), 'a 2004/2005 term survived')
    for (const t of terms) assert.match(t.label, /^(Winter|Spring|Summer|Fall) \d{4}$/)
  })

  it('passes term codes through untouched while rewriting only the label', async () => {
    const y = new Date().getFullYear()
    stubCornell(
      rosters([
        { slug: '2024-FALL-01', descr: 'Fall 2004' },
        { slug: 'weird/code:1', descr: `Spring ${y}` },
        { slug: 'weird/code:2', descr: `Summer ${y}` },
        { slug: 'weird/code:3', descr: `Fall ${y}` },
        { slug: 'weird/code:4', descr: `Spring ${y + 1}` },
      ])
    )
    const { terms } = (await request('/api/course-planner/cornell/terms')).json
    for (const t of terms) assert.match(t.code, /^weird\/code:\d$/)
  })

  it('returns an empty list when the scraper hands back a non-array', async () => {
    cacheSet(CORNELL_TERMS_KEY, { rosters: 'nope' }, 60_000)
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { success: true, terms: [] })
    assert.deepEqual(fetchedUrls, [], 'seeded cache means no network')
  })

  it('degrades to the raw list, trimmed to two, when nothing parses', async () => {
    stubCornell(
      rosters([
        { slug: '202610', descr: '202610' },
        { slug: '202620', descr: '202620' },
        { slug: '202630', descr: '202630' },
      ])
    )
    const { terms } = (await request('/api/course-planner/cornell/terms')).json
    assert.deepEqual(terms, [
      { code: '202610', label: '202610' },
      { code: '202620', label: '202620' },
    ])
  })

  it('502s when the scraper throws, with the school + route in the message', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' })
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.equal(res.json.success, false)
    assert.equal(res.json.error, 'cornell terms failed: Cornell API returned HTTP 503')
  })

  it('502s when the upstream JSON reports a non-success status', async () => {
    stubCornell({ 'rosters.json': { status: 'error', message: 'roster offline' } })
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.equal(res.json.error, 'cornell terms failed: Cornell API error: roster offline')
  })
})

// ── GET /:school/subjects ─────────────────────────────────────────────────────

describe('GET /api/course-planner/:school/subjects', () => {
  it('400s when ?term= is absent', async () => {
    const res = await request('/api/course-planner/cornell/subjects')
    assert.equal(res.status, 400)
    assert.deepEqual(res.json, { success: false, error: 'Missing ?term=<code>' })
    assert.deepEqual(fetchedUrls, [])
  })

  it('400s when ?term= is present but empty', async () => {
    const res = await request('/api/course-planner/cornell/subjects?term=')
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'Missing ?term=<code>')
  })

  it('400s when ?term= is whitespace-only', async () => {
    for (const raw of ['%20%20', '%09', '%20%0A%20']) {
      const res = await request(`/api/course-planner/cornell/subjects?term=${raw}`)
      assert.equal(res.status, 400, raw)
      assert.equal(res.json.error, 'Missing ?term=<code>')
    }
  })

  it('returns the scraper subject list on success', async () => {
    stubCornell(
      subjects([
        { value: 'CS', descrformal: 'Computer Science' },
        { value: 'MATH', descr: 'Mathematics' },
        { value: 'XX' },
      ])
    )
    const res = await request('/api/course-planner/cornell/subjects?term=FA26')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, {
      success: true,
      subjects: [
        { code: 'CS', label: 'Computer Science' },
        { code: 'MATH', label: 'Mathematics' },
        { code: 'XX', label: 'XX' },
      ],
    })
  })

  it('forwards the trimmed term code to the scraper', async () => {
    stubCornell(subjects([]))
    await request('/api/course-planner/cornell/subjects?term=%20FA26%20')
    assert.equal(fetchedUrls.length, 1)
    assert.match(fetchedUrls[0], /roster=FA26(&|$)/)
  })

  it('returns an empty subject list without erroring', async () => {
    stubCornell(subjects([]))
    const res = await request('/api/course-planner/cornell/subjects?term=FA26')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { success: true, subjects: [] })
  })

  it('collapses a repeated ?term= into one comma-joined code (String coercion)', async () => {
    // Express' extended query parser turns ?term=a&term=b into an array, which
    // String() flattens to "a,b" rather than rejecting it.
    stubCornell(subjects([]))
    const res = await request('/api/course-planner/cornell/subjects?term=a&term=b')
    assert.equal(res.status, 200)
    assert.match(fetchedUrls[0], /roster=a%2Cb/)
  })

  it('502s when the scraper throws, tagged "<school> subjects"', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' })
    const res = await request('/api/course-planner/cornell/subjects?term=FA26')
    assert.equal(res.status, 502)
    assert.equal(res.json.success, false)
    assert.equal(res.json.error, 'cornell subjects failed: Cornell API returned HTTP 500')
  })
})

// ── GET /:school/sections ─────────────────────────────────────────────────────

describe('GET /api/course-planner/:school/sections', () => {
  it('400s when ?term= is missing', async () => {
    const res = await request('/api/course-planner/cornell/sections?subject=CS')
    assert.equal(res.status, 400)
    assert.deepEqual(res.json, { success: false, error: 'Missing ?term=<code>&subject=<code>' })
  })

  it('400s when ?subject= is missing', async () => {
    const res = await request('/api/course-planner/cornell/sections?term=FA26')
    assert.equal(res.status, 400)
    assert.equal(res.json.error, 'Missing ?term=<code>&subject=<code>')
  })

  it('400s when both are missing, and when either is whitespace-only', async () => {
    const paths = [
      '/api/course-planner/cornell/sections',
      '/api/course-planner/cornell/sections?term=&subject=',
      '/api/course-planner/cornell/sections?term=%20&subject=CS',
      '/api/course-planner/cornell/sections?term=FA26&subject=%20%20',
    ]
    for (const path of paths) {
      const res = await request(path)
      assert.equal(res.status, 400, path)
      assert.equal(res.json.error, 'Missing ?term=<code>&subject=<code>')
    }
    assert.deepEqual(fetchedUrls, [], 'the 400 path must not touch a scraper')
  })

  it('returns success + count + sections, with count === sections.length', async () => {
    stubCornell(
      classes([
        cornellClass([
          lecture([meeting()]),
          lecture([meeting({ timeStart: '11:15AM', timeEnd: '12:05PM' })], {
            section: '002',
            classNbr: '1002',
            openStatus: 'C',
          }),
        ]),
      ])
    )
    const res = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    assert.equal(res.status, 200)
    assert.equal(res.json.success, true)
    assert.equal(res.json.count, 2)
    assert.equal(res.json.count, res.json.sections.length)
    assert.equal(res.json.sections[0].crn, '1001')
    assert.equal(res.json.sections[1].status, 'closed')
  })

  it('reports count 0 for an empty section list', async () => {
    stubCornell(classes([]))
    const res = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    assert.deepEqual(res.json, { success: true, count: 0, sections: [] })
  })

  it('forwards termLabel and subjectLabel through to the scraper', async () => {
    stubCornell(classes([cornellClass([lecture([meeting()])])]))
    const res = await request(
      '/api/course-planner/cornell/sections?term=FA26&subject=CS' +
        '&termLabel=Fall%202026&subjectLabel=Computer%20Science'
    )
    const [section] = res.json.sections
    assert.equal(section.termLabel, 'Fall 2026')
    assert.equal(section.subjectLabel, 'Computer Science')
  })

  it('defaults termLabel and subjectLabel to "" when absent', async () => {
    stubCornell(classes([cornellClass([lecture([meeting()])])]))
    const res = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    const [section] = res.json.sections
    // The router passes '' for both; Cornell echoes termLabel and falls back to
    // the subject code, which is only reachable when subjectLabel is falsy.
    assert.equal(section.termLabel, '')
    assert.equal(section.subjectLabel, 'CS')
  })

  it('forwards the trimmed term and subject codes', async () => {
    stubCornell(classes([]))
    await request('/api/course-planner/cornell/sections?term=%20FA26%20&subject=%20CS%20')
    assert.equal(fetchedUrls.length, 1)
    assert.match(fetchedUrls[0], /roster=FA26&subject=CS$/)
  })

  it('502s when the scraper throws, tagged "<school> sections"', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' })
    const res = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    assert.equal(res.status, 502)
    assert.equal(res.json.error, 'cornell sections failed: Cornell API returned HTTP 429')
  })

  it('502s rather than crashing when the scraper hands back a non-iterable', async () => {
    cacheSet(cornellSectionsKey('T1', 'S1'), { not: 'iterable' }, 60_000)
    const res = await request('/api/course-planner/cornell/sections?term=T1&subject=S1')
    assert.equal(res.status, 502)
    assert.equal(res.json.success, false)
    assert.match(res.json.error, /^cornell sections failed: .*not iterable/)
  })
})

// ── /sections dedupeMeetings safety net ───────────────────────────────────────

describe('GET /:school/sections dedupeMeetings safety net', () => {
  it('collapses identical repeated weekly blocks to one', async () => {
    const m = meeting()
    stubCornell(classes([cornellClass([lecture([m, { ...m }, { ...m }, { ...m }, { ...m }])])]))
    const res = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    const [section] = res.json.sections
    assert.equal(section.meetings.length, 1, 'duplicate weekly blocks were not collapsed')
    assert.deepEqual(section.meetings[0], {
      days: ['M', 'W'],
      startTime: '09:05',
      endTime: '09:55',
      location: 'Gates Hall 114',
    })
  })

  it('collapses duplicates that differ only in day order', async () => {
    stubCornell(
      classes([cornellClass([lecture([meeting({ pattern: 'MW' }), meeting({ pattern: 'WM' })])])])
    )
    const [section] = (
      await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    ).json.sections
    assert.equal(section.meetings.length, 1)
    // First occurrence wins, so the original day order survives.
    assert.deepEqual(section.meetings[0].days, ['M', 'W'])
  })

  it('keeps genuinely distinct meetings (day, time, and room)', async () => {
    stubCornell(
      classes([
        cornellClass([
          lecture([
            meeting(),
            meeting({ pattern: 'F' }),
            meeting({ timeStart: '02:00PM', timeEnd: '02:50PM' }),
            meeting({ facilityDescr: '122' }),
          ]),
        ]),
      ])
    )
    const [section] = (
      await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    ).json.sections
    assert.equal(section.meetings.length, 4)
  })

  it('dedupes every section independently', async () => {
    const m = meeting()
    stubCornell(
      classes([
        cornellClass([
          lecture([m, { ...m }, { ...m }]),
          lecture([m, meeting({ pattern: 'F' })], { section: '002', classNbr: '1002' }),
          lecture([], { section: '003', classNbr: '1003' }),
        ]),
      ])
    )
    const { sections } = (
      await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    ).json
    assert.deepEqual(sections.map((s) => s.meetings.length), [1, 2, 0])
  })

  it('leaves a non-array meetings value untouched and does not throw', async () => {
    // No scraper emits these shapes today, so the cache is seeded directly to
    // exercise the router's `Array.isArray` guard.
    cacheSet(
      cornellSectionsKey('T1', 'S1'),
      [
        { crn: 'null-meetings', meetings: null },
        { crn: 'string-meetings', meetings: 'MWF 09:00-09:50' },
        { crn: 'object-meetings', meetings: { days: ['M'], startTime: '09:00' } },
        { crn: 'no-meetings-key' },
        { crn: 'number-meetings', meetings: 0 },
      ],
      60_000
    )
    const res = await request('/api/course-planner/cornell/sections?term=T1&subject=S1')
    assert.equal(res.status, 200)
    assert.equal(res.json.count, 5)
    assert.deepEqual(res.json.sections, [
      { crn: 'null-meetings', meetings: null },
      { crn: 'string-meetings', meetings: 'MWF 09:00-09:50' },
      { crn: 'object-meetings', meetings: { days: ['M'], startTime: '09:00' } },
      { crn: 'no-meetings-key' },
      { crn: 'number-meetings', meetings: 0 },
    ])
    assert.deepEqual(fetchedUrls, [], 'seeded cache means no network')
  })

  it('dedupes array meetings in the same response that carries non-array ones', async () => {
    const dupe = { days: ['M'], startTime: '09:00', endTime: '09:50', location: 'A' }
    cacheSet(
      cornellSectionsKey('T2', 'S2'),
      [
        { crn: 'bad', meetings: 'not-an-array' },
        { crn: 'good', meetings: [dupe, { ...dupe }, { ...dupe, days: ['W'] }] },
      ],
      60_000
    )
    const { sections } = (
      await request('/api/course-planner/cornell/sections?term=T2&subject=S2')
    ).json
    assert.equal(sections[0].meetings, 'not-an-array')
    assert.equal(sections[1].meetings.length, 2)
  })

  it('drops null entries out of a meetings array', async () => {
    cacheSet(
      cornellSectionsKey('T3', 'S3'),
      [{ crn: 'sparse', meetings: [null, { days: ['M'], startTime: '09:00', endTime: '09:50' }, null] }],
      60_000
    )
    const { sections } = (
      await request('/api/course-planner/cornell/sections?term=T3&subject=S3')
    ).json
    assert.equal(sections[0].meetings.length, 1)
  })

  it('stays correct on a cache hit, where it re-dedupes the mutated cached array', async () => {
    const m = meeting()
    stubCornell(classes([cornellClass([lecture([m, { ...m }, { ...m }])])]))
    const first = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    const second = await request('/api/course-planner/cornell/sections?term=FA26&subject=CS')
    assert.equal(fetchedUrls.length, 1, 'second request should be served from the scraper cache')
    assert.equal(first.json.sections[0].meetings.length, 1)
    assert.equal(second.json.sections[0].meetings.length, 1)
    assert.deepEqual(second.json.sections, first.json.sections)
  })
})

// ── handleError ───────────────────────────────────────────────────────────────

describe('handleError', () => {
  it('always answers 502 with success:false', async () => {
    globalThis.fetch = async () => { throw new Error('socket hang up') }
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.match(res.headers['content-type'], /application\/json/)
    assert.equal(res.json.success, false)
  })

  it('embeds the "<school> <what>" context in the message', async () => {
    const cases = [
      ['/api/course-planner/cornell/terms', 'cornell terms'],
      ['/api/course-planner/cornell/subjects?term=FA26', 'cornell subjects'],
      ['/api/course-planner/cornell/sections?term=FA26&subject=CS', 'cornell sections'],
    ]
    for (const [path, what] of cases) {
      cacheFlush()
      globalThis.fetch = async () => { throw new Error('kaboom') }
      const res = await request(path)
      assert.equal(res.status, 502, path)
      assert.equal(res.json.error, `${what} failed: kaboom`)
    }
  })

  it('logs the same context to console.error with a [course-planner] tag', async () => {
    globalThis.fetch = async () => { throw new Error('kaboom') }
    await request('/api/course-planner/cornell/terms')
    assert.deepEqual(consoleErrors, ['[course-planner] cornell terms failed: kaboom'])
  })

  it('handles a rejection with a plain string instead of an Error', async () => {
    globalThis.fetch = async () => { throw 'upstream exploded' }
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.deepEqual(res.json, {
      success: false,
      error: 'cornell terms failed: upstream exploded',
    })
  })

  it('handles a rejection with null', async () => {
    globalThis.fetch = async () => { throw null }
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.equal(res.json.error, 'cornell terms failed: null')
  })

  it('handles a rejection with undefined', async () => {
    globalThis.fetch = async () => { throw undefined }
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.equal(res.json.error, 'cornell terms failed: undefined')
  })

  it('handles a rejection with a non-Error object carrying no message', async () => {
    globalThis.fetch = async () => { throw { code: 'ECONNRESET' } }
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    assert.equal(res.json.error, 'cornell terms failed: [object Object]')
  })

  it('uses the message even when it is an empty string', async () => {
    globalThis.fetch = async () => { throw new Error('') }
    const res = await request('/api/course-planner/cornell/terms')
    assert.equal(res.status, 502)
    // err?.message is '' (falsy), so String(err) supplies "Error".
    assert.equal(res.json.error, 'cornell terms failed: Error')
  })
})

// ── rate limiter wiring ───────────────────────────────────────────────────────

describe('coursePlannerLimiter wiring', () => {
  it('sets draft-7 RateLimit headers advertising 30 requests per 60s', async () => {
    const res = await request('/api/course-planner/schools')
    assert.equal(res.headers['ratelimit-policy'], '30;w=60')
    assert.match(res.headers['ratelimit'], /^limit=30, remaining=29, reset=\d+$/)
  })

  it('omits the legacy X-RateLimit-* headers', async () => {
    const res = await request('/api/course-planner/schools')
    assert.equal(res.headers['x-ratelimit-limit'], undefined)
    assert.equal(res.headers['x-ratelimit-remaining'], undefined)
    assert.equal(res.headers['x-ratelimit-reset'], undefined)
  })

  it('counts down per client IP', async () => {
    const ip = '203.0.113.20'
    const first = await request('/api/course-planner/schools', { ip })
    const second = await request('/api/course-planner/schools', { ip })
    assert.match(first.headers['ratelimit'], /remaining=29/)
    assert.match(second.headers['ratelimit'], /remaining=28/)
  })

  it('applies to the error paths too, so a 404 still costs a request', async () => {
    for (const path of [
      '/api/course-planner/nope/terms',
      '/api/course-planner/cornell/subjects',
    ]) {
      const res = await request(path)
      assert.equal(res.headers['ratelimit-policy'], '30;w=60', path)
    }
  })

  it('is scoped to /api/course-planner and does not touch other paths', async () => {
    const res = await request('/api/something-else')
    assert.equal(res.status, 404)
    assert.equal(res.headers['ratelimit-policy'], undefined)
    assert.equal(res.headers['ratelimit'], undefined)
  })

  it('429s the 31st request in the window with the structured message', async () => {
    // 31 in-process loopback requests to the cheapest route, on an IP no other
    // test uses, so this stays fast (~25ms) and cannot leak into other tests.
    const ip = '203.0.113.31'
    let last
    for (let i = 0; i < 31; i += 1) {
      last = await request('/api/course-planner/schools', { ip })
      if (i < 30) assert.equal(last.status, 200, `request ${i + 1} should have been allowed`)
    }
    assert.equal(last.status, 429)
    assert.equal(last.json.success, false)
    assert.match(last.json.error, /^Too many requests\s+please wait a moment and try again\.$/)
    assert.ok(last.headers['retry-after'], 'a Retry-After header should be present')
  })

  it('a throttled IP does not throttle a different IP', async () => {
    const hot = '203.0.113.32'
    for (let i = 0; i < 31; i += 1) await request('/api/course-planner/schools', { ip: hot })
    const throttled = await request('/api/course-planner/schools', { ip: hot })
    assert.equal(throttled.status, 429)
    const other = await request('/api/course-planner/schools', { ip: '203.0.113.33' })
    assert.equal(other.status, 200)
  })
})
