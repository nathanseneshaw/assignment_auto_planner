import './load-env.js'
import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'
import { BlackboardScraper } from './blackboard-scraper.js'
import {
  createPlaywrightLoginSession,
  checkPlaywrightBlackboardLogin,
  syncPlaywrightBlackboardAfterLogin,
  closePlaywrightBlackboardSession,
  getPlaywrightBlackboardSessionStatus,
  createPlaywrightCanvasLoginSession,
  checkPlaywrightCanvasLogin,
  syncPlaywrightCanvasAfterLogin,
  closePlaywrightCanvasSession,
  getPlaywrightCanvasSessionStatus,
  closeAllPlaywrightSessions
} from './playwright-scraper.js'
import {
  getSessionScreenshot,
  sendSessionInput,
} from './blackboard-sso-bridge.js'
import {
  syncCanvasData,
  normalizeCanvasBaseUrl
} from './canvas-lms.js'

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
app.use(express.json())

// ============================================
// Blackboard / Canvas — Playwright browser sessions (SSO-compatible)
// ============================================

function normalizeCdpUrl(input) {
  if (input == null || input === '') return undefined
  const t = String(input).trim()
  if (!t) return undefined
  if (/^https?:\/\//i.test(t)) return t
  if (/^\d{2,5}$/.test(t)) return `http://127.0.0.1:${t}`
  return t
}

// Start a new login session - opens browser window
app.post('/api/blackboard/start-session', async (req, res) => {
  const {
    blackboardUrl,
    useSameBrowser,
    cdpUrl: cdpFromBody,
    browserChannel: browserChannelFromBody,
    alsoOpenInDefaultBrowser
  } = req.body

  if (!blackboardUrl) {
    return res.status(400).json({
      success: false,
      error: 'Missing blackboardUrl'
    })
  }

  try {
    // Ensure URL has protocol
    let url = blackboardUrl
    if (!url.startsWith('http')) {
      url = 'https://' + url
    }

    const cdpUrl = normalizeCdpUrl(cdpFromBody)
    const wantSame =
      useSameBrowser === undefined ? false : Boolean(useSameBrowser)
    const ch = browserChannelFromBody != null && String(browserChannelFromBody).trim()
      ? String(browserChannelFromBody).trim()
      : undefined
    const alsoOpen = alsoOpenInDefaultBrowser === true

    const result = await createPlaywrightLoginSession(url, {
      useSameBrowser: wantSame,
      cdpUrl,
      browserChannel: ch,
      alsoOpenInDefaultBrowser: alsoOpen
    })
    res.json({
      success: true,
      sessionId: result.sessionId,
      message: result.message,
      blackboardUrl: result.blackboardUrl,
      attachedToExistingBrowser: result.attachedToExistingBrowser,
      launchChannel: result.launchChannel ?? null,
      alsoOpenedInDefaultBrowser: result.alsoOpenedInDefaultBrowser,
      viewport: result.viewport ?? null,
    })
  } catch (error) {
    console.error('Start session error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start browser session'
    })
  }
})

// Check if user has logged in
app.get('/api/blackboard/check-login/:sessionId', async (req, res) => {
  const { sessionId } = req.params

  try {
    const result = await checkPlaywrightBlackboardLogin(sessionId)
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    console.error('Check login error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Sync courses and assignments after login
app.post('/api/blackboard/sync-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params

  try {
    const status = getPlaywrightBlackboardSessionStatus(sessionId)
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found. Please start a new session.'
      })
    }

    console.log(`[Server] Starting sync for session ${sessionId}`)
    
    const results = await syncPlaywrightBlackboardAfterLogin(sessionId, (progress) => {
      console.log('[Server] Sync progress:', progress)
    })

    res.json({
      success: true,
      data: results,
      syncedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Sync session error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync'
    })
  }
})

// Close a session
app.post('/api/blackboard/close-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params

  try {
    await closePlaywrightBlackboardSession(sessionId)
    res.json({ success: true, message: 'Session closed' })
  } catch (error) {
    console.error('Close session error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Get session status
app.get('/api/blackboard/session-status/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  const status = getPlaywrightBlackboardSessionStatus(sessionId)
  res.json({ success: true, ...status })
})

// Stream a JPEG screenshot of the live browser session
app.get('/api/blackboard/session-screenshot/:sessionId', async (req, res) => {
  try {
    const buf = await getSessionScreenshot(req.params.sessionId)
    if (!buf) return res.status(404).json({ success: false, error: 'Session not found' })
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'no-store')
    res.send(buf)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// Relay mouse/keyboard input to the live browser session
app.post('/api/blackboard/session-input/:sessionId', async (req, res) => {
  const { type, x, y, key, text } = req.body
  try {
    const ok = await sendSessionInput(req.params.sessionId, { type, x, y, key, text })
    res.json({ success: ok })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// Canvas — embedded browser (SSO / 2FA), Playwright
app.post('/api/canvas/start-session', async (req, res) => {
  const {
    canvasUrl,
    useSameBrowser,
    cdpUrl: cdpFromBody,
    browserChannel: browserChannelFromBody,
    alsoOpenInDefaultBrowser
  } = req.body || {}
  if (!canvasUrl) {
    return res.status(400).json({ success: false, error: 'Missing canvasUrl' })
  }
  try {
    let url = String(canvasUrl).trim()
    if (!url.startsWith('http')) url = 'https://' + url
    const cdpUrl = normalizeCdpUrl(cdpFromBody)
    const wantSame = useSameBrowser === undefined ? false : Boolean(useSameBrowser)
    const ch = browserChannelFromBody != null && String(browserChannelFromBody).trim()
      ? String(browserChannelFromBody).trim()
      : undefined
    const alsoOpen = alsoOpenInDefaultBrowser === true
    const result = await createPlaywrightCanvasLoginSession(url, {
      useSameBrowser: wantSame,
      cdpUrl,
      browserChannel: ch,
      alsoOpenInDefaultBrowser: alsoOpen
    })
    res.json({
      success: true,
      sessionId: result.sessionId,
      message: result.message,
      canvasUrl: result.canvasUrl,
      canvasOrigin: result.canvasOrigin,
      attachedToExistingBrowser: result.attachedToExistingBrowser,
      launchChannel: result.launchChannel ?? null,
      alsoOpenedInDefaultBrowser: result.alsoOpenedInDefaultBrowser
    })
  } catch (error) {
    console.error('Canvas start-session error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start Canvas browser session'
    })
  }
})

app.get('/api/canvas/check-login/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    const result = await checkPlaywrightCanvasLogin(sessionId)
    res.json({ success: true, ...result })
  } catch (error) {
    console.error('Canvas check-login error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post('/api/canvas/sync-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    const status = getPlaywrightCanvasSessionStatus(sessionId)
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: 'Session not found. Start a new Canvas sync from the profile page.'
      })
    }
    const results = await syncPlaywrightCanvasAfterLogin(sessionId, (progress) => {
      console.log('[Server] Canvas sync progress:', progress)
    })
    res.json({
      success: true,
      data: results,
      syncedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Canvas sync-session error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Canvas sync failed'
    })
  }
})

app.post('/api/canvas/close-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  try {
    await closePlaywrightCanvasSession(sessionId)
    res.json({ success: true, message: 'Session closed' })
  } catch (error) {
    console.error('Canvas close-session error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/canvas/browser-session-status/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const status = getPlaywrightCanvasSessionStatus(sessionId)
  res.json({ success: true, ...status })
})

// ============================================
// DIRECT LOGIN ENDPOINTS (non-SSO)
// ============================================

app.post('/api/blackboard/login', async (req, res) => {
  const { baseUrl, username, password } = req.body

  if (!baseUrl || !username || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: baseUrl, username, password' 
    })
  }

  try {
    const scraper = new BlackboardScraper(baseUrl, username, password)
    const loginResult = await scraper.login()
    
    if (loginResult.success) {
      res.json({ 
        success: true, 
        message: 'Login successful',
        sessionId: scraper.getSessionId()
      })
    } else {
      res.status(401).json({ 
        success: false, 
        error: loginResult.error || 'Login failed. Check your credentials.' 
      })
    }
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Failed to connect to Blackboard. Please check the URL.' 
    })
  }
})

app.post('/api/blackboard/course', async (req, res) => {
  const { baseUrl, username, password } = req.body

  if (!baseUrl || !username || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing credentials' 
    })
  }

  try {
    const scraper = new BlackboardScraper(baseUrl, username, password)
    const loginResult = await scraper.login()
    
    if (!loginResult.success) {
      return res.status(401).json({ 
        success: false, 
        error: 'Login failed' 
      })
    }

    const courses = await scraper.getCourses()
    res.json({ success: true, courses })
  } catch (error) {
    console.error('Get courses error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch courses' 
    })
  }
})

app.post('/api/blackboard/sync', async (req, res) => {
  const { baseUrl, username, password, courseIds } = req.body

  if (!baseUrl || !username || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing credentials' 
    })
  }

  try {
    const scraper = new BlackboardScraper(baseUrl, username, password)
    const loginResult = await scraper.login()
    
    if (!loginResult.success) {
      return res.status(401).json({ 
        success: false, 
        error: 'Login failed' 
      })
    }

    const allCourses = await scraper.getCourses()
    
    const coursesToSync = courseIds && courseIds.length > 0
      ? allCourses.filter(c => courseIds.includes(c.id))
      : allCourses

    const results = {
      courses: [],
      assignments: []
    }

    for (const course of coursesToSync) {
      results.courses.push({
        id: course.id,
        name: course.name,
        code: course.code,
        term: course.term,
        blackboardId: course.id
      })

      try {
        const assignments = await scraper.getCourseAssignments(course.id)
        for (const assignment of assignments) {
          results.assignments.push({
            ...assignment,
            courseId: course.id,
            courseName: course.name
          })
        }
      } catch (err) {
        console.error(`Failed to get assignments for course ${course.name}:`, err)
      }
    }

    res.json({ 
      success: true, 
      data: results,
      syncedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Sync error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Failed to sync with Blackboard' 
    })
  }
})

// ============================================
// CANVAS LMS (API sync — browser session + optional token)
// ============================================

app.post('/api/canvas/sync-token', async (req, res) => {
  const { canvasBaseUrl, accessToken } = req.body || {}
  if (!canvasBaseUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'canvasBaseUrl and accessToken are required'
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

// Test a CDP connection to a user-supplied browser tunnel
app.post('/api/cdp/test', async (req, res) => {
  const { cdpUrl } = req.body || {}
  if (!cdpUrl || typeof cdpUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'cdpUrl required' })
  }
  let browser
  try {
    browser = await chromium.connectOverCDP(cdpUrl)
    const version = browser.version()
    await browser.close().catch(() => {})
    res.json({ success: true, version })
  } catch (e) {
    if (browser) await browser.close().catch(() => {})
    res.status(502).json({ success: false, error: e.message })
  }
})

// Health check (Render / load balancers)
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
    console.log(`${signal}: closing LMS browser sessions…`)
    await closeAllPlaywrightSessions().catch(() => {})
    process.exit(0)
  })()
}

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT')
})
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM')
})

app.listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST}:${PORT}`)
  console.log('Endpoints:')
  console.log('  POST /api/blackboard/start-session - Start SSO login session')
  console.log('  GET  /api/blackboard/check-login/:sessionId - Check if logged in')
  console.log('  POST /api/blackboard/sync-session/:sessionId - Sync after login')
  console.log('  POST /api/blackboard/close-session/:sessionId - Close session')
  console.log('Canvas LMS (browser + token):')
  console.log('  POST /api/canvas/start-session — Playwright login (browser)')
  console.log('  GET  /api/canvas/check-login/:sessionId')
  console.log('  POST /api/canvas/sync-session/:sessionId')
  console.log('  POST /api/canvas/close-session/:sessionId')
  console.log('  POST /api/canvas/sync-token')
})
