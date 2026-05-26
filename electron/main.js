import { app, BrowserWindow, Menu, session } from 'electron'
import path from 'path'
import { fileURLToPath, URL } from 'url'
import { startServer, stopServer } from './server-process.js'
import logger, { getLogPath } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.ELECTRON_DEV === 'true'

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
  const baseConnect = "'self' http://127.0.0.1:3001 https://*.supabase.co wss://*.supabase.co"
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

// Allowed renderer origins. In dev the renderer is served by Vite on :5173;
// in production it loads from file://. Anything else is rejected so a
// successful XSS cannot navigate to attacker-controlled content while still
// holding the preload's `electronAPI` and the loopback connect-src grant.
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

function showErrorWindow(message) {
  logger.error('showing startup error window:', message)
  const win = new BrowserWindow({
    width: 640,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Plannr — startup error',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  installNavigationGuards(win)
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'error-window.html'))
  win.webContents.once('did-finish-load', () => {
    const payload = JSON.stringify({ message: String(message), logPath: getLogPath() })
    win.webContents.executeJavaScript(`window.errorInfo = ${payload}; void 0;`).catch(() => {})
  })
}

app.whenReady().then(async () => {
  // Supabase anon creds for the embedded server are baked into the bundle at
  // build time (see electron/scripts/generate-server-env.js → src/server/env.generated.js).
  // No runtime env file to load.
  installCsp()

  Menu.setApplicationMenu(null)

  try {
    await startServer()
  } catch (err) {
    logger.error('Failed to start embedded server:', err)
    const msg = err && err.stack ? err.stack : (err && err.message) || String(err)
    showErrorWindow(msg)
    return
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopServer()
})

app.on('window-all-closed', () => {
  stopServer()
  if (process.platform !== 'darwin') app.quit()
})
