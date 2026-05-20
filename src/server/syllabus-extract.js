/**
 * Extract plain text from an uploaded syllabus.
 *
 * Supports PDF (`application/pdf`) and DOCX
 * (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
 * Returns `{ text, truncated }` — the caller passes `text` to the LLM.
 *
 * Notes
 * - We import the inner pdf-parse module instead of the package index because
 *   the index has a debug stub that reads `./test/data/05-versions-space.pdf`
 *   when loaded directly and crashes in production.
 * - Truncation keeps the head (where the course header lives) plus a tail
 *   slice (where the schedule/assignment table typically lives) so we still
 *   capture due dates for long syllabi without blowing the model's budget.
 */
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import mammoth from 'mammoth'

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Hard cap on what we send to the LLM. ~60k chars ≈ ~15k tokens — well under
// Claude's context window but enough for a 20-page syllabus.
const MAX_CHARS = 60000
const HEAD_KEEP = 50000
const TAIL_KEEP = 5000

function normalize(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * @param {Buffer} buffer raw file bytes
 * @param {string} mimetype the browser-reported mimetype
 * @param {string} [filename] original filename — used as fallback when the
 *   browser sends a generic `application/octet-stream`
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
export async function extractText(buffer, mimetype, filename = '') {
  const mt = String(mimetype || '').toLowerCase()
  const lowerName = String(filename || '').toLowerCase()
  const isPdf = mt === PDF_MIME || lowerName.endsWith('.pdf')
  const isDocx = mt === DOCX_MIME || lowerName.endsWith('.docx')

  if (!isPdf && !isDocx) {
    throw new Error(`Unsupported file type "${mimetype || filename}". Upload a .pdf or .docx file.`)
  }

  let raw
  if (isPdf) {
    const result = await pdfParse(buffer)
    raw = result?.text || ''
  } else {
    const result = await mammoth.extractRawText({ buffer })
    raw = result?.value || ''
  }

  const text = normalize(raw)
  if (text.length < 80) {
    throw new Error('Could not extract text — the file may be a scanned image or empty.')
  }

  if (text.length <= MAX_CHARS) {
    return { text, truncated: false }
  }

  const head = text.slice(0, HEAD_KEEP)
  const tail = text.slice(-TAIL_KEEP)
  return {
    text: `${head}\n\n[... ${text.length - HEAD_KEEP - TAIL_KEEP} chars omitted ...]\n\n${tail}`,
    truncated: true,
  }
}
