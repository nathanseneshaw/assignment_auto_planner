/**
 * Express router for the Syllabus Parser feature.
 *
 * Two endpoints:
 *   POST /api/syllabus/parse  — multipart upload (PDF or DOCX). Returns a draft
 *                                JSON object with extracted course + assignments,
 *                                NOT persisted. The user reviews/edits this in
 *                                the UI before saving.
 *   POST /api/syllabus/save   — JSON body of the (possibly edited) draft. Inserts
 *                                one new course + N new assignments under the
 *                                signed-in user's RLS scope.
 *
 * Auth: same JWT-bearer scheme as ICS routes (requireUser middleware attaches
 * `req.supabase` and `req.user`). RLS policies on `public.courses` and
 * `public.assignments` keep users from touching each other's rows.
 *
 * multer is mounted PER-ROUTE so it doesn't consume the JSON body on /save or
 * any other route in the app.
 */
import { Router } from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import { requireUser } from './supabase-auth.js'
import { syllabusParseRateLimit } from './rate-limit.js'
import { extractText } from './syllabus-extract.js'
import { extractSyllabus } from './syllabus-claude.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5 MB cap
})

const COURSE_NAME_MAX = 200
const ASSIGNMENT_NAME_MAX = 300
const DESCRIPTION_MAX = 4000

function nowIso() {
  return new Date().toISOString()
}

function parseDueAt(input) {
  if (input === null || input === undefined || input === '') return null
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid due date "${input}" — must be a parseable ISO 8601 string or null.`)
  }
  return d.toISOString()
}

function clip(value, max) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s) return null
  return s.length > max ? s.slice(0, max) : s
}

/**
 * POST /api/syllabus/parse — upload + parse, returns the draft for review.
 * The file never touches disk and is not persisted in Supabase Storage; we
 * keep only the extracted JSON, which is much smaller and easier to redact.
 */
router.post('/api/syllabus/parse', requireUser, syllabusParseRateLimit, (req, res, next) => {
  upload.single('file')(req, res, (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'File is too large. Max size is 5 MB.' })
      }
      return res.status(400).json({ success: false, error: uploadErr.message || 'Upload failed' })
    }
    next()
  })
}, async (req, res) => {
  const file = req.file
  if (!file?.buffer?.length) {
    return res.status(400).json({ success: false, error: 'No file uploaded. Attach a .pdf or .docx file under the "file" field.' })
  }

  let extracted
  try {
    extracted = await extractText(file.buffer, file.mimetype, file.originalname)
  } catch (e) {
    return res.status(422).json({ success: false, error: e?.message || 'Could not read the file.' })
  }

  let draft
  try {
    draft = await extractSyllabus(extracted.text)
  } catch (e) {
    const code = e?.code
    if (code === 'NO_API_KEY' || code === 'BAD_API_KEY') {
      return res.status(500).json({ success: false, error: e.message })
    }
    if (code === 'RATE_LIMITED') {
      return res.status(503).json({ success: false, error: e.message })
    }
    if (code === 'BAD_REQUEST') {
      return res.status(422).json({ success: false, error: e.message })
    }
    return res.status(500).json({ success: false, error: e?.message || 'Syllabus extraction failed.' })
  }

  res.json({
    success: true,
    draft,
    meta: {
      textLength: extracted.text.length,
      truncated: extracted.truncated,
      assignmentCount: draft.assignments.length,
    },
  })
})

/**
 * POST /api/syllabus/save — persist the user-confirmed draft.
 * Each save creates a NEW course row (and N assignment rows) — we never merge
 * into an existing course, per the product decision to keep things simple.
 * The fresh `external_course_id` guarantees no collision with prior saves.
 */
router.post('/api/syllabus/save', requireUser, async (req, res) => {
  const draft = req.body || {}

  // ---- Validate course ----
  const courseName = clip(draft?.course?.name, COURSE_NAME_MAX)
  if (!courseName) {
    return res.status(400).json({ success: false, error: 'course.name is required.' })
  }
  const courseCode = clip(draft?.course?.code, 50)
  const courseTerm = clip(draft?.course?.term, 100)
  const courseInstructor = clip(draft?.course?.instructor, 200)

  // ---- Validate assignments ----
  const rawAssignments = Array.isArray(draft?.assignments) ? draft.assignments : []
  const cleaned = []
  for (let i = 0; i < rawAssignments.length; i++) {
    const a = rawAssignments[i] || {}
    const name = clip(a.name, ASSIGNMENT_NAME_MAX)
    if (!name) {
      return res.status(400).json({
        success: false,
        error: `assignments[${i}].name is required.`,
      })
    }
    let dueAt
    try {
      dueAt = parseDueAt(a.dueAt)
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `assignments[${i}]: ${e.message}`,
      })
    }
    cleaned.push({
      name,
      dueAt,
      description: clip(a.description, DESCRIPTION_MAX),
    })
  }

  // ---- Insert course ----
  const courseExternalId = `syllabus:${crypto.randomUUID()}`
  const ts = nowIso()
  const { data: insertedCourse, error: courseErr } = await req.supabase
    .from('courses')
    .insert({
      user_id: req.user.id,
      source: 'syllabus',
      external_course_id: courseExternalId,
      course_name: courseName,
      code: courseCode,
      term: courseTerm,
      professor_name: courseInstructor,
    })
    .select('id')
    .single()

  if (courseErr) {
    return res.status(500).json({
      success: false,
      error: `courses insert: ${courseErr.message}`,
      details: courseErr.details || null,
      hint: courseErr.hint || null,
      code: courseErr.code || null,
    })
  }
  if (!insertedCourse?.id) {
    return res.status(500).json({
      success: false,
      error: 'courses insert returned no row (RLS or constraint).',
    })
  }
  const courseId = insertedCourse.id

  // ---- Insert assignments (only when due_at is present — column is NOT NULL) ----
  const insertableRows = cleaned
    .map((a, idx) => ({ a, idx }))
    .filter(({ a }) => a.dueAt !== null)

  const skipped = cleaned.length - insertableRows.length
  let assignmentsInserted = 0

  if (insertableRows.length > 0) {
    const rows = insertableRows.map(({ a, idx }) => ({
      user_id: req.user.id,
      course_id: courseId,
      assignment_name: a.name,
      due_at: a.dueAt,
      description: a.description || null,
      import_source: 'syllabus',
      external_assignment_id: `${courseExternalId}:${idx}`,
      last_seen_at: ts,
    }))

    const { data: insertedRows, error: insErr } = await req.supabase
      .from('assignments')
      .insert(rows)
      .select('id')

    if (insErr) {
      // Course is already in — surface the error but don't try to roll back.
      // The user can edit the course on the assignments page or re-run save
      // for the missing items.
      return res.status(500).json({
        success: false,
        error: `assignments insert: ${insErr.message}`,
        courseId,
        details: insErr.details || null,
        hint: insErr.hint || null,
        code: insErr.code || null,
      })
    }
    assignmentsInserted = insertedRows?.length || 0
  }

  res.json({
    success: true,
    courseId,
    assignmentsInserted,
    assignmentsSkipped: skipped, // entries with null due dates couldn't be saved
  })
})

export default router
