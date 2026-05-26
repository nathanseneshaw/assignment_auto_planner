import { app, BrowserWindow, Menu, session } from 'electron'
import path from 'path'
import { fileURLToPath, URL } from 'url'
import logger from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.ELECTRON_DEV === 'true'

// Render-hosted API the desktop renderer talks to. Must stay in sync with
// VITE_API_BASE in package.json's electron:build script — `installCsp` uses
// it for connect-src and `installOriginRewrite` uses it to know which
// requests need the Origin header stripped.
const API_ORIGIN = 'https://assignment-auto-planner-server.onrender.com'

// Windows taskbar groups by AUMID and picks the icon associated with it.
// Without this, dev builds inherit electron.exe's icon. Must match build.appId.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.plannr.app')
}

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason)
})

function installCsp() {
  const baseConnect = `'self' ${API_ORIGIN} https://*.supabase.co wss://*.supabase.co`
  const devConnect = `${baseConnect} http://localhost:5173 ws://localhost:5173`
  const scriptSrc = isDev ? "'self' 'unsafe-eval'" : "'self'"
  const connectSrc = isDev ? devConnect : baseConnect

  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    // Hardening: deny plugins/embeds, prevent <base> retargeting after XSS,
    // and block form posts to off-origin endpoints.
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

// Renderer pages load from file:// (or http://localhost:5173 in dev), so
// fetches to the Render API arrive with an Origin the server allowlist
// doesn't know about. Strip the header for our API host so the server's
// "no Origin = allow (curl-style client)" branch handles desktop requests.
// Auth still requires a Supabase JWT, so this isn't an authorization bypass.
function installOriginRewrite() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const u = new URL(details.url)
      if (`${u.protocol}//${u.host}` === API_ORIGIN) {
        const headers = { ...details.requestHeaders }
        delete headers['Origin']
        delete headers['origin']
        return callback({ requestHeaders: headers })
      }
    } catch {
      // fall through — malformed URL won't match our origin anyway
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

// Allowed renderer origins. In dev the renderer is served by Vite on :5173;
// in production it loads from file://. Anything else is rejected so a
// successful XSS cannot navigate to attacker-controlled content while still
// holding the preload's `electronAPI` and the API origin's connect-src grant.
function isAllowedNavigation(targetUrl) {
  try {
    const u = new URL(targetUrl)
    if (isDev) {
      return (
        (u.protocol === 'http:' && u.hostname === 'localhost' && u.port === '5173') ||
        u.protocol === 'file:'
      )
    }
    return u.protocol === 'file:'
  } catch {
    return false
  }
}

function installNavigationGuards(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) {
      logger.warn('blocked will-navigate to', targetUrl)
      event.preventDefault()
    }
  })
  win.webContents.on('will-redirect', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) {
      logger.warn('blocked will-redirect to', targetUrl)
      event.preventDefault()
    }
  })
}

function createWindow() {
  logger.info('creating main window')
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // Runtime taskbar/window icon. `build.icon` in package.json only sets the
    // packaged-app icon resource; during `electron:dev` the BrowserWindow
    // needs this explicit option or it falls back to the default Electron icon.
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })

  installNavigationGuards(win)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  installCsp()
  installOriginRewrite()

  Menu.setApplicationMenu(null)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
