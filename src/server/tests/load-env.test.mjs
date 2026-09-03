/**
 * Tests for src/server/load-env.js.
 *
 * The module has no exports: it parses `.env` / `.env.local` next to itself and
 * (in packaged builds) `env.generated.js`, then merges the results into
 * process.env at import time. `parseEnvFile` and `applyMerged` are private, so
 * they are exercised the only way that does not require changing production
 * code: a byte-for-byte COPY of the real file is dropped into a throwaway
 * temp directory alongside fixture .env files, and imported from there.
 * `__dirname` inside the copy then resolves to that directory, so every test
 * gets a clean, isolated environment.
 *
 * The copy is made from the live source on every run (fs.copyFileSync), so it
 * cannot drift from the module under test.
 *
 * The behaviour that matters most is the PRECEDENCE the module documents:
 *
 *     platform env  >  .env.local  >  .env  >  baked env.generated.js
 *
 * `applyMerged` only writes keys that are currently `undefined`, which is what
 * produces that ordering. Getting it backwards would let a stale baked
 * credential shadow a real deployment secret, so it is asserted directly.
 */
import assert from 'node:assert'
import { describe, it, before, after, afterEach } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const REAL_MODULE = path.resolve(here, '..', 'load-env.js')

/**
 * Temp root for the sandboxed copies. os.tmpdir() (not the repo, and not a
 * machine-specific path) keeps this runnable anywhere, including CI.
 */
let root
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plannr-load-env-'))
})
after(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/** Keys this file wrote into process.env, cleaned up after every test. */
const touched = new Set()
afterEach(() => {
  for (const key of touched) delete process.env[key]
  touched.clear()
})

let caseId = 0

/**
 * Build a sandbox holding a verbatim copy of load-env.js plus the requested
 * fixture files, import it, and return a reader for the keys it should have set.
 */
async function loadEnvSandbox({ env, envLocal, baked, preset = {} } = {}) {
  const dir = path.join(root, `case-${++caseId}`)
  fs.mkdirSync(dir)
  // The repo declares type:module in src/server/package.json; without the same
  // declaration Node would load the copied .js files as CommonJS.
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  fs.copyFileSync(REAL_MODULE, path.join(dir, 'load-env.js'))
  if (env !== undefined) fs.writeFileSync(path.join(dir, '.env'), env)
  if (envLocal !== undefined) fs.writeFileSync(path.join(dir, '.env.local'), envLocal)
  if (baked !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'env.generated.js'),
      `export const bakedEnv = ${JSON.stringify(baked, null, 2)}\n`
    )
  }
  for (const [k, v] of Object.entries(preset)) {
    touched.add(k)
    process.env[k] = v
  }
  await import(pathToFileURL(path.join(dir, 'load-env.js')).href)
  return (key) => {
    touched.add(key)
    return process.env[key]
  }
}

/** Unique key names so concurrent-ish cases can never collide. */
const K = (name) => `PLNR_LOADENV_${caseId + 1}_${name}`

// ── the copy is faithful ──────────────────────────────────────────────────────

describe('load-env sandbox fidelity', () => {
  it('copies the real module byte-for-byte', async () => {
    const dir = path.join(root, 'fidelity')
    fs.mkdirSync(dir)
    fs.copyFileSync(REAL_MODULE, path.join(dir, 'load-env.js'))
    assert.deepEqual(fs.readFileSync(path.join(dir, 'load-env.js')), fs.readFileSync(REAL_MODULE))
  })
})

// ── parseEnvFile ──────────────────────────────────────────────────────────────

describe('parseEnvFile', () => {
  it('returns {} for a missing file (no throw, nothing set)', async () => {
    const key = K('MISSING')
    const get = await loadEnvSandbox({})
    assert.equal(get(key), undefined)
  })

  it('ignores comments and blank lines', async () => {
    const a = K('A')
    const b = K('B')
    const get = await loadEnvSandbox({
      env: ['# a leading comment', '', '   ', `${a}=one`, '# another comment', `${b}=two`, ''].join('\n'),
    })
    assert.equal(get(a), 'one')
    assert.equal(get(b), 'two')
  })

  it('keeps "=" characters inside the value', async () => {
    const key = K('URL')
    const get = await loadEnvSandbox({ env: `${key}=https://h/x?a=b&c==d` })
    assert.equal(get(key), 'https://h/x?a=b&c==d')
  })

  it('does not treat a trailing "#" as an inline comment', async () => {
    const key = K('HASH')
    const get = await loadEnvSandbox({ env: `${key}=value # not a comment` })
    assert.equal(get(key), 'value # not a comment')
  })

  it('trims whitespace around the key and the value', async () => {
    const key = K('PADDED')
    const get = await loadEnvSandbox({ env: `  ${key}   =   spaced   ` })
    assert.equal(get(key), 'spaced')
  })

  it('unwraps double quotes and expands escaped newlines and quotes', async () => {
    const nl = K('PEM')
    const qt = K('QUOTED')
    const get = await loadEnvSandbox({
      env: [`${nl}="line1\\nline2\\nline3"`, `${qt}="say \\"hi\\""`].join('\n'),
    })
    assert.equal(get(nl), 'line1\nline2\nline3')
    assert.equal(get(qt), 'say "hi"')
  })

  it('unwraps single quotes and expands their escapes', async () => {
    const key = K('SINGLE')
    const apo = K('APOS')
    const get = await loadEnvSandbox({
      env: [`${key}='hello world'`, `${apo}='it\\'s fine'`].join('\n'),
    })
    assert.equal(get(key), 'hello world')
    assert.equal(get(apo), "it's fine")
  })

  it('leaves an unterminated quote alone', async () => {
    const key = K('UNTERMINATED')
    const get = await loadEnvSandbox({ env: `${key}="abc` })
    assert.equal(get(key), '"abc')
  })

  it('does not expand escapes in an unquoted value', async () => {
    const key = K('RAW')
    const get = await loadEnvSandbox({ env: `${key}=a\\nb` })
    assert.equal(get(key), 'a\\nb')
  })

  it('skips invalid key names', async () => {
    const ok = K('VALID_KEY9')
    const get = await loadEnvSandbox({
      env: [
        '1STARTS_WITH_DIGIT=x',
        'HAS-DASH=x',
        'HAS SPACE=x',
        'HAS.DOT=x',
        `${ok}=kept`,
      ].join('\n'),
    })
    assert.equal(get(ok), 'kept')
    for (const bad of ['1STARTS_WITH_DIGIT', 'HAS-DASH', 'HAS SPACE', 'HAS.DOT']) {
      touched.add(bad)
      assert.equal(process.env[bad], undefined, `${bad} should have been skipped`)
    }
  })

  it('skips lines with no "=" and lines that start with "="', async () => {
    const ok = K('AFTER_JUNK')
    const get = await loadEnvSandbox({
      env: ['JUST_A_WORD', '=leading-equals', `${ok}=kept`].join('\n'),
    })
    assert.equal(get(ok), 'kept')
    touched.add('JUST_A_WORD')
    assert.equal(process.env.JUST_A_WORD, undefined)
  })

  it('accepts CRLF line endings', async () => {
    const a = K('CRLF_A')
    const b = K('CRLF_B')
    const get = await loadEnvSandbox({ env: `${a}=one\r\n${b}=two\r\n` })
    assert.equal(get(a), 'one')
    assert.equal(get(b), 'two')
  })

  it('accepts an empty value', async () => {
    const key = K('EMPTY')
    const get = await loadEnvSandbox({ env: `${key}=` })
    assert.equal(get(key), '')
  })
})

// ── precedence ────────────────────────────────────────────────────────────────

describe('precedence: platform env > .env.local > .env > baked', () => {
  it('.env.local beats .env', async () => {
    const key = K('OVERRIDDEN')
    const get = await loadEnvSandbox({ env: `${key}=from-env`, envLocal: `${key}=from-local` })
    assert.equal(get(key), 'from-local')
  })

  it('.env still supplies keys .env.local does not mention', async () => {
    const only = K('ONLY_IN_ENV')
    const both = K('IN_BOTH')
    const get = await loadEnvSandbox({
      env: `${only}=base-value\n${both}=from-env`,
      envLocal: `${both}=from-local`,
    })
    assert.equal(get(only), 'base-value')
    assert.equal(get(both), 'from-local')
  })

  it('an already-present platform variable wins over both files', async () => {
    const key = K('PLATFORM')
    const get = await loadEnvSandbox({
      env: `${key}=from-env`,
      envLocal: `${key}=from-local`,
      preset: { [`PLNR_LOADENV_${caseId + 1}_PLATFORM`]: 'from-platform' },
    })
    assert.equal(get(key), 'from-platform')
  })

  it('an empty-string platform variable is still "present" and is not overwritten', async () => {
    const key = K('PRESENT_EMPTY')
    const get = await loadEnvSandbox({
      env: `${key}=from-env`,
      preset: { [`PLNR_LOADENV_${caseId + 1}_PRESENT_EMPTY`]: '' },
    })
    assert.equal(get(key), '', 'only `undefined` keys may be filled in')
  })

  it('baked env.generated.js fills keys nobody else set', async () => {
    const key = K('BAKED_ONLY')
    const get = await loadEnvSandbox({ baked: { [`PLNR_LOADENV_${caseId + 1}_BAKED_ONLY`]: 'baked' } })
    assert.equal(get(key), 'baked')
  })

  it('baked credentials NEVER override a .env value', async () => {
    const key = K('BAKED_VS_ENV')
    const name = `PLNR_LOADENV_${caseId + 1}_BAKED_VS_ENV`
    const get = await loadEnvSandbox({ env: `${name}=from-env`, baked: { [name]: 'stale-baked' } })
    assert.equal(get(key), 'from-env')
  })

  it('baked credentials NEVER override a .env.local value', async () => {
    const key = K('BAKED_VS_LOCAL')
    const name = `PLNR_LOADENV_${caseId + 1}_BAKED_VS_LOCAL`
    const get = await loadEnvSandbox({ envLocal: `${name}=from-local`, baked: { [name]: 'stale-baked' } })
    assert.equal(get(key), 'from-local')
  })

  it('baked credentials NEVER override a real deployment secret', async () => {
    // The regression this guards: a packaged Electron build's baked anon key
    // shadowing the platform-injected key on Render / Vercel.
    const key = K('BAKED_VS_PLATFORM')
    const name = `PLNR_LOADENV_${caseId + 1}_BAKED_VS_PLATFORM`
    const get = await loadEnvSandbox({
      baked: { [name]: 'stale-baked' },
      preset: { [name]: 'real-deployment-secret' },
    })
    assert.equal(get(key), 'real-deployment-secret')
  })

  it('applies the whole chain in one pass', async () => {
    const n = caseId + 1
    const platform = `PLNR_LOADENV_${n}_CHAIN_PLATFORM`
    const local = `PLNR_LOADENV_${n}_CHAIN_LOCAL`
    const base = `PLNR_LOADENV_${n}_CHAIN_ENV`
    const baked = `PLNR_LOADENV_${n}_CHAIN_BAKED`
    const get = await loadEnvSandbox({
      env: [`${platform}=env`, `${local}=env`, `${base}=env`, `${baked}=env`].join('\n'),
      envLocal: [`${platform}=local`, `${local}=local`].join('\n'),
      baked: { [platform]: 'baked', [local]: 'baked', [base]: 'baked', [baked]: 'baked' },
      preset: { [platform]: 'platform' },
    })
    assert.equal(get(platform), 'platform')
    assert.equal(get(local), 'local')
    assert.equal(get(base), 'env')
    assert.equal(get(baked), 'env')
  })

  it('works with no files at all (packaged build with nothing baked)', async () => {
    const key = K('NOTHING')
    const get = await loadEnvSandbox({})
    assert.equal(get(key), undefined)
  })
})
