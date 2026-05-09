import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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
      webviewTag: true,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Read cookies from a webview partition and return them to the renderer.
ipcMain.handle('extract-lms-cookies', async (_e, { url, partition }) => {
  const ses = partition ? session.fromPartition(partition) : session.defaultSession
  const { hostname } = new URL(url)
  const raw = await ses.cookies.get({ domain: hostname })
  return raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite || 'Lax',
  }))
})

// Clear all cookies in the LMS partition so the next login starts fresh.
ipcMain.handle('clear-lms-session', async (_e, { partition }) => {
  const ses = session.fromPartition(partition)
  await ses.clearStorageData()
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
