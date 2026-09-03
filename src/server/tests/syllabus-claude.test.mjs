/**
 * Unit tests for the Claude wrapper.
 *
 * No real API calls. `extractSyllabus` builds its own SDK client internally, so
 * instead of trying to inject a fake we stub `Anthropic.Messages.prototype.create`
 * - the ESM module registry hands the test the same class object the module
 * under test uses, so the stub is picked up by the client it builds. That also
 * lets us capture the exact request payload and assert on the model, the token
 * budget, and the tool schema that actually goes over the wire.
 *
 * Cost note: importing @anthropic-ai/sdk costs ~250ms once per process. That is
 * paid at import time here, not per test, so the tests below are ~1ms each.
 */
import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'
import { extractSyllabus } from '../syllabus-claude.js'

const SAMPLE_TEXT = 'CS 3340 Algorithms\n\nProblem Set 1 due Sept 5'

/** Install a create() stub and capture every request payload it receives. */
function stubCreate(impl) {
  const calls = []
  Anthropic.Messages.prototype.create = async function (args) {
    calls.push(args)
    return typeof impl === 'function' ? impl(args) : impl
  }
  return calls
}

/** Install a create() stub that rejects with the given error. */
function stubReject(err) {
  Anthropic.Messages.prototype.create = async function () { throw err }
}

const toolUse = (input) => ({
  content: [{ type: 'tool_use', id: 'toolu_1', name: 'submit_syllabus', input }],
})

const GOOD_INPUT = {
  course: { name: 'Introduction to Algorithms', code: 'CS 3340', term: 'Fall 2026', instructor: 'Ada Lovelace' },
  assignments: [
    { name: 'Problem Set 1', dueAt: '2026-09-05T23:59:00', description: 'Chapters 1-3' },
    { name: 'Midterm Exam', dueAt: '2026-10-14T23:59:00', description: null },
  ],
}

// ---------------------------------------------------------------------------
// Configuration paths (no stub installed)
// ---------------------------------------------------------------------------

describe('extractSyllabus - configuration', () => {
  it('throws NO_API_KEY when ANTHROPIC_API_KEY is unset', async () => {
    // Save and clear the env var in case the runner has it configured.
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    // Import after clearing so the module's lazy client builder picks up the
    // missing env. (Our buildClient() is per-call, so import timing isn't
    // strictly required  but staying explicit keeps the test honest.)
    const { extractSyllabus: fresh } = await import('../syllabus-claude.js')

    try {
      await assert.rejects(
        () => fresh(SAMPLE_TEXT),
        (err) => err?.code === 'NO_API_KEY'
      )
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
  })

  it('reads ANTHROPIC_API_KEY per call, so setting it later works without a reimport', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (e) => e.code === 'NO_API_KEY')

    const realCreate = Anthropic.Messages.prototype.create
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    try {
      stubCreate(toolUse(GOOD_INPUT))
      const draft = await extractSyllabus(SAMPLE_TEXT)
      assert.equal(draft.course.name, 'Introduction to Algorithms')
    } finally {
      Anthropic.Messages.prototype.create = realCreate
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = saved
    }
  })
})

// ---------------------------------------------------------------------------
// Everything below runs with a fake API key and a stubbed SDK.
// ---------------------------------------------------------------------------

let savedCreate
let savedKey
beforeEach(() => {
  savedCreate = Anthropic.Messages.prototype.create
  savedKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
})
afterEach(() => {
  Anthropic.Messages.prototype.create = savedCreate
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedKey
})

describe('extractSyllabus - request payload', () => {
  it('pins the model and the output token budget', async () => {
    const calls = stubCreate(toolUse(GOOD_INPUT))
    await extractSyllabus(SAMPLE_TEXT)

    // An accidental model swap silently changes cost and accuracy - pin both.
    assert.equal(calls[0].model, 'claude-haiku-4-5-20251001')
    assert.equal(calls[0].max_tokens, 4096)
  })

  it('forces the submit_syllabus tool rather than hoping the model calls it', async () => {
    const calls = stubCreate(toolUse(GOOD_INPUT))
    await extractSyllabus(SAMPLE_TEXT)

    assert.deepEqual(calls[0].tool_choice, { type: 'tool', name: 'submit_syllabus' })
    assert.equal(calls[0].tools.length, 1)
    assert.equal(calls[0].tools[0].name, 'submit_syllabus')
  })

  it('sends the extraction rules as a system prompt', async () => {
    const calls = stubCreate(toolUse(GOOD_INPUT))
    await extractSyllabus(SAMPLE_TEXT)

    const system = calls[0].system
    assert.equal(typeof system, 'string')
    assert.match(system, /ISO 8601/)
    assert.match(system, /23:59:00/)
    assert.match(system, /Do NOT invent assignments/)
  })

  it('wraps the syllabus text in explicit delimiters as a single user message', async () => {
    const calls = stubCreate(toolUse(GOOD_INPUT))
    await extractSyllabus(SAMPLE_TEXT)

    const messages = calls[0].messages
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[0].content.length, 1)
    assert.equal(messages[0].content[0].type, 'text')

    const text = messages[0].content[0].text
    assert.match(text, /--- SYLLABUS START ---/)
    assert.match(text, /--- SYLLABUS END ---/)
    assert.ok(text.includes(SAMPLE_TEXT), 'the raw syllabus text must be embedded verbatim')
  })

  it('calls the API even for empty or whitespace-only text (no local short-circuit)', async () => {
    for (const input of ['', '   ', '\n\n\t ']) {
      const calls = stubCreate(toolUse(GOOD_INPUT))
      await extractSyllabus(input)
      assert.equal(calls.length, 1, `expected one API call for ${JSON.stringify(input)}`)
      assert.match(calls[0].messages[0].content[0].text, /--- SYLLABUS START ---/)
    }
  })

  it('passes undefined text through as the literal string "undefined"', async () => {
    // Documents current behaviour: the template literal stringifies whatever it
    // gets, so a missing argument reaches the model rather than throwing.
    const calls = stubCreate(toolUse(GOOD_INPUT))
    await extractSyllabus(undefined)
    assert.match(calls[0].messages[0].content[0].text, /SYLLABUS START ---\nundefined\n--- SYLLABUS END/)
  })
})

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

describe('submit_syllabus tool schema', () => {
  const VALID_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

  /** Recursively assert every `type` in a JSON Schema is a valid keyword. */
  function assertTypesValid(node, path = '$') {
    if (!node || typeof node !== 'object') return
    if ('type' in node) {
      const types = Array.isArray(node.type) ? node.type : [node.type]
      for (const t of types) {
        assert.ok(VALID_TYPES.has(t), `${path}.type has invalid JSON Schema type "${t}"`)
      }
    }
    if (node.properties) {
      for (const [k, v] of Object.entries(node.properties)) assertTypesValid(v, `${path}.properties.${k}`)
    }
    if (node.items) assertTypesValid(node.items, `${path}.items`)
  }

  /** Every name in `required` must exist in `properties`. */
  function assertRequiredResolvable(node, path = '$') {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.required)) {
      assert.ok(node.properties, `${path} declares required but has no properties`)
      for (const name of node.required) {
        assert.ok(name in node.properties, `${path}.required lists "${name}" which is not a property`)
      }
    }
    if (node.properties) {
      for (const [k, v] of Object.entries(node.properties)) assertRequiredResolvable(v, `${path}.properties.${k}`)
    }
    if (node.items) assertRequiredResolvable(node.items, `${path}.items`)
  }

  async function captureTool() {
    const calls = stubCreate(toolUse(GOOD_INPUT))
    await extractSyllabus(SAMPLE_TEXT)
    return calls[0].tools[0]
  }

  it('is a well-formed Anthropic tool definition', async () => {
    const tool = await captureTool()
    assert.equal(typeof tool.name, 'string')
    assert.ok(tool.name.length > 0)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 0, 'a tool without a description degrades extraction quality')
    assert.equal(tool.input_schema.type, 'object')
    assert.equal(typeof tool.input_schema.properties, 'object')
  })

  it('uses only valid JSON Schema types at every level', async () => {
    assertTypesValid((await captureTool()).input_schema)
  })

  it('only marks properties that actually exist as required', async () => {
    assertRequiredResolvable((await captureTool()).input_schema)
  })

  it('requires course and assignments at the top level', async () => {
    const schema = (await captureTool()).input_schema
    assert.deepEqual([...schema.required].sort(), ['assignments', 'course'])
  })

  it('models the course object with a required name and nullable optional fields', async () => {
    const course = (await captureTool()).input_schema.properties.course
    assert.equal(course.type, 'object')
    assert.deepEqual(course.required, ['name'])
    assert.equal(course.properties.name.type, 'string')
    for (const key of ['code', 'term', 'instructor']) {
      assert.deepEqual(course.properties[key].type, ['string', 'null'], `course.${key} must be nullable`)
    }
  })

  it('models assignments as an array of objects with a required name', async () => {
    const assignments = (await captureTool()).input_schema.properties.assignments
    assert.equal(assignments.type, 'array')
    assert.equal(assignments.items.type, 'object')
    assert.deepEqual(assignments.items.required, ['name'])
    assert.equal(assignments.items.properties.name.type, 'string')
    // dueAt must be nullable: plenty of syllabi list undated deliverables.
    assert.deepEqual(assignments.items.properties.dueAt.type, ['string', 'null'])
    assert.deepEqual(assignments.items.properties.description.type, ['string', 'null'])
  })

  it('documents every property so the model knows what to put there', async () => {
    const schema = (await captureTool()).input_schema
    const walk = (node, path) => {
      if (!node?.properties) return
      for (const [k, v] of Object.entries(node.properties)) {
        assert.equal(typeof v.description, 'string', `${path}.${k} is missing a description`)
        assert.ok(v.description.length > 0, `${path}.${k} has an empty description`)
        walk(v, `${path}.${k}`)
        if (v.items) walk(v.items, `${path}.${k}[]`)
      }
    }
    walk(schema, 'input_schema')
  })
})

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe('extractSyllabus - response parsing', () => {
  it('parses a well-formed tool_use response', async () => {
    stubCreate(toolUse(GOOD_INPUT))
    const draft = await extractSyllabus(SAMPLE_TEXT)

    assert.deepEqual(draft.course, {
      name: 'Introduction to Algorithms',
      code: 'CS 3340',
      term: 'Fall 2026',
      instructor: 'Ada Lovelace',
    })
    assert.equal(draft.assignments.length, 2)
    assert.deepEqual(draft.assignments[0], {
      name: 'Problem Set 1',
      dueAt: '2026-09-05T23:59:00',
      description: 'Chapters 1-3',
    })
    assert.equal(draft.assignments[1].description, null)
  })

  it('picks the tool_use block out of a mixed content array', async () => {
    stubCreate({
      content: [
        { type: 'text', text: 'Let me extract that for you.' },
        { type: 'tool_use', id: 'toolu_2', name: 'submit_syllabus', input: GOOD_INPUT },
      ],
    })
    const draft = await extractSyllabus(SAMPLE_TEXT)
    assert.equal(draft.course.name, 'Introduction to Algorithms')
  })

  it('trims whitespace and normalizes missing optional fields to null', async () => {
    stubCreate(toolUse({
      course: { name: '  Data Structures  ', code: '   ', term: undefined },
      assignments: [{ name: '  Lab 1  ', dueAt: '  2026-09-01T23:59:00  ', description: '' }],
    }))
    const draft = await extractSyllabus(SAMPLE_TEXT)

    assert.equal(draft.course.name, 'Data Structures')
    assert.equal(draft.course.code, '')      // a whitespace-only string trims to ''
    assert.equal(draft.course.term, null)
    assert.equal(draft.course.instructor, null)
    assert.equal(draft.assignments[0].name, 'Lab 1')
    assert.equal(draft.assignments[0].dueAt, '2026-09-01T23:59:00')
    assert.equal(draft.assignments[0].description, null)
  })

  it('drops assignment entries that have no usable name', async () => {
    stubCreate(toolUse({
      course: { name: 'Course' },
      assignments: [
        { name: 'Keep me', dueAt: null },
        { name: '   ' },
        { name: null },
        {},
        null,
        { name: 'Keep me too', dueAt: null },
      ],
    }))
    const draft = await extractSyllabus(SAMPLE_TEXT)
    assert.deepEqual(draft.assignments.map((a) => a.name), ['Keep me', 'Keep me too'])
  })

  it('returns an empty assignment list when assignments is missing or not an array', async () => {
    for (const assignments of [undefined, null, 'none', 42, {}]) {
      stubCreate(toolUse({ course: { name: 'Course' }, assignments }))
      const draft = await extractSyllabus(SAMPLE_TEXT)
      assert.deepEqual(draft.assignments, [], `assignments=${JSON.stringify(assignments)}`)
    }
  })

  it('coerces non-string values rather than leaking raw model output', async () => {
    stubCreate(toolUse({
      course: { name: 12345, code: 678 },
      assignments: [{ name: 99, dueAt: 2026, description: 7 }],
    }))
    const draft = await extractSyllabus(SAMPLE_TEXT)
    assert.equal(draft.course.name, '12345')
    assert.equal(draft.course.code, '678')
    assert.equal(draft.assignments[0].name, '99')
    assert.equal(draft.assignments[0].dueAt, '2026')
    assert.equal(draft.assignments[0].description, '7')
  })
})

describe('extractSyllabus - malformed responses', () => {
  const NO_STRUCTURE = /Claude did not return structured syllabus data/

  it('throws when the response has no tool_use block', async () => {
    stubCreate({ content: [{ type: 'text', text: 'I could not find any assignments.' }] })
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), NO_STRUCTURE)
  })

  it('throws when the content array is empty', async () => {
    stubCreate({ content: [] })
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), NO_STRUCTURE)
  })

  it('throws when the response has no content at all', async () => {
    for (const response of [{}, null, undefined, { content: null }]) {
      stubCreate(response)
      await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), NO_STRUCTURE)
    }
  })

  it('throws when a tool_use block has a different tool name', async () => {
    stubCreate({ content: [{ type: 'tool_use', name: 'some_other_tool', input: GOOD_INPUT }] })
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), NO_STRUCTURE)
  })

  it('throws when the tool input is not an object', async () => {
    for (const input of ['{"course":{}}', 42, true, undefined]) {
      stubCreate(toolUse(input))
      await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), NO_STRUCTURE, `input=${JSON.stringify(input)}`)
    }
  })

  it('throws a specific error when the course has no usable name', async () => {
    for (const course of [{}, { name: '' }, { name: '   ' }, { name: null }, undefined]) {
      stubCreate(toolUse({ course, assignments: [] }))
      await assert.rejects(
        () => extractSyllabus(SAMPLE_TEXT),
        /Claude returned a syllabus without a course name/,
        `course=${JSON.stringify(course)}`
      )
    }
  })

  it('accepts a null tool input as "no structured data" rather than crashing', async () => {
    // typeof null === 'object', so this reaches the destructuring below; the
    // course-name guard must catch it instead of throwing a TypeError.
    stubCreate(toolUse(null))
    await assert.rejects(
      () => extractSyllabus(SAMPLE_TEXT),
      (err) => err instanceof Error && !/Cannot read properties/.test(err.message)
    )
  })
})

// ---------------------------------------------------------------------------
// SDK error mapping
// ---------------------------------------------------------------------------

describe('extractSyllabus - SDK error mapping', () => {
  it('maps 401 to BAD_API_KEY', async () => {
    stubReject(Object.assign(new Error('invalid x-api-key'), { status: 401 }))
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
      assert.equal(err.code, 'BAD_API_KEY')
      assert.match(err.message, /ANTHROPIC_API_KEY/)
      return true
    })
  })

  it('maps 429 to RATE_LIMITED', async () => {
    stubReject(Object.assign(new Error('rate_limit_error'), { status: 429 }))
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
      assert.equal(err.code, 'RATE_LIMITED')
      assert.match(err.message, /rate-limited/i)
      return true
    })
  })

  it('maps other 4xx statuses to BAD_REQUEST', async () => {
    for (const status of [400, 403, 404, 413, 422, 499]) {
      stubReject(Object.assign(new Error(`boom ${status}`), { status }))
      await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
        assert.equal(err.code, 'BAD_REQUEST', `status ${status}`)
        assert.match(err.message, /Claude could not process this syllabus/)
        return true
      })
    }
  })

  it('leaves 5xx errors uncoded so the route returns a generic 500', async () => {
    for (const status of [500, 502, 503, 529]) {
      stubReject(Object.assign(new Error('upstream exploded'), { status }))
      await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
        assert.equal(err.code, undefined, `status ${status} must not be given a code`)
        assert.match(err.message, /^Claude API error: upstream exploded$/)
        return true
      })
    }
  })

  it('handles a transport error with no status at all', async () => {
    stubReject(new Error('ECONNRESET'))
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
      assert.equal(err.code, undefined)
      assert.match(err.message, /^Claude API error: ECONNRESET$/)
      return true
    })
  })

  it('handles a non-Error rejection value', async () => {
    stubReject('something went very wrong')
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
      assert.match(err.message, /Claude API error:/)
      return true
    })
  })

  it('does not leak the raw SDK error object to the caller', async () => {
    const sdkError = Object.assign(new Error('secret internals'), { status: 401, request_id: 'req_123' })
    stubReject(sdkError)
    await assert.rejects(() => extractSyllabus(SAMPLE_TEXT), (err) => {
      assert.notEqual(err, sdkError, 'the rethrown error must be a fresh, reshaped Error')
      assert.equal(err.request_id, undefined)
      return true
    })
  })
})
