/**
 * Data-driven contract test across the WHOLE course-planner school registry.
 *
 * `course-planner-routes.js` keeps a private `SCHOOLS` map (code -> { code,
 * name, enrollmentDataAvailable, scraper }). It is not exported, so this file
 * reads the router source, reconstructs the registry statically, and then
 * dynamically imports every scraper module it names. That gives one cheap test
 * that protects all ~80 schools at once:
 *
 *   - registry key === entry.code   (a mismatch 404s a school the UI lists)
 *   - name is a non-empty string; enrollmentDataAvailable is strictly boolean
 *   - every scraper module exports getTerms / getSubjects / getSections
 *   - no duplicate codes, no duplicate display names
 *   - every *-scraper.js on disk is actually registered (no orphans)
 *   - each scraper tags its sections with its OWN school code
 *   - engine config keys passed by a school are keys the engine destructures
 *     (a typo'd / obsolete flag is silently ignored at runtime, which is how a
 *     school quietly breaks)
 *   - no scraper trims terms itself: the current+next window and the uniform
 *     "Season YYYY" labels are applied centrally at the /terms route via
 *     course-planner/term-window.js
 *
 * Nothing here touches the network: only source parsing plus module imports of
 * side-effect-free factory wrappers.
 */
import assert from 'node:assert'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(here, '..')
const plannerDir = path.join(serverDir, 'course-planner')
const routesSrc = fs.readFileSync(path.join(serverDir, 'course-planner-routes.js'), 'utf8')

// ── static parse of the router ────────────────────────────────────────────────

/** alias -> './course-planner/x-scraper.js' */
const importsByAlias = new Map()
for (const m of routesSrc.matchAll(
  /^import \* as (\w+) from '(\.\/course-planner\/[\w.-]+\.js)'/gm
)) {
  importsByAlias.set(m[1], m[2])
}

const registryBody = routesSrc.match(/\nconst SCHOOLS = \{\n([\s\S]*?)\n\}\n/)
assert.ok(registryBody, 'could not locate the SCHOOLS registry in course-planner-routes.js')

/** One entry per `key: { ... },` block at two-space indentation. */
const entries = []
for (const m of registryBody[1].matchAll(/^ {2}([A-Za-z0-9_]+): \{\n([\s\S]*?)^ {2}\},$/gm)) {
  const [, key, inner] = m
  const field = (name) => {
    const hit = inner.match(new RegExp('^ {4}' + name + ': (.+),$', 'm'))
    return hit ? hit[1] : undefined
  }
  entries.push({
    key,
    codeLiteral: field('code'),
    nameLiteral: field('name'),
    enrollmentLiteral: field('enrollmentDataAvailable'),
    scraperAlias: field('scraper'),
  })
}

/** Strip the surrounding quotes off a JS string literal (both quote styles). */
function unquote(literal) {
  if (typeof literal !== 'string') return undefined
  const m = literal.match(/^'([\s\S]*)'$/) || literal.match(/^"([\s\S]*)"$/)
  return m ? m[1] : undefined
}

// ── load every scraper module the registry names ──────────────────────────────

const moduleByAlias = new Map()
for (const [alias, rel] of importsByAlias) {
  const abs = path.join(serverDir, rel)
  moduleByAlias.set(alias, await import(pathToFileURL(abs).href))
}

const scraperFiles = fs
  .readdirSync(plannerDir)
  .filter((f) => f.endsWith('-scraper.js'))
  .sort()

const sourceByFile = new Map(
  scraperFiles.map((f) => [f, fs.readFileSync(path.join(plannerDir, f), 'utf8')])
)

// ── registry shape ────────────────────────────────────────────────────────────

describe('SCHOOLS registry shape', () => {
  it('parses a plausible number of schools', () => {
    assert.ok(entries.length >= 80, `only parsed ${entries.length} registry entries`)
    assert.equal(entries.length, importsByAlias.size)
  })

  it('registry key equals the entry code for every school', () => {
    const mismatched = entries
      .filter((e) => unquote(e.codeLiteral) !== e.key)
      .map((e) => `${e.key} -> ${e.codeLiteral}`)
    assert.deepEqual(mismatched, [], 'key/code mismatch would 404 a school the UI lists')
  })

  it('every school has a non-empty string name', () => {
    for (const e of entries) {
      const name = unquote(e.nameLiteral)
      assert.equal(typeof name, 'string', `${e.key}: name is not a string literal`)
      assert.ok(name.trim().length > 0, `${e.key}: name is empty`)
    }
  })

  it('enrollmentDataAvailable is strictly a boolean literal', () => {
    for (const e of entries) {
      assert.ok(
        e.enrollmentLiteral === 'true' || e.enrollmentLiteral === 'false',
        `${e.key}: enrollmentDataAvailable is ${e.enrollmentLiteral}, not true/false`
      )
    }
  })

  it('has no duplicate school codes', () => {
    const codes = entries.map((e) => e.key)
    assert.equal(new Set(codes).size, codes.length)
  })

  it('has no duplicate school names', () => {
    const names = entries.map((e) => unquote(e.nameLiteral))
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    assert.deepEqual(dupes, [], 'two schools sharing a display name are indistinguishable in the UI')
  })

  it('registers every *-scraper.js module on disk (no orphans)', () => {
    const registered = new Set(
      entries.map((e) => path.basename(importsByAlias.get(e.scraperAlias) || ''))
    )
    const orphans = scraperFiles.filter((f) => !registered.has(f))
    assert.deepEqual(orphans, [], 'scraper files that no school entry points at')
  })
})

// ── the three-function contract ───────────────────────────────────────────────

describe('scraper contract (getTerms / getSubjects / getSections)', () => {
  for (const e of entries) {
    it(`${e.key} exports all three contract functions`, () => {
      const mod = moduleByAlias.get(e.scraperAlias)
      assert.ok(mod, `${e.key}: scraper alias ${e.scraperAlias} has no matching import`)
      for (const fn of ['getTerms', 'getSubjects', 'getSections']) {
        assert.equal(typeof mod[fn], 'function', `${e.key}: ${fn} is not a function`)
      }
    })
  }
})

describe('scraper school tagging', () => {
  it('every scraper tags its rows with its own registry code', () => {
    const wrong = []
    for (const e of entries) {
      const file = path.basename(importsByAlias.get(e.scraperAlias) || '')
      const src = sourceByFile.get(file)
      if (!src) continue
      const ids = new Set()
      for (const m of src.matchAll(/^\s*school: '([\w-]+)',?$/gm)) ids.add(m[1])
      for (const m of src.matchAll(/school: '([\w-]+)'[,}]/g)) ids.add(m[1])
      for (const m of src.matchAll(/^const SCHOOL = '([\w-]+)'$/gm)) ids.add(m[1])
      for (const id of ids) if (id !== e.key) wrong.push(`${file}: school '${id}' != code '${e.key}'`)
    }
    assert.deepEqual(wrong, [], 'a mis-tagged section breaks the client-side school keying')
  })
})

// ── engine configuration sanity ───────────────────────────────────────────────

/** Option names a factory actually destructures, read from its own source. */
function factoryOptions(file, factoryName) {
  const src = fs.readFileSync(path.join(plannerDir, file), 'utf8')
  const m = src.match(new RegExp('export function ' + factoryName + '\\(\\{([\\s\\S]*?)\\}\\)'))
  assert.ok(m, `could not read the option list of ${factoryName} in ${file}`)
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim().split('=')[0].trim())
      .filter(Boolean)
  )
}

const ENGINES = {
  createBannerScraper: { file: 'banner-ssb.js', label: 'Banner 9 SSB' },
  createBannerClassicScraper: { file: 'banner-classic.js', label: 'Banner 8 classic' },
  createColleagueScraper: { file: 'colleague.js', label: 'Ellucian Colleague' },
  createFoseScraper: { file: 'fose.js', label: 'CourseLeaf FOSE' },
  createPeopleSoftScraper: { file: 'peoplesoft.js', label: 'PeopleSoft' },
  createUhSystemScraper: { file: 'peoplesoft-uh.js', label: 'UH-system PeopleSoft' },
}

/** Every `createXScraper({ ... })` call site across the school scrapers. */
const callSites = []
for (const [file, src] of sourceByFile) {
  for (const m of src.matchAll(/(create\w*Scraper)\(\{([\s\S]*?)\}\)/g)) {
    const keys = [...m[2].matchAll(/(?:^|[{,])\s*([A-Za-z_]\w*):/g)].map((k) => k[1])
    callSites.push({ file, factory: m[1], body: m[2], keys })
  }
}

describe('engine configuration', () => {
  it('finds the expected engine call sites', () => {
    assert.ok(callSites.length >= 40, `only found ${callSites.length} engine call sites`)
    const unknown = [...new Set(callSites.map((c) => c.factory))].filter((f) => !ENGINES[f])
    assert.deepEqual(unknown, [], 'unrecognised scraper factory — add it to ENGINES')
  })

  it('passes only option keys the engine destructures', () => {
    const bad = []
    for (const site of callSites) {
      const allowed = factoryOptions(ENGINES[site.factory].file, site.factory)
      for (const key of site.keys) {
        if (!allowed.has(key)) bad.push(`${site.file}: ${site.factory} ignores '${key}'`)
      }
    }
    assert.deepEqual(bad, [], 'a config key the engine does not read is silently dropped')
  })

  it('requires school plus the engine-specific scoping keys on every call site', () => {
    for (const site of callSites) {
      assert.ok(site.keys.includes('school'), `${site.file}: missing school`)
      if (site.factory === 'createUhSystemScraper') {
        // The UH-system component URL is hardcoded in the engine; the campus is
        // selected purely by institution code, so that key is mandatory.
        assert.ok(site.keys.includes('institution'), `${site.file}: missing institution`)
        continue
      }
      assert.ok(
        site.keys.includes('base') || site.keys.includes('url'),
        `${site.file}: missing base/url`
      )
      if (site.factory === 'createBannerClassicScraper') {
        assert.ok(site.keys.includes('prefix'), `${site.file}: missing mod_plsql prefix`)
      }
    }
  })

  it('points every engine at an https host', () => {
    const insecure = []
    for (const site of callSites) {
      for (const m of site.body.matchAll(/(?:base|url): '([^']+)'/g)) {
        if (!m[1].startsWith('https://')) insecure.push(`${site.file}: ${m[1]}`)
      }
    }
    assert.deepEqual(insecure, [], 'course-planner scrapers must speak https')
  })

  it('gives every engine-backed school a distinct host+scope', () => {
    // Shared instances (SDBOR, Alaska, UH-system) are legitimate; what must
    // differ is the scoping option that picks the campus.
    const seen = new Map()
    for (const site of callSites) {
      const target =
        (site.body.match(/(?:base|url): '([^']+)'/) || [])[1] || ENGINES[site.factory].label
      const scope = [
        (site.body.match(/mepCode: '([^']+)'/) || [])[1],
        (site.body.match(/campus: '([^']+)'/) || [])[1],
        (site.body.match(/campusRe: ([^,\n]+)/) || [])[1],
        (site.body.match(/institution: '([^']+)'/) || [])[1],
        (site.body.match(/prefix: '([^']+)'/) || [])[1],
      ].join('|')
      const key = `${site.factory}::${target}::${scope}`
      assert.ok(
        !seen.has(key),
        `${site.file} and ${seen.get(key)} resolve to the same catalog scope (${key})`
      )
      seen.set(key, site.file)
    }
  })
})

describe('Colleague engine wiring', () => {
  const colleagueSites = callSites.filter((c) => c.factory === 'createColleagueScraper')

  it('registers the Colleague schools this build ships', () => {
    // Project notes list TWU / Dallas College / TCC / McLennan / Southwestern /
    // Hardin-Simmons as the Colleague cohort, with the last four needing a
    // `legacyApi: true` flag. Only TWU is present in this tree, and neither
    // colleague.js nor any call site knows a `legacyApi` option — so there is
    // no flag to get wrong here. Pin that so re-adding those schools without
    // re-adding the engine support fails loudly.
    assert.deepEqual(
      colleagueSites.map((c) => c.file).sort(),
      ['twu-scraper.js']
    )
  })

  it('has no orphaned legacyApi flag anywhere in the engine or its call sites', () => {
    const colleagueSrc = fs.readFileSync(path.join(plannerDir, 'colleague.js'), 'utf8')
    const engineKnowsFlag = /legacyApi/.test(colleagueSrc)
    const callersPassFlag = colleagueSites.filter((c) => c.keys.includes('legacyApi'))
    assert.equal(
      engineKnowsFlag,
      callersPassFlag.length > 0,
      'legacyApi must be understood by colleague.js exactly when a school passes it'
    )
  })

  it('passes a full config for every Colleague school', () => {
    for (const site of colleagueSites) {
      assert.ok(site.keys.includes('school'), `${site.file}: missing school`)
      assert.ok(site.keys.includes('base'), `${site.file}: missing base`)
    }
  })
})

// ── the central term-window rule ──────────────────────────────────────────────

describe('central term window is not duplicated in scrapers', () => {
  it('no scraper imports term-window.js', () => {
    const offenders = [...sourceByFile]
      .filter(([, src]) => /from '\.\/term-window\.js'/.test(src))
      .map(([f]) => f)
    assert.deepEqual(
      offenders,
      [],
      'terms are trimmed + relabelled once, at the /terms route (see term-window.js)'
    )
  })

  it('the /terms route is the only place selectCurrentAndNextTerms is called', () => {
    assert.ok(routesSrc.includes('selectCurrentAndNextTerms(await entry.scraper.getTerms())'))
    const offenders = [...sourceByFile]
      .filter(([, src]) => src.includes('selectCurrentAndNextTerms'))
      .map(([f]) => f)
    assert.deepEqual(offenders, [])
  })

  it('pins the scrapers that post-process their own term list', () => {
    // These wrap the engine's getTerms to drop *label noise* (Law / medical /
    // trimester / view-only cohorts) whose labels normalise to the same
    // "Season YYYY" as the real semester and would shadow it in the term-window
    // dedup. They filter by label pattern only — they never trim to a window,
    // never rewrite labels, and never slice the list. Any NEW entry here needs
    // the same review, which is why the set is pinned.
    const overriding = [...sourceByFile]
      .filter(([, src]) => /export async function getTerms\(\)[\s\S]*?(impl|scraper)\.getTerms\(\)/.test(src))
      .map(([f]) => f)
      .sort()
    assert.deepEqual(overriding, [
      'baylor-scraper.js',
      'gatech-scraper.js',
      'hawaii-scraper.js',
      'neu-scraper.js',
      'umontana-scraper.js',
      'unm-scraper.js',
      'utrgv-scraper.js',
    ])
    for (const file of overriding) {
      const src = sourceByFile.get(file)
      const override = src.slice(src.indexOf('export async function getTerms()'))
      assert.ok(/\.filter\(/.test(override), `${file}: term override should be a filter`)
      assert.ok(!/\.slice\(/.test(override), `${file}: term override must not slice the list`)
      assert.ok(
        !/label:\s*[`'"]/.test(override),
        `${file}: term override must not rewrite labels (term-window.js owns labels)`
      )
    }
  })

  it('pins the scrapers that synthesise term codes from the current year', () => {
    // Three upstreams publish no term list at all, so these build candidate
    // codes for the current + next calendar YEAR and probe them. That is a
    // superset handed to term-window.js, not a current+next trim, so it does
    // not violate the central rule — but it is date-dependent code, so pin it.
    const yearMath = [...sourceByFile]
      .filter(([, src]) => src.includes('new Date().getFullYear()'))
      .map(([f]) => f)
      .sort()
    assert.deepEqual(yearMath, [
      'rutgers-scraper.js',
      'uiuc-scraper.js',
      'utah-scraper.js',
    ])
    for (const file of yearMath) {
      const src = sourceByFile.get(file)
      assert.ok(
        /year \+ 1|y \+ 1/.test(src),
        `${file}: year math must reach into next year, not pin to the current one`
      )
    }
  })
})
