import { app, BrowserWindow, Menu, session, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath, URL } from 'url'
import logger from './logger.js'
import { initAutoUpdater } from './updater.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.ELECTRON_DEV === 'true'

// Render-hosted API the desktop renderer talks to. Must stay in sync with
// VITE_API_BASE in package.json's electron:build script — used for the CSP
// connect-src allowlist and to scope the response-header CORS bypass below.
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

function buildCspPolicy() {
  const baseConnect = `'self' ${API_ORIGIN} https://*.supabase.co wss://*.supabase.co`
  const devConnect = `${baseConnect} http://localhost:5173 ws://localhost:5173`
  const scriptSrc = isDev ? "'self' 'unsafe-eval'" : "'self'"
  const connectSrc = isDev ? devConnect : baseConnect

  return [
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
}

const CSP_POLICY = buildCspPolicy()

// Single `onHeadersReceived` listener — Electron only fires the most-recently
// registered one, so CSP injection and the API CORS bypass have to share it.
// Two reasons we override the response Access-Control-Allow-Origin header
// instead of doing anything on the request side:
//
//   1. The renderer loads from http://localhost:5173 (dev) or file:// (prod).
//      Neither is in Render's CORS allowlist for the web frontend, and the
//      file:// case can't be safely allowed at all.
//   2. Since Chromium 79 (OOR-CORS, "Network Service CORS"), Chromium's CORS
//      validator compares the response ACAO against the renderer's *real*
//      committed origin, not whatever an onBeforeSendHeaders hook writes
//      into the request. Rewriting Origin client-side is a no-op for CORS.
//
// Returning ACAO: * here is safe for our use case because we authenticate
// with `Authorization: Bearer <jwt>` (not cookies), so the credentialed-
// request restriction on wildcard origins doesn't apply.
function installResponseHooks() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    responseHeaders['Content-Security-Policy'] = [CSP_POLICY]

    try {
      const u = new URL(details.url)
      if (`${u.protocol}//${u.host}` === API_ORIGIN) {
        for (const key of Object.keys(responseHeaders)) {
          const k = key.toLowerCase()
          if (
            k === 'access-control-allow-origin' ||
            k === 'access-control-allow-methods' ||
            k === 'access-control-allow-headers' ||
            k === 'access-control-allow-credentials'
          ) {
            delete responseHeaders[key]
          }
        }
        responseHeaders['Access-Control-Allow-Origin'] = ['*']
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD']
        responseHeaders['Access-Control-Allow-Headers'] = ['Content-Type, Authorization']
      }
    } catch {
      // Non-URL response (rare); leave headers as-is beyond the CSP injection.
    }

    callback({ responseHeaders })
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
    // Custom title bar: hide the native caption bar (and its buttons) while
    // keeping the standard window frame behaviors — resize, Aero Snap, drop
    // shadow, Win11 rounded corners. We draw our own min/max/close buttons in
    // the renderer (see TitleBar.vue), wired through the window:* IPC below.
    // `backgroundColor` matches light paper to avoid a white flash on load.
    titleBarStyle: 'hidden',
    backgroundColor: '#f4f1e8',
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

  // Keep the renderer's maximize/restore button icon in sync when the window is
  // maximized by any means (our button, double-click on the bar, Aero Snap).
  const sendMaxState = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized())
  }
  win.on('maximize', sendMaxState)
  win.on('unmaximize', sendMaxState)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Custom title-bar window controls, driven by the renderer's TitleBar.vue.
// Each resolves the calling window from its WebContents so it stays correct
// even if a second window is ever opened.
ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('window:toggleMaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})
ipcMain.handle('window:isMaximized', (event) => {
  return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized())
})

app.whenReady().then(() => {
  installResponseHooks()

  Menu.setApplicationMenu(null)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Check GitHub Releases for a newer version and update in the background.
  // No-op in dev / unpacked builds (see updater.js).
  initAutoUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
