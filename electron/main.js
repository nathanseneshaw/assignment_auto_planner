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

// Right-click menu for editable fields. Chromium's native spellchecker runs
// automatically on <input>/<textarea>/contenteditable (red squiggles), but the
// actionable part — swapping in a suggestion — is surfaced through the
// `context-menu` event's params, and Electron draws no default menu once
// `Menu.setApplicationMenu(null)` has removed the app menu. So we build one:
// spelling suggestions + "Add to dictionary" for misspellings, plus the
// standard clipboard actions for any editable field or text selection.
function installContextMenu(win) {
  win.webContents.on('context-menu', (event, params) => {
    const { misspelledWord, dictionarySuggestions, isEditable, editFlags, selectionText } = params
    const template = []

    if (misspelledWord) {
      if (dictionarySuggestions.length > 0) {
        for (const suggestion of dictionarySuggestions) {
          template.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          })
        }
      } else {
        template.push({ label: 'No suggestions', enabled: false })
      }
      template.push(
        { type: 'separator' },
        {
          label: 'Add to dictionary',
          click: () => session.defaultSession.addWordToSpellCheckerDictionary(misspelledWord),
        },
        { type: 'separator' },
      )
    }

    // Clipboard actions when there's something to act on (an editable field, or
    // a plain-text selection the user might want to copy).
    if (isEditable || selectionText) {
      template.push(
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
      )
      if (isEditable) {
        template.push({ role: 'selectAll', enabled: editFlags.canSelectAll })
      }
    }

    if (template.length === 0) return
    Menu.buildFromTemplate(template).popup({ window: win })
  })
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
    // Native-look title bar: hide the caption bar but let the OS draw the real
    // Windows min/max/close buttons as an overlay in the top-right (same setup
    // as the Claude desktop app). The renderer paints the bar itself as a plain
    // drag region (see TitleBar.vue) and re-tints the overlay on theme change
    // via the window:setTitleBarOverlay IPC below. Keeps all standard frame
    // behaviors — resize, Aero Snap, drop shadow, Win11 rounded corners.
    // `backgroundColor` matches light paper to avoid a white flash on load.
    titleBarStyle: 'hidden',
    // On macOS color/symbolColor are ignored (the OS draws native traffic
    // lights top-left instead); `height` still applies and vertically centers
    // the traffic lights in the strip. The renderer shifts the sidebar logo
    // below them via the .is-mac rules in src/style.css.
    titleBarOverlay: {
      color: '#e9e6dd', // --color-paper; renderer re-tints for dark mode
      symbolColor: '#1c1917', // --color-gray-900
      height: 48, // keep in sync with --titlebar-h in src/style.css
    },
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
      // Chromium's native spellchecker (red squiggles on misspelled words in
      // editable fields). On by default, but set explicitly so the intent is
      // clear; the actionable suggestions come from installContextMenu below.
      spellcheck: true,
    },
  })

  installNavigationGuards(win)
  installContextMenu(win)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Re-tint the native window-controls overlay when the renderer's theme
// changes (light/dark). Colors are validated to plain hex so a compromised
// renderer can't feed setTitleBarOverlay something that throws.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
ipcMain.handle('window:setTitleBarOverlay', (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  // setTitleBarOverlay only exists where the overlay does (Windows/Linux).
  if (!win || typeof win.setTitleBarOverlay !== 'function') return
  const color = typeof opts?.color === 'string' && HEX_COLOR.test(opts.color) ? opts.color : null
  const symbolColor =
    typeof opts?.symbolColor === 'string' && HEX_COLOR.test(opts.symbolColor) ? opts.symbolColor : null
  if (!color || !symbolColor) return
  try {
    win.setTitleBarOverlay({ color, symbolColor })
  } catch (err) {
    logger.warn('setTitleBarOverlay failed:', err)
  }
})

app.whenReady().then(() => {
  installResponseHooks()

  // Spellchecker dictionary. On Windows/Linux this drives Hunspell (dictionary
  // is fetched once from Google's CDN by the network process, so the renderer
  // CSP doesn't apply); on macOS the OS spellchecker is used and this is a
  // no-op. Guarded because setSpellCheckerLanguages doesn't exist on macOS.
  if (typeof session.defaultSession.setSpellCheckerLanguages === 'function') {
    try {
      session.defaultSession.setSpellCheckerLanguages(['en-US'])
    } catch (err) {
      logger.warn('setSpellCheckerLanguages failed:', err)
    }
  }

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
