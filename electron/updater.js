// Auto-update wiring for the packaged desktop app.
//
// Checking is driven by the MAIN process on launch and on an interval, so
// updates are detected regardless of sign-in state or which screen is open
// (no need to log out and back in). State is broadcast to the renderer, and the
// in-app "Update Available" button in the top bar surfaces it while signed in.
// There is intentionally NO native OS dialog — the alert lives in the app UI,
// so nothing pops on the login screen.
//
// electron-updater ships as CommonJS, so under our ESM setup we default-import
// and destructure rather than `import { autoUpdater }`.
import electronUpdater from 'electron-updater'
import { app, ipcMain, BrowserWindow } from 'electron'
import logger from './logger.js'

const { autoUpdater } = electronUpdater

const updaterLogger = {
  info: (m) => logger.info('autoUpdater:', m),
  warn: (m) => logger.warn('autoUpdater:', m),
  error: (m) => logger.error('autoUpdater:', m),
  debug: (m) => logger.info('autoUpdater:', m),
}

// How often to re-check while the app stays open.
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let lastState = { status: 'idle' }

function broadcast(payload) {
  lastState = payload
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('updates:event', payload)
    }
  }
}

function startDownload() {
  broadcast({ status: 'downloading', percent: 0 })
  autoUpdater.downloadUpdate().catch((e) => {
    logger.error('autoUpdater: downloadUpdate failed', e)
    broadcast({ status: 'error', message: String(e?.message || e) })
  })
}

function check() {
  autoUpdater.checkForUpdates().catch((e) => {
    // Offline / transient / no release yet — logged, but the UI stays quiet.
    logger.error('autoUpdater: check failed', e)
  })
}

let started = false

export function initAutoUpdater() {
  // IPC the in-app top-bar button uses (state sync + manual actions). Registered
  // even in dev so renderer calls resolve cleanly instead of throwing.
  ipcMain.handle('updates:getState', () => lastState)
  ipcMain.handle('updates:check', () => {
    if (app.isPackaged) check()
    return lastState
  })
  ipcMain.handle('updates:download', () => {
    if (!app.isPackaged) return { status: 'dev' }
    startDownload()
    return { status: 'downloading' }
  })
  ipcMain.handle('updates:install', () => {
    if (app.isPackaged) autoUpdater.quitAndInstall()
    return { status: 'installing' }
  })

  // No installer to swap out when running from source / unpacked, so don't start
  // the checker. The IPC handlers above still answer (button just stays hidden).
  if (!app.isPackaged) {
    logger.info('autoUpdater: dev mode — auto-update disabled')
    return
  }
  if (started) return
  started = true

  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = false // user starts the download from the top-bar button
  autoUpdater.autoInstallOnAppQuit = true // if they defer the restart, install on quit

  autoUpdater.on('update-available', (info) => {
    logger.info('autoUpdater: update available', info.version)
    broadcast({ status: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => broadcast({ status: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ status: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) => {
    logger.info('autoUpdater: update downloaded', info.version)
    broadcast({ status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    logger.error('autoUpdater: error', err)
    broadcast({ status: 'error', message: String(err?.message || err) })
  })

  // Check on launch, then periodically while the app stays open.
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
