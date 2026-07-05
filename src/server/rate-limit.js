import rateLimit from 'express-rate-limit'

/**
 * Limits POST /api/syllabus/parse to 10 requests per user per hour.
 * Must be mounted AFTER requireUser so req.user.id is available.
 * Falls back to IP when req.user is somehow absent.
 */
export const syllabusParseRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: 'Syllabus parse limit reached (10 per hour). Please wait before trying again.',
      code: 'RATE_LIMITED',
    })
  },
})

/**
 * Limits POST /api/syllabus/save to 60 requests per user per hour. Saves are
 * cheap DB inserts (no LLM call), so the ceiling is looser than parse — it's
 * here to stop a runaway client or abuse from flooding the courses/assignments
 * tables. Must be mounted AFTER requireUser so req.user.id is available.
 */
export const syllabusSaveRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: 'Syllabus save limit reached (60 per hour). Please wait before trying again.',
      code: 'RATE_LIMITED',
    })
  },
})
