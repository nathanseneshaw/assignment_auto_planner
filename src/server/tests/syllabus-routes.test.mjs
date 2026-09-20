/**
 * Unit tests for the Syllabus Parser router.
 *
 * The router is driven over a REAL loopback HTTP server (express + multer +
 * express-rate-limit all behave differently when short-circuited), but nothing
 * leaves the process:
 *
 *  - Supabase: `globalThis.fetch` is stubbed, which intercepts both GoTrue
 *    (/auth/v1/user) and PostgREST (/rest/v1/...). The test client keeps a
 *    reference to the real fetch captured before the stub is installed.
 *  - Anthropic: `Anthropic.Messages.prototype.create` is stubbed on the class
 *    the module under test imports, so no API call is made.
 *  - Fixtures: a real .docx is synthesized with jszip (a mammoth dependency).
 *
 * SUPABASE_URL / SUPABASE_ANON_KEY are read at import time by supabase-auth.js,
 * so they are set before the dynamic import of the router below.
 *
 * The rate limiters are module-level singletons shared across this whole file,
 * so each test uses its own user id (`nextUser()`) to get a fresh bucket.
 */
import assert from 'node:assert'
import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import { once } from 'node:events'
import express from 'express'
import JSZip from 'jszip'
import Anthropic from '@anthropic-ai/sdk'

// Capture the real fetch before anything stubs globalThis.fetch: the test
// client and the code under test would otherwise share one implementation.
const realFetch = globalThis.fetch.bind(globalThis)

process.env.SUPABASE_URL = 'https://fake-project.supabase.co'
process.env.SUPABASE_ANON_KEY = 'anon-test-key'
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

const { default: syllabusRouter, _internal } = await import('../syllabus-routes.js')
const { parseDueAt, clip, nowIso } = _internal

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const COURSE_NAME_MAX = 200
const ASSIGNMENT_NAME_MAX = 300
const DESCRIPTION_MAX = 4000

// ---------------------------------------------------------------------------
// server + client plumbing
// ---------------------------------------------------------------------------

let server
let base

before(async () => {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use(syllabusRouter)
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

let userSeq = 0
const nextUser = () => `route-user-${++userSeq}`

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

/** A well-formed (unsigned) JWT whose `sub` is the user id the stub will return. */
function bearerFor(userId) {
  const payload = { sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 }
  return `Bearer ${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`
}

async function post(path, { auth, json, form, headers = {} } = {}) {
  const init = { method: 'POST', headers: { ...headers } }
  if (auth) init.headers.Authorization = auth
  if (form) init.body = form
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(json)
  }
  const res = await realFetch(`${base}${path}`, init)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = undefined }
  return { status: res.status, body, text, headers: res.headers }
}

// ---------------------------------------------------------------------------
// supabase stub
// ---------------------------------------------------------------------------

let savedFetch
let savedCreate

beforeEach(() => {
  savedFetch = globalThis.fetch
  savedCreate = Anthropic.Messages.prototype.create
})
afterEach(() => {
  globalThis.fetch = savedFetch
  Anthropic.Messages.prototype.create = savedCreate
})

const jsonRes = (body, status = 200) =>
  new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/**
 * Stub GoTrue + PostgREST.
 * `courses` / `assignments` may be a value (returned as a 200 body) or
 * `{ status, body }` to simulate a PostgREST error.
 */
function stubSupabase({ courses = { id: 'course-abc' }, assignments = [{ id: 'a1' }] } = {}) {
  const calls = []
  const reply = (spec) => {
    if (spec && typeof spec === 'object' && 'status' in spec && 'body' in spec) {
      return jsonRes(spec.body, spec.status)
    }
    return jsonRes(spec)
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    const headers = new Headers(init.headers || {})
    const bodyText = typeof init.body === 'string' ? init.body : undefined
    const record = {
      url,
      method: init.method || 'GET',
      authorization: headers.get('authorization'),
      accept: headers.get('accept'),
      body: bodyText ? JSON.parse(bodyText) : undefined,
    }
    calls.push(record)

    if (url.includes('/auth/v1/user')) {
      // Echo back the `sub` from the caller's JWT so req.user.id is the real
      // authenticated identity, not something the request body chose.
      const token = (record.authorization || '').slice(7)
      let sub = 'unknown-user'
      try { sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub } catch { /* opaque token */ }
      return jsonRes({ id: sub, email: `${sub}@example.edu`, aud: 'authenticated' })
    }
    if (url.includes('/rest/v1/courses')) return reply(courses)
    if (url.includes('/rest/v1/assignments')) return reply(assignments)
    return jsonRes([])
  }

  calls.courses = () => calls.filter((c) => c.url.includes('/rest/v1/courses'))
  calls.assignments = () => calls.filter((c) => c.url.includes('/rest/v1/assignments'))
  return calls
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

async function makeDocx(paragraphs) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const SYLLABUS_PARAGRAPHS = [
  'CS 3340 Introduction to Algorithms',
  'Fall 2026 - Professor Ada Lovelace',
  'Problem Set 1 due September 5 2026 at 11:59pm',
  'Midterm Exam October 14 2026 in class',
]

let docxFixture
before(async () => { docxFixture = await makeDocx(SYLLABUS_PARAGRAPHS) })

function fileForm(buf, { field = 'file', name = 'syllabus.docx', type = DOCX_MIME } = {}) {
  const fd = new FormData()
  fd.append(field, new Blob([buf], { type }), name)
  return fd
}

const CLAUDE_DRAFT = {
  course: { name: 'Introduction to Algorithms', code: 'CS 3340', term: 'Fall 2026', instructor: 'Ada Lovelace' },
  assignments: [
    { name: 'Problem Set 1', dueAt: '2026-09-05T23:59:00', description: null },
    { name: 'Midterm Exam', dueAt: '2026-10-14T23:59:00', description: null },
  ],
}

function stubClaude(result = CLAUDE_DRAFT) {
  Anthropic.Messages.prototype.create = async () => ({
    content: [{ type: 'tool_use', name: 'submit_syllabus', input: result }],
  })
}

function stubClaudeError(err) {
  Anthropic.Messages.prototype.create = async () => { throw err }
}

// ===========================================================================
// parseDueAt
// ===========================================================================

describe('parseDueAt', () => {
  it('returns null for the three "no date" inputs', () => {
    assert.equal(parseDueAt(null), null)
    assert.equal(parseDueAt(undefined), null)
    assert.equal(parseDueAt(''), null)
  })

  it('normalizes a full ISO 8601 instant to a UTC ISO string', () => {
    assert.equal(parseDueAt('2026-09-05T23:59:00.000Z'), '2026-09-05T23:59:00.000Z')
    assert.equal(parseDueAt('2026-09-05T23:59:00Z'), '2026-09-05T23:59:00.000Z')
    // An explicit offset is converted, not preserved.
    assert.equal(parseDueAt('2026-09-05T18:59:00-05:00'), '2026-09-05T23:59:00.000Z')
  })

  it('treats a date-only string as UTC midnight', () => {
    assert.equal(parseDueAt('2026-09-05'), '2026-09-05T00:00:00.000Z')
  })

  it('treats a naive datetime (no zone) as server-local time', () => {
    // This is what Claude emits, so it is worth pinning: the result is the same
    // instant Date would produce locally, re-expressed in UTC.
    const naive = '2026-09-05T23:59:00'
    assert.equal(parseDueAt(naive), new Date(naive).toISOString())
  })

  it('accepts a Date instance and a numeric epoch', () => {
    const d = new Date('2026-09-05T23:59:00.000Z')
    assert.equal(parseDueAt(d), '2026-09-05T23:59:00.000Z')
    assert.equal(parseDueAt(0), '1970-01-01T00:00:00.000Z')
  })

  it('throws a descriptive error for unparseable input', () => {
    for (const bad of ['not a date', 'tomorrow', '??', 'TBD', {}, []]) {
      assert.throws(
        () => parseDueAt(bad),
        /Invalid due date .* must be a parseable ISO 8601 string or null/,
        `expected a throw for ${JSON.stringify(bad)}`
      )
    }
  })

  it('throws for calendar values that are out of range', () => {
    for (const bad of ['2026-13-01', '2026-09-05T25:00:00Z', '0000-00-00', '2026-09-32']) {
      assert.throws(() => parseDueAt(bad), /Invalid due date/, `expected a throw for ${bad}`)
    }
  })

  it('KNOWN GAP: an impossible day-of-month silently rolls over instead of failing', () => {
    // parseDueAt delegates to `new Date()`, and V8 rolls Feb 30 forward rather
    // than reporting it as invalid. Pinned so a future stricter parser is a
    // deliberate change, not an accident.
    assert.equal(parseDueAt('2026-02-30T00:00:00Z'), '2026-03-02T00:00:00.000Z')
  })

  it('KNOWN GAP: V8 legacy date parsing accepts prose and invents the year 2001', () => {
    // A user hand-editing a due date in the review UI to "Sept 5" is silently
    // saved as the year 2001 rather than rejected with a 400.
    assert.equal(parseDueAt('Sept 5'), new Date('Sept 5').toISOString())
    assert.match(parseDueAt('Sept 5'), /^2001-09-05/)
    assert.match(parseDueAt('week 4'), /^2001-04-01/)
    // Most free text is still rejected, which is why this is a gap and not a
    // wholesale absence of validation.
    for (const rejected of ['tomorrow', 'TBD', 'Week 4 Friday', 'Q1', 'due later']) {
      assert.throws(() => parseDueAt(rejected), /Invalid due date/, `expected a throw for ${rejected}`)
    }
  })

  it('throws for timestamps beyond the representable Date range', () => {
    // +275760-09-13 is the maximum ECMAScript date; one day later is invalid.
    assert.equal(parseDueAt('+275760-09-13T00:00:00.000Z'), '+275760-09-13T00:00:00.000Z')
    assert.throws(() => parseDueAt('+275760-09-14T00:00:00.000Z'), /Invalid due date/)
    assert.throws(() => parseDueAt(8.64e15 + 1), /Invalid due date/)
  })

  it('includes the offending value in the error message', () => {
    assert.throws(() => parseDueAt('not a date'), /Invalid due date "not a date"/)
  })
})

// ===========================================================================
// clip
// ===========================================================================

describe('clip', () => {
  it('maps empty-ish input to null', () => {
    assert.equal(clip(null, 10), null)
    assert.equal(clip(undefined, 10), null)
    assert.equal(clip('', 10), null)
    assert.equal(clip('   ', 10), null)
    assert.equal(clip('\n\t ', 10), null)
  })

  it('trims before measuring, and leaves short values untouched', () => {
    assert.equal(clip('  hello  ', 10), 'hello')
    assert.equal(clip('hello', 5), 'hello')
  })

  it('is exact at the boundary: max passes through, max+1 truncates', () => {
    const at = 'a'.repeat(10)
    const over = 'a'.repeat(11)
    assert.equal(clip(at, 10), at)
    assert.equal(clip(at, 10).length, 10)
    assert.equal(clip(over, 10).length, 10)
    assert.equal(clip(over, 10), at)
    assert.equal(clip('a'.repeat(9), 10).length, 9)
  })

  it('measures AFTER trimming, so surrounding whitespace does not count', () => {
    const padded = `   ${'a'.repeat(10)}   `
    assert.equal(clip(padded, 10), 'a'.repeat(10))
  })

  it('stringifies non-string input', () => {
    assert.equal(clip(12345, 10), '12345')
    assert.equal(clip(0, 10), '0')
    assert.equal(clip(true, 10), 'true')
    assert.equal(clip(['a', 'b'], 10), 'a,b')
    assert.equal(clip({}, 100), '[object Object]')
  })

  it('caps multi-byte text by UTF-16 code units, not by characters', () => {
    // Each emoji is a surrogate pair (2 code units), so 200 of them are 400
    // units and get halved. Truncating on the pair boundary keeps them intact.
    const emoji = '\u{1F600}'.repeat(200)
    const clipped = clip(emoji, 200)
    assert.equal(clipped.length, 200)
    assert.equal([...clipped].length, 100, 'emoji must survive as whole code points here')
    assert.ok(!/[\uD800-\uDBFF]$/.test(clipped), 'must not end on a high surrogate')

    // Combining marks are separate code units and are simply cut off.
    const accented = 'é'.repeat(200) // "é" as e + combining acute
    assert.equal(clip(accented, 200).length, 200)
  })

  it('handles a value made entirely of astral characters at an odd boundary', () => {
    // NOTE: clip() slices by UTF-16 code unit, so an odd `max` landing inside a
    // surrogate pair yields a lone surrogate. This pins current behaviour; see
    // the report for why it matters when the value reaches Postgres.
    const clipped = clip('\u{1F600}'.repeat(10), 5)
    assert.equal(clipped.length, 5)
  })

  it('enforces each of the router caps', () => {
    assert.equal(clip('x'.repeat(500), COURSE_NAME_MAX).length, 200)
    assert.equal(clip('x'.repeat(500), ASSIGNMENT_NAME_MAX).length, 300)
    assert.equal(clip('x'.repeat(9000), DESCRIPTION_MAX).length, 4000)
  })
})

describe('nowIso', () => {
  it('returns a parseable UTC ISO timestamp for the current instant', () => {
    const before2 = Date.now()
    const ts = nowIso()
    const after2 = Date.now()
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const t = new Date(ts).getTime()
    assert.ok(t >= before2 - 1 && t <= after2 + 1, 'timestamp must be "now"')
  })
})

// ===========================================================================
// POST /api/syllabus/parse
// ===========================================================================

describe('POST /api/syllabus/parse - auth and rate limiting', () => {
  it('401s without an Authorization header', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse')
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { success: false, error: 'Missing Authorization bearer token' })
  })

  it('401s for a non-bearer Authorization header', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse', { auth: 'Basic dXNlcjpwYXNz' })
    assert.equal(res.status, 401)
  })

  it('runs requireUser BEFORE the rate limiter: 12 anonymous hits stay 401, never 429', async () => {
    stubSupabase()
    // The parse limiter allows 10/hour. If it ran before (or alongside) auth,
    // the anonymous IP bucket would be exhausted and requests 11+ would be 429.
    for (let i = 1; i <= 12; i++) {
      const res = await post('/api/syllabus/parse')
      assert.equal(res.status, 401, `request ${i} should still be 401`)
      assert.equal(res.body.code, undefined, 'a 401 must not carry a RATE_LIMITED code')
    }
  })

  it('does not emit RateLimit headers on the pre-auth 401', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse')
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('RateLimit'), null)
    assert.equal(res.headers.get('RateLimit-Policy'), null)
  })

  it('does apply the 10/hour limit once the caller IS authenticated', async () => {
    stubSupabase()
    stubClaude()
    const auth = bearerFor(nextUser())

    for (let i = 1; i <= 10; i++) {
      const res = await post('/api/syllabus/parse', { auth, form: fileForm(docxFixture) })
      assert.equal(res.status, 200, `request ${i} should have been allowed`)
    }
    const blocked = await post('/api/syllabus/parse', { auth, form: fileForm(docxFixture) })
    assert.equal(blocked.status, 429)
    assert.deepEqual(blocked.body, {
      success: false,
      error: 'Syllabus parse limit reached (10 per hour). Please wait before trying again.',
      code: 'RATE_LIMITED',
    })
  })

  it('buckets the limit per user, not globally', async () => {
    stubSupabase()
    stubClaude()
    const other = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(docxFixture),
    })
    assert.equal(other.status, 200, 'a different user must not inherit the exhausted bucket')
  })
})

describe('POST /api/syllabus/parse - upload handling', () => {
  it('400s when no file is attached', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse', { auth: bearerFor(nextUser()), form: new FormData() })
    assert.equal(res.status, 400)
    assert.equal(res.body.success, false)
    assert.match(res.body.error, /No file uploaded/)
  })

  it('400s for a zero-byte file', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(Buffer.alloc(0)),
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /No file uploaded/)
  })

  it('413s with a clean JSON body when the file exceeds the 5 MB cap', async () => {
    stubSupabase()
    const tooBig = Buffer.alloc(6 * 1024 * 1024, 0x41)
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(tooBig),
    })

    assert.equal(res.status, 413)
    assert.deepEqual(res.body, { success: false, error: 'File is too large. Max size is 5 MB.' })
    assert.match(res.headers.get('content-type'), /application\/json/)
  })

  it('accepts a file just under the 5 MB cap (the limit is not off by a megabyte)', async () => {
    stubSupabase()
    stubClaude()
    // Padding the docx keeps it a valid zip while pushing it near the cap.
    const nearCap = await makeDocx([...SYLLABUS_PARAGRAPHS, 'z'.repeat(4 * 1024 * 1024)])
    assert.ok(nearCap.length < 5 * 1024 * 1024, 'fixture must stay under the cap')
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(nearCap),
    })
    assert.equal(res.status, 200)
  })

  it('400s with JSON (not an HTML stack trace) when multer rejects the upload', async () => {
    stubSupabase()
    // Wrong field name -> multer LIMIT_UNEXPECTED_FILE. The handler wraps
    // multer manually, so this is the path where an unforwarded error would
    // fall through to express' default HTML error page.
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(docxFixture, { field: 'syllabus' }),
    })

    assert.equal(res.status, 400)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.equal(res.body.success, false)
    assert.ok(res.body.error.length > 0)
    assert.ok(!/<html|<pre|Error:\s+at\s/i.test(res.text), 'response must not be an HTML stack trace')
  })

  it('400s with JSON when more than one file is attached', async () => {
    stubSupabase()
    const fd = new FormData()
    fd.append('file', new Blob([docxFixture], { type: DOCX_MIME }), 'a.docx')
    fd.append('file', new Blob([docxFixture], { type: DOCX_MIME }), 'b.docx')
    const res = await post('/api/syllabus/parse', { auth: bearerFor(nextUser()), form: fd })

    assert.equal(res.status, 400)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.equal(res.body.success, false)
    assert.ok(!/<html|<pre/i.test(res.text))
  })

  it('has no multer fileFilter: an unsupported type is rejected downstream as 422', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(Buffer.from('just a text file, long enough to be interesting'), {
        name: 'notes.txt',
        type: 'text/plain',
      }),
    })
    assert.equal(res.status, 422)
    assert.equal(res.body.success, false)
    assert.match(res.body.error, /Unsupported file type/)
  })

  it('422s when the file is the right type but unreadable', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(Buffer.from('this is not a zip archive'), { name: 'broken.docx' }),
    })
    assert.equal(res.status, 422)
    assert.equal(res.body.success, false)
  })
})

describe('POST /api/syllabus/parse - success', () => {
  it('returns the draft plus metadata and persists nothing', async () => {
    const calls = stubSupabase()
    stubClaude()
    const res = await post('/api/syllabus/parse', {
      auth: bearerFor(nextUser()),
      form: fileForm(docxFixture),
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
    assert.deepEqual(res.body.draft.course, CLAUDE_DRAFT.course)
    assert.equal(res.body.draft.assignments.length, 2)

    assert.equal(res.body.meta.assignmentCount, 2)
    assert.equal(res.body.meta.truncated, false)
    assert.ok(res.body.meta.textLength > 0)

    // Parse must be read-only: auth lookup only, no PostgREST writes.
    assert.equal(calls.courses().length, 0)
    assert.equal(calls.assignments().length, 0)
  })

  it('reports truncation in meta for an oversized syllabus', async () => {
    stubSupabase()
    stubClaude()
    const huge = await makeDocx(['CS 3340 Introduction to Algorithms', 'q'.repeat(120000)])
    const res = await post('/api/syllabus/parse', { auth: bearerFor(nextUser()), form: fileForm(huge) })

    assert.equal(res.status, 200)
    assert.equal(res.body.meta.truncated, true)
    assert.ok(res.body.meta.textLength < 120000)
  })
})

describe('POST /api/syllabus/parse - extraction failures', () => {
  const parse = () => post('/api/syllabus/parse', { auth: bearerFor(nextUser()), form: fileForm(docxFixture) })

  it('500s when the Anthropic key is missing (NO_API_KEY)', async () => {
    stubSupabase()
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const res = await parse()
      assert.equal(res.status, 500)
      assert.equal(res.body.success, false)
      assert.match(res.body.error, /ANTHROPIC_API_KEY/)
    } finally {
      process.env.ANTHROPIC_API_KEY = saved
    }
  })

  it('500s when the Anthropic key is rejected (BAD_API_KEY)', async () => {
    stubSupabase()
    stubClaudeError(Object.assign(new Error('bad key'), { status: 401 }))
    const res = await parse()
    assert.equal(res.status, 500)
    assert.match(res.body.error, /ANTHROPIC_API_KEY/)
  })

  it('503s when Anthropic rate-limits us (RATE_LIMITED)', async () => {
    stubSupabase()
    stubClaudeError(Object.assign(new Error('slow down'), { status: 429 }))
    const res = await parse()
    assert.equal(res.status, 503)
    assert.equal(res.body.success, false)
    assert.match(res.body.error, /rate-limited/i)
  })

  it('422s when Claude rejects the request (BAD_REQUEST)', async () => {
    stubSupabase()
    stubClaudeError(Object.assign(new Error('too many tokens'), { status: 400 }))
    const res = await parse()
    assert.equal(res.status, 422)
    assert.match(res.body.error, /Claude could not process this syllabus/)
  })

  it('500s for any other extraction failure', async () => {
    stubSupabase()
    stubClaudeError(Object.assign(new Error('upstream exploded'), { status: 500 }))
    const res = await parse()
    assert.equal(res.status, 500)
    assert.equal(res.body.success, false)
    assert.match(res.body.error, /Claude API error/)
  })

  it('500s when Claude returns no structured data', async () => {
    stubSupabase()
    Anthropic.Messages.prototype.create = async () => ({ content: [{ type: 'text', text: 'nope' }] })
    const res = await parse()
    assert.equal(res.status, 500)
    assert.match(res.body.error, /did not return structured syllabus data/)
  })
})

// ===========================================================================
// POST /api/syllabus/save
// ===========================================================================

const draftBody = (over = {}) => ({
  course: { name: 'Introduction to Algorithms', code: 'CS 3340', term: 'Fall 2026', instructor: 'Ada Lovelace' },
  assignments: [{ name: 'Problem Set 1', dueAt: '2026-09-05T23:59:00.000Z', description: 'Chapters 1-3' }],
  ...over,
})

describe('POST /api/syllabus/save - auth and rate limiting', () => {
  it('401s without an Authorization header', async () => {
    stubSupabase()
    const res = await post('/api/syllabus/save', { json: draftBody() })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { success: false, error: 'Missing Authorization bearer token' })
  })

  it('runs requireUser before the save limiter (anonymous hits never become 429)', async () => {
    stubSupabase()
    for (let i = 1; i <= 12; i++) {
      const res = await post('/api/syllabus/save', { json: draftBody() })
      assert.equal(res.status, 401, `request ${i}`)
      assert.equal(res.body.code, undefined)
    }
  })

  it('never touches the database for an unauthenticated caller', async () => {
    const calls = stubSupabase()
    await post('/api/syllabus/save', { json: draftBody() })
    assert.equal(calls.courses().length, 0)
    assert.equal(calls.assignments().length, 0)
  })
})

describe('POST /api/syllabus/save - validation', () => {
  const save = (json) => post('/api/syllabus/save', { auth: bearerFor(nextUser()), json })

  it('400s when course.name is missing, blank, or whitespace', async () => {
    stubSupabase()
    for (const course of [undefined, {}, { name: '' }, { name: '   ' }, { name: null }]) {
      const res = await save({ course, assignments: [] })
      assert.equal(res.status, 400, `course=${JSON.stringify(course)}`)
      assert.deepEqual(res.body, { success: false, error: 'course.name is required.' })
    }
  })

  it('400s for a completely empty body', async () => {
    stubSupabase()
    const res = await save({})
    assert.equal(res.status, 400)
    assert.match(res.body.error, /course\.name is required/)
  })

  it('reports the index of the assignment that is missing a name', async () => {
    stubSupabase()
    const res = await save(draftBody({
      assignments: [
        { name: 'Fine', dueAt: null },
        { name: '   ', dueAt: null },
      ],
    }))
    assert.equal(res.status, 400)
    assert.deepEqual(res.body, { success: false, error: 'assignments[1].name is required.' })
  })

  it('400s on a malformed due date and names both the index and the value', async () => {
    stubSupabase()
    const res = await save(draftBody({
      assignments: [
        { name: 'Fine', dueAt: '2026-09-05T23:59:00.000Z' },
        { name: 'Broken', dueAt: 'Week 4 Friday' },
      ],
    }))
    assert.equal(res.status, 400)
    assert.match(res.body.error, /^assignments\[1\]: Invalid due date "Week 4 Friday"/)
  })

  it('rejects the whole request rather than saving a partial course', async () => {
    const calls = stubSupabase()
    await save(draftBody({ assignments: [{ name: 'Broken', dueAt: 'nope' }] }))
    assert.equal(calls.courses().length, 0, 'validation must run before the insert')
  })

  it('ignores a non-array assignments value and saves the course alone', async () => {
    const calls = stubSupabase()
    const res = await save(draftBody({ assignments: 'not an array' }))
    assert.equal(res.status, 200)
    assert.equal(res.body.assignmentsInserted, 0)
    assert.equal(calls.assignments().length, 0)
  })

  it('accepts an empty assignments array and inserts only the course', async () => {
    const calls = stubSupabase()
    const res = await post('/api/syllabus/save', { auth: bearerFor(nextUser()), json: draftBody({ assignments: [] }) })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, {
      success: true,
      courseId: 'course-abc',
      assignmentsInserted: 0,
      assignmentsSkipped: 0,
    })
    assert.equal(calls.courses().length, 1)
    assert.equal(calls.assignments().length, 0, 'no empty bulk insert should be issued')
  })
})

describe('POST /api/syllabus/save - insert shape and identity', () => {
  it('takes user_id from the verified JWT, never from the request body', async () => {
    const attacker = nextUser()
    const victim = 'victim-user-id'
    const calls = stubSupabase()

    const res = await post('/api/syllabus/save', {
      auth: bearerFor(attacker),
      json: {
        // Every plausible place a client might try to smuggle an identity in.
        user_id: victim,
        userId: victim,
        course: { name: 'Owned Course', user_id: victim, id: 'course-i-picked' },
        assignments: [{ name: 'Owned Assignment', dueAt: '2026-09-05T23:59:00.000Z', user_id: victim, id: 'a-i-picked' }],
      },
    })

    assert.equal(res.status, 200)

    const courseRow = calls.courses()[0].body
    assert.equal(courseRow.user_id, attacker, 'course.user_id must be the authenticated caller')
    assert.equal(courseRow.id, undefined, 'a client-supplied primary key must not be forwarded')

    const assignmentRows = calls.assignments()[0].body
    assert.equal(assignmentRows.length, 1)
    assert.equal(assignmentRows[0].user_id, attacker)
    assert.equal(assignmentRows[0].id, undefined)

    // Nothing anywhere in the outgoing payloads carries the victim's id.
    const outgoing = JSON.stringify(calls.filter((c) => c.url.includes('/rest/v1/')).map((c) => c.body))
    assert.ok(!outgoing.includes(victim), `victim id leaked into an insert: ${outgoing}`)
  })

  it('writes the expected course row', async () => {
    const user = nextUser()
    const calls = stubSupabase()
    await post('/api/syllabus/save', { auth: bearerFor(user), json: draftBody() })

    const req = calls.courses()[0]
    assert.equal(req.method, 'POST')
    assert.match(req.url, /select=id/)
    assert.match(req.accept, /vnd\.pgrst\.object\+json/, '.single() must ask PostgREST for one object')
    assert.deepEqual(req.body, {
      user_id: user,
      source: 'syllabus',
      external_course_id: req.body.external_course_id,
      course_name: 'Introduction to Algorithms',
      code: 'CS 3340',
      term: 'Fall 2026',
      professor_name: 'Ada Lovelace',
    })
    assert.match(req.body.external_course_id, /^syllabus:[0-9a-f-]{36}$/)
  })

  it('writes the expected assignment rows', async () => {
    const user = nextUser()
    const calls = stubSupabase({ assignments: [{ id: 'a1' }, { id: 'a2' }] })
    const before2 = Date.now()

    const res = await post('/api/syllabus/save', {
      auth: bearerFor(user),
      json: draftBody({
        assignments: [
          { name: 'Problem Set 1', dueAt: '2026-09-05T23:59:00.000Z', description: 'Chapters 1-3' },
          { name: 'Midterm Exam', dueAt: '2026-10-14T23:59:00.000Z' },
        ],
      }),
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.assignmentsInserted, 2)

    const courseExternalId = calls.courses()[0].body.external_course_id
    const rows = calls.assignments()[0].body
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], {
      user_id: user,
      course_id: 'course-abc',
      assignment_name: 'Problem Set 1',
      due_at: '2026-09-05T23:59:00.000Z',
      description: 'Chapters 1-3',
      import_source: 'syllabus',
      external_assignment_id: `${courseExternalId}:0`,
      last_seen_at: rows[0].last_seen_at,
    })
    assert.equal(rows[1].description, null, 'a missing description must be null, not undefined')
    assert.equal(rows[1].external_assignment_id, `${courseExternalId}:1`)
    // last_seen_at is stamped once for the whole batch and is "now".
    assert.equal(rows[0].last_seen_at, rows[1].last_seen_at)
    assert.ok(new Date(rows[0].last_seen_at).getTime() >= before2 - 1000)
  })

  it('sends ONE bulk insert for all assignments (no N+1)', async () => {
    const calls = stubSupabase({ assignments: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}` })) })
    const res = await post('/api/syllabus/save', {
      auth: bearerFor(nextUser()),
      json: draftBody({
        assignments: Array.from({ length: 8 }, (_, i) => ({
          name: `Problem Set ${i + 1}`,
          dueAt: `2026-09-0${i + 1}T23:59:00.000Z`,
        })),
      }),
    })
    assert.equal(res.body.assignmentsInserted, 8)
    assert.equal(calls.assignments().length, 1)
  })

  it('skips assignments with no due date and keeps the ORIGINAL index in the external id', async () => {
    const calls = stubSupabase({ assignments: [{ id: 'a1' }] })
    const res = await post('/api/syllabus/save', {
      auth: bearerFor(nextUser()),
      json: draftBody({
        assignments: [
          { name: 'Undated reading response' },              // index 0 -> skipped
          { name: 'Problem Set 1', dueAt: '2026-09-05T23:59:00.000Z' }, // index 1 -> inserted
          { name: 'Undated participation', dueAt: null },    // index 2 -> skipped
        ],
      }),
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.assignmentsInserted, 1)
    assert.equal(res.body.assignmentsSkipped, 2)

    const courseExternalId = calls.courses()[0].body.external_course_id
    const rows = calls.assignments()[0].body
    assert.equal(rows.length, 1)
    // The index is the position in the *submitted* list, so ids stay stable
    // even though entries 0 and 2 were dropped.
    assert.equal(rows[0].external_assignment_id, `${courseExternalId}:1`)
  })

  it('creates a brand-new course with a fresh external id on every save', async () => {
    const auth = bearerFor(nextUser())
    const calls = stubSupabase()
    await post('/api/syllabus/save', { auth, json: draftBody() })
    await post('/api/syllabus/save', { auth, json: draftBody() })

    const ids = calls.courses().map((c) => c.body.external_course_id)
    assert.equal(ids.length, 2)
    assert.notEqual(ids[0], ids[1], 'each save must mint a new external_course_id')
  })

  it('scopes the write to the caller by forwarding their JWT to PostgREST', async () => {
    const user = nextUser()
    const auth = bearerFor(user)
    const calls = stubSupabase()
    await post('/api/syllabus/save', { auth, json: draftBody() })
    assert.equal(calls.courses()[0].authorization, auth, 'RLS depends on the raw bearer being forwarded')
    assert.equal(calls.assignments()[0].authorization, auth)
  })
})

describe('POST /api/syllabus/save - field caps on the real payload', () => {
  it('clips course fields to their configured maximums', async () => {
    const calls = stubSupabase()
    const res = await post('/api/syllabus/save', {
      auth: bearerFor(nextUser()),
      json: draftBody({
        course: {
          name: 'N'.repeat(500),
          code: 'C'.repeat(500),
          term: 'T'.repeat(500),
          instructor: 'I'.repeat(500),
        },
        assignments: [],
      }),
    })

    assert.equal(res.status, 200)
    const row = calls.courses()[0].body
    assert.equal(row.course_name.length, COURSE_NAME_MAX)
    assert.equal(row.code.length, 50)
    assert.equal(row.term.length, 100)
    assert.equal(row.professor_name.length, 200)
  })

  it('clips assignment name and description to their configured maximums', async () => {
    const calls = stubSupabase()
    const res = await post('/api/syllabus/save', {
      auth: bearerFor(nextUser()),
      json: draftBody({
        assignments: [{
          name: 'A'.repeat(1000),
          description: 'D'.repeat(10000),
          dueAt: '2026-09-05T23:59:00.000Z',
        }],
      }),
    })

    assert.equal(res.status, 200)
    const row = calls.assignments()[0].body[0]
    assert.equal(row.assignment_name.length, ASSIGNMENT_NAME_MAX)
    assert.equal(row.description.length, DESCRIPTION_MAX)
  })

  it('nulls out empty optional course fields rather than sending empty strings', async () => {
    const calls = stubSupabase()
    await post('/api/syllabus/save', {
      auth: bearerFor(nextUser()),
      json: draftBody({ course: { name: 'Course', code: '   ', term: '', instructor: null }, assignments: [] }),
    })
    const row = calls.courses()[0].body
    assert.equal(row.code, null)
    assert.equal(row.term, null)
    assert.equal(row.professor_name, null)
  })
})

describe('POST /api/syllabus/save - database failures', () => {
  it('500s with a generic message and leaks no PostgREST internals when the course insert fails', async () => {
    const calls = stubSupabase({
      courses: {
        status: 400,
        body: {
          message: 'null value in column "course_name" violates not-null constraint',
          details: 'Failing row contains (…)',
          hint: 'add a value',
          code: '23502',
        },
      },
    })

    const res = await post('/api/syllabus/save', { auth: bearerFor(nextUser()), json: draftBody() })

    assert.equal(res.status, 500)
    assert.deepEqual(res.body, { success: false, error: 'Failed to save the course.' })
    // Nothing about the schema, the constraint, or the failing row may escape.
    assert.ok(!/23502|not-null|Failing row|hint/i.test(res.text), res.text)
    assert.equal(calls.assignments().length, 0, 'assignments must not be attempted after a course failure')
  })

  it('500s with a distinct message when the course insert returns no row (RLS)', async () => {
    stubSupabase({ courses: {} })
    const res = await post('/api/syllabus/save', { auth: bearerFor(nextUser()), json: draftBody() })
    assert.equal(res.status, 500)
    assert.deepEqual(res.body, {
      success: false,
      error: 'courses insert returned no row (RLS or constraint).',
    })
  })

  it('500s but returns the courseId when only the assignments insert fails', async () => {
    stubSupabase({
      assignments: { status: 400, body: { message: 'duplicate key value', code: '23505', details: 'Key (x)=(y)', hint: null } },
    })

    const res = await post('/api/syllabus/save', { auth: bearerFor(nextUser()), json: draftBody() })

    assert.equal(res.status, 500)
    assert.equal(res.body.success, false)
    assert.equal(res.body.error, 'The course was saved, but its assignments could not be saved.')
    // The client needs the id to recover; the DB internals must still not leak.
    assert.equal(res.body.courseId, 'course-abc')
    assert.ok(!/23505|duplicate key|Key \(/i.test(res.text), res.text)
  })

  it('reports zero inserted when PostgREST returns no rows for the assignments insert', async () => {
    stubSupabase({ assignments: [] })
    const res = await post('/api/syllabus/save', { auth: bearerFor(nextUser()), json: draftBody() })
    assert.equal(res.status, 200)
    assert.equal(res.body.assignmentsInserted, 0)
  })
})
