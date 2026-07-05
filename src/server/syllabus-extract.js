/**
 * Extract plain text from an uploaded syllabus.
 *
 * Supports PDF (`application/pdf`) and DOCX
 * (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
 * Returns `{ text, truncated }`  the caller passes `text` to the LLM.
 *
 * Notes
 * - We do NOT call pdf-parse's exported function. Its internal loader resolves
 *   the bundled pdf.js with a template-literal *relative* require
 *   (`require(`./pdf.js/${version}/build/pdf.js`)`), which throws
 *   `Cannot find module './pdf.js/v1.10.100/build/pdf.js'` whenever that
 *   relative lookup fails at runtime (stale/partial installs, bundling, odd
 *   module resolution). Instead we resolve that same bundled build ourselves by
 *   ABSOLUTE path and drive pdf.js directly, so extraction never depends on the
 *   fragile relative lookup. The page-text loop mirrors pdf-parse's own.
 * - Truncation keeps the head (where the course header lives) plus a tail
 *   slice (where the schedule/assignment table typically lives) so we still
 *   capture due dates for long syllabi without blowing the model's budget.
 */
import { createRequire } from 'module'
import mammoth from 'mammoth'

const require = createRequire(import.meta.url)

// Bundled pdf.js builds shipped inside pdf-parse, most-preferred first.
// v1.10.100 is pdf-parse 1.1.4's own default; the others are fallbacks so a
// version bump can't reintroduce the "Cannot find module" failure.
const PDFJS_BUILD_VERSIONS = ['v1.10.100', 'v2.0.550', 'v1.10.88', 'v1.9.426']

let pdfjsPromise = null
/** Lazily load the bundled pdf.js by absolute path (resolved once, cached). */
function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise
  pdfjsPromise = (async () => {
    let lastErr
    for (const version of PDFJS_BUILD_VERSIONS) {
      try {
        const buildPath = require.resolve(`pdf-parse/lib/pdf.js/${version}/build/pdf.js`)
        const PDFJS = require(buildPath)
        // Disable the web worker: in Node there is no worker URL to load, and
        // pdf.js falls back to running on the main thread (as pdf-parse does).
        PDFJS.disableWorker = true
        return PDFJS
      } catch (err) {
        lastErr = err
      }
    }
    throw new Error(`Could not load the PDF engine (pdf.js). ${lastErr?.message || ''}`.trim())
  })()
  return pdfjsPromise
}

/** Extract plain text from a PDF buffer. Mirrors pdf-parse's page/render loop. */
async function pdfToText(buffer) {
  const PDFJS = await loadPdfjs()
  const doc = await PDFJS.getDocument(buffer)
  let text = ''
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i).catch(() => null)
      if (!page) continue
      const content = await page
        .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
        .catch(() => null)
      if (!content) continue
      // Insert a newline whenever the vertical position (transform[5]) changes,
      // so lines in the schedule/assignment table stay separated.
      let lastY
      let pageText = ''
      for (const item of content.items) {
        pageText += (lastY === item.transform[5] || lastY === undefined ? '' : '\n') + item.str
        lastY = item.transform[5]
      }
      text += `\n\n${pageText}`
    }
  } finally {
    doc.destroy?.()
  }
  return text
}

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Hard cap on what we send to the LLM. ~60k chars ≈ ~15k tokens  well under
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
 * @param {string} [filename] original filename  used as fallback when the
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
    raw = await pdfToText(buffer)
  } else {
    const result = await mammoth.extractRawText({ buffer })
    raw = result?.value || ''
  }

  const text = normalize(raw)
  if (text.length < 80) {
    throw new Error('Could not extract text  the file may be a scanned image or empty.')
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
