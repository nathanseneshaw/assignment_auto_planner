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
