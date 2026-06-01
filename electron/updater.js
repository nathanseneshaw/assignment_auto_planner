// Auto-update wiring for the packaged desktop app.
//
// How it works end to end:
//   1. `electron-builder` is run with the GitHub `publish` config (see
//      package.json build.publish). At build time it bakes an `app-update.yml`
//      into the app's resources and, when published, uploads three things to a
//      GitHub Release: the installer (Plannr-x.y.z-x64.exe), its `.blockmap`
//      (enables small differential downloads), and `latest.yml` (the manifest
//      describing the newest version + file hashes).
//   2. On launch the running app asks GitHub for the latest release's
//      `latest.yml`, compares its `version` against this build's version, and if
//      it's newer downloads the installer in the background.
//   3. Once downloaded we prompt the user to restart; `quitAndInstall()` swaps
//      in the new version. If they choose "Later" it installs on next quit.
//
// electron-updater ships as CommonJS, so under our ESM ("type":"module") setup
// we default-import and destructure rather than `import { autoUpdater }`.
import electronUpdater from 'electron-updater'
import { app, dialog } from 'electron'
import logger from './logger.js'

const { autoUpdater } = electronUpdater

// Adapter so electron-updater's verbose internal logs land in our main.log
// (it expects info/warn/error/debug). This already covers "checking",
// "update available/not available", and download-progress messages.
const updaterLogger = {
  info: (m) => logger.info('autoUpdater:', m),
  warn: (m) => logger.warn('autoUpdater:', m),
  error: (m) => logger.error('autoUpdater:', m),
  debug: (m) => logger.info('autoUpdater:', m),
}

export function initAutoUpdater() {
  // No installer to replace when running from source (`electron:dev`) or an
  // unpacked build, and there's no embedded app-update.yml, so skip cleanly.
  if (!app.isPackaged) {
    logger.info('autoUpdater: skipped (app not packaged)')
    return
  }

  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = true // pull the update in the background once found
  autoUpdater.autoInstallOnAppQuit = true // if user defers, apply it on next quit

  autoUpdater.on('error', (err) => {
    logger.error('autoUpdater: error', err)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    logger.info('autoUpdater: update downloaded', info.version)
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Plannr ${info.version} has been downloaded.`,
      detail: 'Restart the app to finish installing the update.',
    })
    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  // Fire-and-forget; failures (offline, GitHub down) are logged, not fatal.
  autoUpdater.checkForUpdates().catch((err) => {
    logger.error('autoUpdater: check failed', err)
  })
}
