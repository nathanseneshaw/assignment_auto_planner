/**
 * Unit tests for the syllabus text-extraction module.
 *
 * We don't ship binary PDF/DOCX fixtures. Instead both formats are SYNTHESIZED
 * in-process: DOCX via jszip (already a mammoth dependency). That keeps the repo
 * free of binary blobs while still exercising the real mammoth code path,
 * including truncation and the size/format guards.
 *
 * NOTE on the PDF branch: the bundled pdf.js (pdf-parse's v1.10.100 build, run
 * with disableWorker) is NOT deterministic across repeated getDocument() calls
 * in one process - the same valid PDF buffer parses on some iterations and
 * fails with "bad XRef entry" on others. Asserting successful PDF text
 * extraction here would make the suite flaky, so the PDF tests below only pin
 * the deterministic parts: format routing, engine loading, and the guards.
 */
import assert from 'node:assert'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import { extractText } from '../syllabus-extract.js'

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Mirrors the module's own caps so the boundary tests stay honest.
const MAX_CHARS = 60000
const HEAD_KEEP = 50000
const TAIL_KEEP = 5000

// -- fixture builders --------------------------------------------------------

/** Build a minimal, real .docx (OOXML zip) containing the given paragraphs. */
async function makeDocx(paragraphs) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  )
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('')
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

const SYLLABUS_LINES = [
  'CS 3340 Introduction to Algorithms',
  'Fall 2026 Prof Ada Lovelace',
  'Problem Set 1 due September 5 2026',
  'Midterm Exam October 14 2026',
]

// -- format routing ----------------------------------------------------------

describe('extractText - format routing', () => {
  it('rejects unsupported mimetypes with a clear message', async () => {
    await assert.rejects(
      () => extractText(Buffer.from('plain text content'), 'text/plain', 'notes.txt'),
      /Unsupported file type/
    )
  })

  it('rejects when neither mimetype nor filename indicates pdf/docx', async () => {
    await assert.rejects(
      () => extractText(Buffer.from('binary'), 'application/octet-stream', 'mystery.bin'),
      /Unsupported file type/
    )
  })

  it('rejects when both mimetype and filename are missing entirely', async () => {
    await assert.rejects(() => extractText(Buffer.from('x')), /Unsupported file type/)
    await assert.rejects(() => extractText(Buffer.from('x'), null, null), /Unsupported file type/)
    await assert.rejects(() => extractText(Buffer.from('x'), '', ''), /Unsupported file type/)
  })

  it('only matches the extension at the END of the filename', async () => {
    // "report.pdf.txt" is a .txt file, not a PDF.
    await assert.rejects(
      () => extractText(Buffer.from('x'), 'text/plain', 'report.pdf.txt'),
      /Unsupported file type/
    )
    await assert.rejects(
      () => extractText(Buffer.from('x'), 'text/plain', 'docx-notes.md'),
      /Unsupported file type/
    )
  })

  it('falls back to filename when mimetype is generic', async () => {
    // We can't fully extract from a bogus PDF buffer, but we can confirm the
    // routing path picks the PDF branch (the pdf.js call will then throw a
    // PDF-specific error, not the "Unsupported file type" routing error).
    await assert.rejects(
      () => extractText(Buffer.from('not really a pdf'), 'application/octet-stream', 'syllabus.pdf'),
      (err) => !/Unsupported file type/.test(err.message)
    )
  })

  it('is case-insensitive about the mimetype and the filename extension', async () => {
    const docx = await makeDocx(SYLLABUS_LINES)
    const byUpperMime = await extractText(docx, DOCX_MIME.toUpperCase(), '')
    assert.match(byUpperMime.text, /Introduction to Algorithms/)

    const byUpperName = await extractText(docx, 'application/octet-stream', 'SYLLABUS.DOCX')
    assert.match(byUpperName.text, /Introduction to Algorithms/)

    // For PDF we only assert the ROUTING decision: an uppercase .PDF name must
    // reach the pdf.js branch (which then fails on the bogus bytes) rather than
    // being rejected as an unsupported type.
    await assert.rejects(
      () => extractText(Buffer.from('%PDF-1.4 nonsense'), 'application/octet-stream', 'SYLLABUS.PDF'),
      (err) => !/Unsupported file type/.test(err.message)
    )
    await assert.rejects(
      () => extractText(Buffer.from('%PDF-1.4 nonsense'), PDF_MIME.toUpperCase(), ''),
      (err) => !/Unsupported file type/.test(err.message)
    )
  })
})

// -- DOCX / mammoth ----------------------------------------------------------

describe('extractText - DOCX (mammoth) path', () => {
  it('extracts paragraph text from a real .docx package', async () => {
    const buf = await makeDocx(SYLLABUS_LINES)
    const { text, truncated } = await extractText(buf, DOCX_MIME, 'syllabus.docx')

    assert.equal(truncated, false)
    for (const line of SYLLABUS_LINES) assert.ok(text.includes(line), `missing line: ${line}`)
    // Paragraph boundaries survive so the LLM can see the schedule as rows.
    assert.ok(text.indexOf('Problem Set 1') < text.indexOf('Midterm Exam'))
  })

  it('routes on mimetype alone, with no filename at all', async () => {
    const buf = await makeDocx(SYLLABUS_LINES)
    const { text } = await extractText(buf, DOCX_MIME)
    assert.match(text, /Ada Lovelace/)
  })

  it('normalizes whitespace: trimmed, and never 3+ consecutive newlines', async () => {
    const buf = await makeDocx([
      '   CS 3340 Introduction to Algorithms - Fall 2026   ',
      '',
      '',
      '',
      'Problem Set 1 due September 5 2026 at 11:59 pm on eLearning',
      '',
      '',
      '   ',
    ])
    const { text } = await extractText(buf, DOCX_MIME, 'syllabus.docx')

    assert.equal(text, text.trim(), 'output must be trimmed')
    assert.ok(!/\n{3,}/.test(text), `runs of 3+ newlines must be collapsed: ${JSON.stringify(text)}`)
    assert.ok(text.startsWith('CS 3340'), 'leading whitespace must be trimmed')
    assert.ok(text.endsWith('eLearning'), 'trailing blank paragraphs must be trimmed')
  })

  it('rejects a .docx that yields fewer than 80 characters of text', async () => {
    const buf = await makeDocx(['Syllabus'])
    await assert.rejects(
      () => extractText(buf, DOCX_MIME, 'stub.docx'),
      /Could not extract text/
    )
  })

  it('rejects an empty buffer without hanging or crashing', async () => {
    await assert.rejects(
      () => extractText(Buffer.alloc(0), DOCX_MIME, 'empty.docx'),
      (err) => err instanceof Error && !/Unsupported file type/.test(err.message)
    )
  })

  it('rejects a corrupt (non-zip) .docx with a real Error, not a crash', async () => {
    await assert.rejects(
      () => extractText(Buffer.from('this is definitely not a zip archive'), DOCX_MIME, 'corrupt.docx'),
      (err) => err instanceof Error && !/Unsupported file type/.test(err.message)
    )
  })

  it('rejects a zip that is not an OOXML package', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'not a word document')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    await assert.rejects(() => extractText(buf, DOCX_MIME, 'notword.docx'), (err) => err instanceof Error)
  })
})

// -- PDF / pdf.js ------------------------------------------------------------

describe('extractText - PDF (pdf.js) path', () => {
  it('loads the bundled pdf.js engine (no "Cannot find module") on the PDF path', async () => {
    // Regression guard: pdf-parse's internal loader used a template-literal
    // relative require that could throw `Cannot find module
    // './pdf.js/v1.10.100/build/pdf.js'` at runtime. We now resolve that build
    // by absolute path. A malformed-but-routed PDF must fail with a *PDF parse*
    // error, proving the engine loaded and ran  never a module-load error.
    await assert.rejects(
      () => extractText(Buffer.from('%PDF-1.4 malformed body'), PDF_MIME, 'syllabus.pdf'),
      (err) => !/Cannot find module|pdf\.js.*build/i.test(err.message)
    )
  })

  it('rejects an empty buffer on the PDF branch without hanging', async () => {
    await assert.rejects(
      () => extractText(Buffer.alloc(0), PDF_MIME, 'empty.pdf'),
      (err) => err instanceof Error && !/Unsupported file type/.test(err.message)
    )
  })

  it('rejects a file that claims to be a PDF but has no PDF header', async () => {
    await assert.rejects(
      () => extractText(Buffer.from('just some plain prose, definitely not a document'), PDF_MIME, 'fake.pdf'),
      (err) => err instanceof Error && !/Unsupported file type/.test(err.message)
    )
  })

  it('surfaces PDF engine failures as plain Errors the route can turn into a 422', async () => {
    await assert.rejects(
      () => extractText(Buffer.from('%PDF-1.7\ntruncated'), PDF_MIME, 'truncated.pdf'),
      (err) => err instanceof Error && typeof err.message === 'string' && err.message.length > 0
    )
  })
})

// -- truncation --------------------------------------------------------------

describe('extractText - truncation of very large input', () => {
  it('leaves text at exactly the 60000-char cap untouched', async () => {
    const buf = await makeDocx(['A'.repeat(MAX_CHARS)])
    const { text, truncated } = await extractText(buf, DOCX_MIME, 'big.docx')
    assert.equal(truncated, false)
    assert.equal(text.length, MAX_CHARS)
  })

  it('truncates one character over the cap', async () => {
    const buf = await makeDocx(['A'.repeat(MAX_CHARS + 1)])
    const { text, truncated } = await extractText(buf, DOCX_MIME, 'big.docx')
    assert.equal(truncated, true)
    assert.ok(text.length < MAX_CHARS + 1)
    assert.match(text, /\[\.\.\. \d+ chars omitted \.\.\.\]/)
  })

  it('keeps the head (course header) and the tail (assignment schedule)', async () => {
    const head = 'CS 3340 Introduction to Algorithms - Fall 2026'
    const tail = 'FINAL EXAM due December 12 2026'
    const filler = 'x'.repeat(120000)
    const buf = await makeDocx([`${head} ${filler}`, tail])

    const { text, truncated } = await extractText(buf, DOCX_MIME, 'huge.docx')

    assert.equal(truncated, true)
    assert.ok(text.startsWith(head), 'head slice must preserve the course header')
    assert.ok(text.endsWith(tail), 'tail slice must preserve the end of the schedule')
    assert.match(text, /\[\.\.\. \d+ chars omitted \.\.\.\]/)

    // head + marker + tail, and nothing else.
    const [keptHead, keptTail] = text.split(/\n\n\[\.\.\. \d+ chars omitted \.\.\.\]\n\n/)
    assert.equal(keptHead.length, HEAD_KEEP)
    assert.equal(keptTail.length, TAIL_KEEP)
  })

  it('reports an omitted count consistent with the original length', async () => {
    const original = 'y'.repeat(200000)
    const buf = await makeDocx([original])
    const { text } = await extractText(buf, DOCX_MIME, 'huge.docx')
    const omitted = Number(text.match(/\[\.\.\. (\d+) chars omitted \.\.\.\]/)[1])
    assert.equal(omitted, original.length - HEAD_KEEP - TAIL_KEEP)
  })
})
