// Auto-update wiring for the packaged desktop app.
//
// Checking is driven by the MAIN process (this file) on launch and on an
// interval, so updates are detected regardless of whether the user has signed
// in or which screen they're on. When an update is found we alert immediately
// with a native dialog (works even on the login screen / before sign-in) and
// also broadcast the state to the renderer so the in-app "Update Available"
// button stays in sync for users who happen to be in the app.
//
// electron-updater ships as CommonJS, so under our ESM setup we default-import
// and destructure rather than `import { autoUpdater }`.
import electronUpdater from 'electron-updater'
import { app, ipcMain, dialog, BrowserWindow } from 'electron'
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
let dialogOpen = false // never stack native dialogs
let promptedVersion = null // alert about a given version only once per run

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

async function alertUpdateAvailable(version) {
  if (dialogOpen) return
  dialogOpen = true
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `Plannr ${version} is available.`,
      detail: 'Download it now? You can keep using the app while it downloads.',
    })
    if (response === 0) startDownload()
  } finally {
    dialogOpen = false
  }
}

async function alertUpdateDownloaded(version) {
  if (dialogOpen) return
  dialogOpen = true
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Plannr ${version} has been downloaded.`,
      detail: 'Restart now to finish installing, or it will install the next time you quit.',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  } finally {
    dialogOpen = false
  }
}

function check() {
  autoUpdater.checkForUpdates().catch((e) => {
    // Offline / transient / no release yet — logged, but the UI stays quiet
    // (no scary banner for a failed check).
    logger.error('autoUpdater: check failed', e)
  })
}

let started = false

export function initAutoUpdater() {
  // IPC the in-app button uses (manual trigger + state sync). Registered even
  // in dev so renderer calls resolve cleanly instead of throwing.
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

  // No installer to swap out when running from source / unpacked, and no
  // embedded app-update.yml, so don't start the checker. The IPC handlers above
  // still answer (the in-app button just stays hidden).
  if (!app.isPackaged) {
    logger.info('autoUpdater: dev mode — auto-update disabled')
    return
  }
  if (started) return
  started = true

  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = false // wait for the user to accept the alert
  autoUpdater.autoInstallOnAppQuit = true // if they defer the restart, install on quit

  autoUpdater.on('update-available', (info) => {
    logger.info('autoUpdater: update available', info.version)
    broadcast({ status: 'available', version: info.version })
    // Proactive native alert — fires regardless of sign-in state. Once per
    // version per run so an hourly re-check doesn't nag repeatedly.
    if (promptedVersion !== info.version) {
      promptedVersion = info.version
      void alertUpdateAvailable(info.version)
    }
  })
  autoUpdater.on('update-not-available', () => broadcast({ status: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ status: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) => {
    logger.info('autoUpdater: update downloaded', info.version)
    broadcast({ status: 'downloaded', version: info.version })
    void alertUpdateDownloaded(info.version)
  })
  autoUpdater.on('error', (err) => {
    logger.error('autoUpdater: error', err)
    broadcast({ status: 'error', message: String(err?.message || err) })
  })

  // Check on launch, then periodically while the app stays open.
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
