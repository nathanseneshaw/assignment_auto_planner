/**
 * API server entry point.
 *
 * Hosts the backend routes the Vue app talks to. All LMS-specific scraping
 * (Canvas, Blackboard) has been retired — the app now ingests assignments
 * via user-provided ICS calendar feeds only. The remaining surface is:
 *
 *   - **ICS feeds** — mounted via `icsRoutes`; authenticated with the user's
 *     Supabase JWT and using a JWT-scoped Supabase client so RLS enforces
 *     per-user isolation.
 *   - **Health** — `GET /api/health` for uptime probes.
 *
 * Env vars:
 *   - PORT, HOST            — bind address (defaults: 3001, 0.0.0.0).
 *   - ALLOWED_ORIGINS       — comma-separated CORS allowlist; empty = allow all.
 *   - FRONTEND_URL          — convenience single-origin allowlist (merged into above).
 *   - SUPABASE_URL, SUPABASE_ANON_KEY — required for ICS routes.
 */
import './load-env.js'
import express from 'express'
import cors from 'cors'
import icsRoutes from './ics-routes.js'
import coursePlannerRoutes from './course-planner-routes.js'
import syllabusRoutes from './syllabus-routes.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'

/**
 * Build the CORS allowlist by merging `ALLOWED_ORIGINS` (comma-separated) and
 * the single-origin `FRONTEND_URL` convenience var. Empty list = allow any
 * origin (intended for local development; tighten in production).
 */
function parseAllowedOrigins() {
  const fromAllowList = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const front = String(process.env.FRONTEND_URL || '').trim()
  const set = new Set(fromAllowList)
  if (front) set.add(front)
  return [...set]
}

const allowedOrigins = parseAllowedOrigins()

// Fail loudly rather than silently allowing every origin in prod. An empty
// allowlist here previously fell through to `origin: true` (any origin), which
// would let any site on the internet call the API with the user's cookies.
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error(
    'Refusing to start: NODE_ENV=production but ALLOWED_ORIGINS / FRONTEND_URL are empty. ' +
      'Set at least one allowed origin before booting.'
  )
}

// Render / fly.io / typical PaaS terminate TLS at a reverse proxy. Trusting
// the first proxy hop lets req.ip and req.protocol reflect the real client.
app.set('trust proxy', 1)

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin / curl have no Origin header — always allow.
      if (!origin) return callback(null, true)
      if (allowedOrigins.length === 0) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      callback(null, false)
    },
  })
)
// 1MB cap is generous for our payloads and small enough that a misbehaving
// client can't OOM the process.
app.use(express.json({ limit: '1mb' }))

// Abort slow requests (e.g. a hung ICS upstream) before they pin the worker.
app.use((req, res, next) => {
  req.setTimeout(30_000, () => {
    if (!res.headersSent) res.status(503).json({ success: false, error: 'Request timeout' })
  })
  next()
})

// ICS calendar feed sync — the sole assignment-ingest mechanism.
app.use(icsRoutes)

// Syllabus parser — upload a PDF/DOCX, Claude extracts the schedule, user
// confirms in the UI, then the course + assignments land in Supabase.
app.use(syllabusRoutes)

// Course planner — public on-demand scrapers for Rice / TTU / TAMU / SMU.
app.use(coursePlannerRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/', (_req, res) => {
  res.json({
    service: 'assignment-planner-api',
    health: '/api/health',
  })
})

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`API server listening on http://${HOST}:${PORT}`)
    console.log('Endpoints:')
    console.log('  GET    /api/ics/feeds                              — list ICS feeds for the signed-in user')
    console.log('  POST   /api/ics/feeds                              — add an ICS feed URL')
    console.log('  DELETE /api/ics/feeds/:id                          — remove an ICS feed (assignments are kept)')
    console.log('  POST   /api/ics/sync                               — fetch + parse + upsert one or all ICS feeds')
    console.log('  POST   /api/syllabus/parse                         — upload a syllabus (PDF/DOCX); returns extracted draft')
    console.log('  POST   /api/syllabus/save                          — persist a reviewed syllabus draft as a course + assignments')
    console.log('  GET    /api/course-planner/schools                 — list supported universities')
    console.log('  GET    /api/course-planner/:school/terms           — list terms for a school')
    console.log('  GET    /api/course-planner/:school/subjects?term=  — list subjects for a term')
    console.log('  GET    /api/course-planner/:school/sections?term=&subject=  — sections for a subject')
    console.log('  GET    /api/health                                 — health probe')
  })
}

// Surface async errors that escaped every route handler so they don't silently
// kill in-flight requests. uncaughtException means the process is in an unknown
// state — exit and let the process manager restart cleanly.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  process.exit(1)
})

export default app
