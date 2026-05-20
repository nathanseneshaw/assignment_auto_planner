/**
 * Extract course metadata and an assignment list from raw syllabus text using
 * the Claude API.
 *
 * Strategy: force a single tool call with a strict input schema. This guarantees
 * we get well-typed JSON back without having to parse a free-form response.
 *
 * Model: claude-haiku-4-5 — extraction is structured and short; haiku is fast
 * and ~10x cheaper than sonnet. Promote to sonnet only if accuracy is poor.
 */
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_OUTPUT_TOKENS = 4096

const SYSTEM_PROMPT = `You extract structured course metadata and graded assignments from a university course syllabus.

Rules:
- Output dates as ISO 8601: "YYYY-MM-DDTHH:mm:ss". If only a date is given, use "23:59:00" as the time (assignments are typically due end-of-day).
- If the year is missing, infer it from the term, semester, or other context in the document. Default to the current academic year if no other signal exists.
- Use null for any field you cannot determine with reasonable confidence.
- Only include graded, dated deliverables (assignments, projects, papers, quizzes, exams, presentations, problem sets, lab reports). Do NOT include lecture topics, reading-only entries, office hours, holidays, or schedule placeholders.
- Do NOT invent assignments. If the syllabus does not list a specific deliverable with a due date or due week, leave it out.
- For weekly recurring items (e.g. "Weekly homework due Fridays"), expand each occurrence to its own entry IF specific weeks/dates are listed. Otherwise emit one entry describing the cadence with a null due date.
- The assignment "name" should be specific (e.g. "Problem Set 3" or "Midterm Exam"), not generic ("homework").`

function buildClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const err = new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY on the server.')
    err.code = 'NO_API_KEY'
    throw err
  }
  return new Anthropic({ apiKey })
}

const submitSyllabusTool = {
  name: 'submit_syllabus',
  description: 'Submit the extracted course metadata and assignment list parsed from a syllabus.',
  input_schema: {
    type: 'object',
    properties: {
      course: {
        type: 'object',
        description: 'Course-level metadata extracted from the syllabus header.',
        properties: {
          name: {
            type: 'string',
            description: 'Full course title, e.g. "Introduction to Algorithms".',
          },
          code: {
            type: ['string', 'null'],
            description: 'Department + course number, e.g. "CS 3340" or null.',
          },
          term: {
            type: ['string', 'null'],
            description: 'Term/semester, e.g. "Fall 2026" or null.',
          },
          instructor: {
            type: ['string', 'null'],
            description: 'Primary instructor or professor name, or null.',
          },
        },
        required: ['name'],
      },
      assignments: {
        type: 'array',
        description: 'Ordered list of graded, dated deliverables.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Specific assignment name, e.g. "Problem Set 3".',
            },
            dueAt: {
              type: ['string', 'null'],
              description: 'ISO 8601 datetime string, or null if no date is given. Use 23:59:00 as the time.',
            },
            description: {
              type: ['string', 'null'],
              description: 'One-line description or null.',
            },
          },
          required: ['name'],
        },
      },
    },
    required: ['course', 'assignments'],
  },
}

/**
 * @param {string} text The (already-truncated-if-needed) syllabus text.
 * @returns {Promise<{ course: object, assignments: object[] }>}
 */
export async function extractSyllabus(text) {
  const client = buildClient()

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [submitSyllabusTool],
      tool_choice: { type: 'tool', name: 'submit_syllabus' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Here is the full text of a course syllabus. Extract the course metadata and the assignment schedule, then call the submit_syllabus tool.\n\n--- SYLLABUS START ---\n${text}\n--- SYLLABUS END ---`,
            },
          ],
        },
      ],
    })
  } catch (e) {
    // Re-shape Anthropic SDK errors so route handlers can map them to HTTP codes.
    if (e?.status === 401) {
      const err = new Error('Anthropic API key rejected. Check ANTHROPIC_API_KEY on the server.')
      err.code = 'BAD_API_KEY'
      throw err
    }
    if (e?.status === 429) {
      const err = new Error('Anthropic API is rate-limited. Try again in a moment.')
      err.code = 'RATE_LIMITED'
      throw err
    }
    if (e?.status >= 400 && e?.status < 500) {
      const err = new Error(`Claude could not process this syllabus: ${e?.message || 'bad request'}`)
      err.code = 'BAD_REQUEST'
      throw err
    }
    throw new Error(`Claude API error: ${e?.message || String(e)}`)
  }

  const block = (response?.content || []).find((b) => b?.type === 'tool_use' && b?.name === 'submit_syllabus')
  if (!block || typeof block.input !== 'object') {
    throw new Error('Claude did not return structured syllabus data.')
  }

  const draft = block.input
  // Defensive normalization — schema enforces these but the SDK may return
  // extra keys or omit optional ones depending on the model's strictness.
  const course = {
    name: String(draft?.course?.name || '').trim(),
    code: draft?.course?.code ? String(draft.course.code).trim() : null,
    term: draft?.course?.term ? String(draft.course.term).trim() : null,
    instructor: draft?.course?.instructor ? String(draft.course.instructor).trim() : null,
  }
  if (!course.name) {
    throw new Error('Claude returned a syllabus without a course name.')
  }
  const assignments = Array.isArray(draft?.assignments)
    ? draft.assignments
        .map((a) => ({
          name: String(a?.name || '').trim(),
          dueAt: a?.dueAt ? String(a.dueAt).trim() : null,
          description: a?.description ? String(a.description).trim() : null,
        }))
        .filter((a) => a.name)
    : []

  return { course, assignments }
}
