// Auto-update wiring for the packaged desktop app, driven by an in-app button.
//
// How it works end to end:
//   1. `electron-builder` is run with the GitHub `publish` config (see
//      package.json build.publish). At build time it bakes an `app-update.yml`
//      into the app's resources and, when published, uploads three things to a
//      GitHub Release: the installer (Plannr-x64.exe), its `.blockmap` (enables
//      small differential downloads), and `latest.yml` (the manifest describing
//      the newest version + file hashes).
//   2. The renderer's update button calls `updates.check()` on mount. We ask
//      GitHub for the latest release's `latest.yml` and compare its version to
//      this build's version. If newer, we emit `update-available` and the button
//      appears.
//   3. The user clicks → `updates.download()` pulls the installer in the
//      background (we forward progress). When it finishes we emit
//      `update-downloaded`; the renderer then calls `updates.install()`, which
//      runs `quitAndInstall()` to relaunch into the new version.
//
// `autoDownload` is off so nothing downloads until the user clicks the button.
// electron-updater ships as CommonJS, so under our ESM ("type":"module") setup
// we default-import and destructure rather than `import { autoUpdater }`.
import electronUpdater from 'electron-updater'
import { app, ipcMain, BrowserWindow } from 'electron'
import logger from './logger.js'

const { autoUpdater } = electronUpdater

// Adapter so electron-updater's verbose internal logs land in our main.log
// (it expects info/warn/error/debug).
const updaterLogger = {
  info: (m) => logger.info('autoUpdater:', m),
  warn: (m) => logger.warn('autoUpdater:', m),
  error: (m) => logger.error('autoUpdater:', m),
  debug: (m) => logger.info('autoUpdater:', m),
}

// Last status we broadcast, so a renderer that mounts *after* an event fired can
// catch up via updates:getState instead of missing it.
let lastState = { status: 'idle' }

function broadcast(payload) {
  lastState = payload
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('updates:event', payload)
    }
  }
}

let initialized = false

export function initAutoUpdater() {
  if (initialized) return
  initialized = true

  // IPC the renderer's update button calls. Registered even in dev so those
  // calls resolve cleanly (reporting "dev") instead of throwing "no handler".
  ipcMain.handle('updates:getState', () => lastState)

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { status: 'dev' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { status: 'checked', version: result?.updateInfo?.version }
    } catch (err) {
      // Offline, or no published release yet — log but don't surface a scary
      // error to the UI (the button just stays hidden, see UpdateButton.vue).
      logger.error('autoUpdater: check failed', err)
      return { status: 'error', message: String(err?.message || err) }
    }
  })

  ipcMain.handle('updates:download', async () => {
    if (!app.isPackaged) return { status: 'dev' }
    try {
      await autoUpdater.downloadUpdate()
      return { status: 'downloading' }
    } catch (err) {
      logger.error('autoUpdater: download failed', err)
      broadcast({ status: 'error', message: String(err?.message || err) })
      return { status: 'error', message: String(err?.message || err) }
    }
  })

  ipcMain.handle('updates:install', () => {
    if (!app.isPackaged) return { status: 'dev' }
    // Relaunch into the freshly downloaded version.
    autoUpdater.quitAndInstall()
    return { status: 'installing' }
  })

  // No installer to swap out when running from source / unpacked, and there's
  // no embedded app-update.yml, so stop here — the IPC handlers above still
  // answer (with "dev") and the button stays hidden.
  if (!app.isPackaged) {
    logger.info('autoUpdater: dev mode — auto-update disabled')
    return
  }

  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = false // wait for the user to click Update
  autoUpdater.autoInstallOnAppQuit = true // safety net if they quit mid-flow

  autoUpdater.on('update-available', (info) => {
    logger.info('autoUpdater: update available', info.version)
    broadcast({ status: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    broadcast({ status: 'not-available' })
  })
  autoUpdater.on('download-progress', (p) => {
    broadcast({ status: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    logger.info('autoUpdater: update downloaded', info.version)
    broadcast({ status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    logger.error('autoUpdater: error', err)
    broadcast({ status: 'error', message: String(err?.message || err) })
  })
}
