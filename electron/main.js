import { app, BrowserWindow, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'
import { startServer, stopServer } from './server-process.js'
import logger, { getLogPath } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.ELECTRON_DEV === 'true'

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason)
})

/**
 * Parse a .env-style file and apply any keys that aren't already in process.env.
 * Used to inject Supabase credentials before the Express server child is spawned
 * — the child inherits process.env, so loading these here makes them visible.
 */
function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (let line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

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

function createWindow() {
  logger.info('creating main window')
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

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
    title: 'Assignment Planner — startup error',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'error-window.html'))
  win.webContents.once('did-finish-load', () => {
    const payload = JSON.stringify({ message: String(message), logPath: getLogPath() })
    win.webContents.executeJavaScript(`window.errorInfo = ${payload}; void 0;`).catch(() => {})
  })
}

app.whenReady().then(async () => {
  // Load packaged env vars BEFORE spawning the server so the child inherits them.
  // In dev this file won't exist, which is fine — server:dev loads its own .env.
  if (app.isPackaged) {
    applyEnvFile(path.join(process.resourcesPath, 'server.env.local'))
  }

  installCsp()

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
