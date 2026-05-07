import 'dotenv/config'
import express from 'express'
import cors from 'cors'
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
  isCanvasOAuthConfigured,
  createOAuthStart,
  consumeOAuthState,
  exchangeAuthorizationCode,
  createServerSession,
  getServerSession,
  revokeServerSession,
  syncCanvasData,
  normalizeCanvasBaseUrl
} from './canvas-lms.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
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
      alsoOpenedInDefaultBrowser: result.alsoOpenedInDefaultBrowser
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
// CANVAS LMS (OAuth2 + API proxy)
// ============================================

app.get('/api/canvas/config', (req, res) => {
  res.json({
    success: true,
    oauthConfigured: isCanvasOAuthConfigured()
  })
})

app.post('/api/canvas/oauth/start', (req, res) => {
  const { canvasBaseUrl } = req.body || {}
  if (!canvasBaseUrl) {
    return res.status(400).json({ success: false, error: 'canvasBaseUrl is required' })
  }
  try {
    const { authUrl, state } = createOAuthStart(canvasBaseUrl)
    res.json({ success: true, authUrl, state })
  } catch (e) {
    console.error('[Canvas] oauth/start:', e)
    res.status(500).json({ success: false, error: e.message || 'Failed to start Canvas OAuth' })
  }
})

app.get('/api/canvas/oauth/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const redirect = (path) => {
    res.redirect(302, `${frontendUrl}${path}`)
  }

  if (error) {
    const msg = encodeURIComponent(String(errorDescription || error))
    return redirect(`/profile?canvas_oauth=error&message=${msg}`)
  }

  if (!code || !state) {
    return redirect('/profile?canvas_oauth=error&message=missing_code_or_state')
  }

  const pending = consumeOAuthState(String(state))
  if (!pending) {
    return redirect('/profile?canvas_oauth=error&message=invalid_or_expired_state')
  }

  try {
    const { accessToken } = await exchangeAuthorizationCode(pending.baseUrl, String(code))
    const sessionId = createServerSession(pending.baseUrl, accessToken)
    return redirect(`/profile?canvas_oauth=success&canvas_sid=${encodeURIComponent(sessionId)}`)
  } catch (e) {
    console.error('[Canvas] oauth/callback:', e)
    const msg = encodeURIComponent(e.message || 'token_exchange_failed')
    return redirect(`/profile?canvas_oauth=error&message=${msg}`)
  }
})

app.post('/api/canvas/sync', async (req, res) => {
  const { sessionId } = req.body || {}
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' })
  }
  const session = getServerSession(String(sessionId))
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired Canvas session. Connect Canvas again.'
    })
  }
  try {
    const data = await syncCanvasData(session.baseUrl, session.accessToken)
    res.json({ success: true, data })
  } catch (e) {
    console.error('[Canvas] sync:', e)
    res.status(500).json({ success: false, error: e.message || 'Canvas sync failed' })
  }
})

/** Sync using a personal access token (no OAuth). Keeps token off browser→Canvas CORS issues. */
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

app.post('/api/canvas/session/revoke', (req, res) => {
  const { sessionId } = req.body || {}
  if (sessionId) revokeServerSession(String(sessionId))
  res.json({ success: true })
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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

app.listen(PORT, () => {
  console.log(`Blackboard scraper server running on http://localhost:${PORT}`)
  console.log('Endpoints:')
  console.log('  POST /api/blackboard/start-session - Start SSO login session')
  console.log('  GET  /api/blackboard/check-login/:sessionId - Check if logged in')
  console.log('  POST /api/blackboard/sync-session/:sessionId - Sync after login')
  console.log('  POST /api/blackboard/close-session/:sessionId - Close session')
  console.log('Canvas LMS:')
  console.log('  POST /api/canvas/start-session — Playwright login (browser)')
  console.log('  GET  /api/canvas/check-login/:sessionId')
  console.log('  POST /api/canvas/sync-session/:sessionId')
  console.log('  POST /api/canvas/close-session/:sessionId')
  console.log('  GET  /api/canvas/config (OAuth/API optional)')
  console.log('  POST /api/canvas/oauth/start')
  console.log('  GET  /api/canvas/oauth/callback')
  console.log('  POST /api/canvas/sync')
  console.log('  POST /api/canvas/sync-token')
})
