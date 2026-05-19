// CommonJS entry: Electron 34 ships Node 20, whose ESM loader has a known
// bug (electron/electron#40719) — `cjsPreparseModuleExports` crashes on
// certain transitive CJS deps when the entry is ESM. Staying on CJS for the
// main process sidesteps it entirely. Renderer code stays ESM (it runs in
// Chromium, not Node's loader).
const { app, BrowserWindow } = require('electron')
const path = require('path')

const isDev = process.env.ELECTRON_DEV === 'true'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// UTD scraping used to live here as IPC because CourseBook is reCAPTCHA-gated
// and only a real Chrome could mint a v3 token. The Express server now runs
// Playwright + stealth for that, so UTD goes through the same /api/course-planner
// endpoints as every other school — no Electron-specific bridge needed.

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
