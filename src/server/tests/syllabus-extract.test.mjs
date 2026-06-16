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
    // routing path picks the PDF branch (the pdf-parse call will then throw a
    // PDF-specific error, not the "Unsupported file type" routing error).
    await assert.rejects(
      () => extractText(Buffer.from('not really a pdf'), 'application/octet-stream', 'syllabus.pdf'),
      (err) => !/Unsupported file type/.test(err.message)
    )
  })
})
