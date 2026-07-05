/**
 * Unit tests for the syllabus text-extraction module.
 *
 * We don't ship binary PDF/DOCX fixtures here  those formats are best
 * exercised via manual end-to-end testing with real files. These tests cover
 * the validation and error paths that are easy to reason about programmatically.
 */
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { extractText } from '../syllabus-extract.js'

describe('extractText', () => {
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

  it('falls back to filename when mimetype is generic', async () => {
    // We can't fully extract from a bogus PDF buffer, but we can confirm the
    // routing path picks the PDF branch (the pdf.js call will then throw a
    // PDF-specific error, not the "Unsupported file type" routing error).
    await assert.rejects(
      () => extractText(Buffer.from('not really a pdf'), 'application/octet-stream', 'syllabus.pdf'),
      (err) => !/Unsupported file type/.test(err.message)
    )
  })

  it('loads the bundled pdf.js engine (no "Cannot find module") on the PDF path', async () => {
    // Regression guard: pdf-parse's internal loader used a template-literal
    // relative require that could throw `Cannot find module
    // './pdf.js/v1.10.100/build/pdf.js'` at runtime. We now resolve that build
    // by absolute path. A malformed-but-routed PDF must fail with a *PDF parse*
    // error, proving the engine loaded and ran  never a module-load error.
    await assert.rejects(
      () => extractText(Buffer.from('%PDF-1.4 malformed body'), 'application/pdf', 'syllabus.pdf'),
      (err) => !/Cannot find module|pdf\.js.*build/i.test(err.message)
    )
  })
})
