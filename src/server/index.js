import './load-env.js'
import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { BlackboardScraper } from './blackboard-scraper.js'
import { BlackboardHttpSession } from './blackboard-http-session.js'
import {
  registerBlackboardHttpSession,
  syncBlackboardHttpSession,
  closeBlackboardHttpSession,
  getBlackboardHttpSessionStatus,
} from './blackboard-http-manager.js'
import {
  registerCanvasHttpCookieSession,
  syncCanvasBrowserCookieSession,
  scrapeCanvasBrowserSessionToZip,
  closeCanvasBrowserSession,
  getCanvasBrowserSessionStatus,
  closeAllCanvasBrowserSessions,
} from './canvas-browser-bridge.js'
import {
  syncCanvasData,
  normalizeCanvasBaseUrl,
  verifyCanvasCookieSession,
} from './canvas-lms.js'
import icsRoutes from './ics-routes.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'

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

app.set('trust proxy', 1)

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      if (allowedOrigins.length === 0) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      callback(null, false)
    },
  })
)
app.use(express.json({ limit: '1mb' }))

// ICS calendar feed sync (replaces LMS scraping for new users).
app.use(icsRoutes)

function normalizeUrl(input) {
  let url = String(input || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  return url
}

// ============================================
// Cookie import — Blackboard / Canvas (called by the browser extension)
// ============================================

app.post('/api/blackboard/import-cookies', async (req, res) => {
  const { url, cookies } = req.body || {}
  if (!url || !Array.isArray(cookies)) {
    return res.status(400).json({ success: false, error: 'url and cookies required' })
  }
  try {
    const blackboardUrl = normalizeUrl(url)
    const sessionId = randomUUID()
    const client = new BlackboardHttpSession({
      entryUrl: blackboardUrl,
      username: '',
      password: '',
    })
    await client.applyPlaywrightCookies(cookies)
    const ok = await client.verifyCookieSession()
    if (!ok) {
      return res.status(401).json({
        success: false,
        error: 'Cookies are not a valid Blackboard session. Make sure you are logged in.',
      })
    }
    registerBlackboardHttpSession(sessionId, client, blackboardUrl)
    res.json({ success: true, sessionId, blackboardUrl })
  } catch (e) {
    console.error('[Blackboard] import-cookies:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/canvas/import-cookies', async (req, res) => {
  const { url, cookies } = req.body || {}
  if (!url || !Array.isArray(cookies)) {
    return res.status(400).json({ success: false, error: 'url and cookies required' })
  }
  try {
    const baseUrl = normalizeCanvasBaseUrl(url)
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const ok = await verifyCanvasCookieSession(baseUrl, cookieHeader)
    if (!ok) {
      return res.status(401).json({
        success: false,
        error: 'Cookies are not a valid Canvas session. Make sure you are logged in.',
      })
    }
    const sessionId = randomUUID()
    registerCanvasHttpCookieSession(sessionId, baseUrl, cookieHeader)
    res.json({ success: true, sessionId, canvasUrl: baseUrl })
  } catch (e) {
    console.error('[Canvas] import-cookies:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ============================================
// Sync (after a session has been registered via import-cookies)
// ============================================

app.post('/api/blackboard/sync-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    const status = getBlackboardHttpSessionStatus(sessionId)
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found. Sync your cookies again from the extension.',
      })
    }
    const results = await syncBlackboardHttpSession(sessionId, (progress) => {
      console.log('[Server] Blackboard sync progress:', progress)
    })
    res.json({
      success: true,
      data: results,
      syncedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Sync session error:', error)
    res.status(500).json({ success: false, error: error.message || 'Failed to sync' })
  }
})

app.post('/api/blackboard/close-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    closeBlackboardHttpSession(sessionId)
    res.json({ success: true, message: 'Session closed' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/blackboard/session-status/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  const status = getBlackboardHttpSessionStatus(sessionId)
  res.json({ success: true, ...status })
})

app.post('/api/canvas/sync-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    const status = getCanvasBrowserSessionStatus(sessionId)
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found. Sync your cookies again from the extension.',
      })
    }
    const results = await syncCanvasBrowserCookieSession(sessionId, (progress) => {
      console.log('[Server] Canvas sync progress:', progress)
    })
    res.json({
      success: true,
      data: results,
      syncedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Canvas sync-session error:', error)
    res
      .status(500)
      .json({ success: false, error: error.message || 'Canvas sync failed' })
  }
})

app.post('/api/canvas/close-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    await closeCanvasBrowserSession(sessionId)
    res.json({ success: true, message: 'Session closed' })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/canvas/browser-session-status/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const status = getCanvasBrowserSessionStatus(sessionId)
  res.json({ success: true, ...status })
})

app.post('/api/canvas/scrape-files/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    await scrapeCanvasBrowserSessionToZip(res, sessionId, req.body || {})
  } catch (error) {
    console.error('Canvas scrape-files error:', error)
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message || 'ZIP scrape failed' })
    }
  }
})

// ============================================
// DIRECT LOGIN ENDPOINTS (non-SSO Blackboard)
// ============================================

app.post('/api/blackboard/login', async (req, res) => {
  const { baseUrl, username, password } = req.body
  if (!baseUrl || !username || !password) {
    return res
      .status(400)
      .json({ success: false, error: 'Missing required fields: baseUrl, username, password' })
  }
  try {
    const scraper = new BlackboardScraper(baseUrl, username, password)
    const loginResult = await scraper.login()
    if (loginResult.success) {
      res.json({
        success: true,
        message: 'Login successful',
        sessionId: scraper.getSessionId(),
      })
    } else {
      res.status(401).json({
        success: false,
        error: loginResult.error || 'Login failed. Check your credentials.',
      })
    }
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to connect to Blackboard. Please check the URL.',
    })
  }
})

app.post('/api/blackboard/course', async (req, res) => {
  const { baseUrl, username, password } = req.body
  if (!baseUrl || !username || !password) {
    return res.status(400).json({ success: false, error: 'Missing credentials' })
  }
  try {
    const scraper = new BlackboardScraper(baseUrl, username, password)
    const loginResult = await scraper.login()
    if (!loginResult.success) {
      return res.status(401).json({ success: false, error: 'Login failed' })
    }
    const courses = await scraper.getCourses()
    res.json({ success: true, courses })
  } catch (error) {
    console.error('Get courses error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch courses' })
  }
})

app.post('/api/blackboard/sync', async (req, res) => {
  const { baseUrl, username, password, courseIds } = req.body
  if (!baseUrl || !username || !password) {
    return res.status(400).json({ success: false, error: 'Missing credentials' })
  }
  try {
    const scraper = new BlackboardScraper(baseUrl, username, password)
    const loginResult = await scraper.login()
    if (!loginResult.success) {
      return res.status(401).json({ success: false, error: 'Login failed' })
    }
    const allCourses = await scraper.getCourses()
    const coursesToSync =
      courseIds && courseIds.length > 0
        ? allCourses.filter((c) => courseIds.includes(c.id))
        : allCourses
    const results = { courses: [], assignments: [] }
    for (const course of coursesToSync) {
      results.courses.push({
        id: course.id,
        name: course.name,
        code: course.code,
        term: course.term,
        blackboardId: course.id,
      })
      try {
        const assignments = await scraper.getCourseAssignments(course.id)
        for (const assignment of assignments) {
          results.assignments.push({
            ...assignment,
            courseId: course.id,
            courseName: course.name,
          })
        }
      } catch (err) {
        console.error(`Failed to get assignments for course ${course.name}:`, err)
      }
    }
    res.json({ success: true, data: results, syncedAt: new Date().toISOString() })
  } catch (error) {
    console.error('Sync error:', error)
    res.status(500).json({ success: false, error: 'Failed to sync with Blackboard' })
  }
})

// ============================================
// Canvas API token sync (no browser involved)
// ============================================

app.post('/api/canvas/sync-token', async (req, res) => {
  const { canvasBaseUrl, accessToken } = req.body || {}
  if (!canvasBaseUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'canvasBaseUrl and accessToken are required',
    })
  }
  try {
    const baseUrl = normalizeCanvasBaseUrl(canvasBaseUrl)
    const data = await syncCanvasData(baseUrl, String(accessToken).trim())
    res.json({ success: true, data })
  } catch (e) {
    console.error('[Canvas] sync-token:', e)
    res.status(500).json({ success: false, error: e.message || 'Canvas sync failed' })
  }
})

// ============================================
// Health / root
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/', (_req, res) => {
  res.json({
    service: 'assignment-planner-api',
    health: '/api/health',
  })
})

function gracefulShutdown(signal) {
  void (async () => {
    console.log(`${signal}: closing LMS sessions…`)
    await closeAllCanvasBrowserSessions().catch(() => {})
    process.exit(0)
  })()
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

app.listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST}:${PORT}`)
  console.log('Endpoints:')
  console.log('  POST /api/blackboard/import-cookies — Receive cookies from extension')
  console.log('  POST /api/blackboard/sync-session/:sessionId — Sync after import')
  console.log('  POST /api/blackboard/close-session/:sessionId')
  console.log('  POST /api/canvas/import-cookies — Receive cookies from extension')
  console.log('  POST /api/canvas/sync-session/:sessionId — Sync after import')
  console.log('  POST /api/canvas/close-session/:sessionId')
  console.log('  POST /api/canvas/scrape-files/:sessionId — Stream ZIP of Canvas files')
  console.log('  POST /api/canvas/sync-token — Token-based Canvas sync (no browser)')
  console.log('  POST /api/blackboard/login|course|sync — Direct credentials login (non-SSO)')
  console.log('  GET  /api/ics/feeds — list ICS feeds for the signed-in user')
  console.log('  POST /api/ics/feeds — add an ICS feed URL')
  console.log('  DELETE /api/ics/feeds/:id — remove an ICS feed (assignments are kept)')
  console.log('  POST /api/ics/sync — fetch + parse + upsert one or all ICS feeds')
})
