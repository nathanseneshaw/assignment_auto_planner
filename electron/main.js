import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.ELECTRON_DEV === 'true'

/**
 * Parse a .env-style file and apply any keys that aren't already in process.env.
 * Used to inject Supabase credentials before the Express server module is loaded.
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

/**
 * Start the embedded Express server. Only called in production — in dev mode
 * the server is started externally by the electron:dev concurrently script.
 */
async function startServer() {
  // Credentials are bundled as an extraResource alongside the exe.
  applyEnvFile(path.join(process.resourcesPath, 'server.env.local'))
  // Importing index.js starts the server (it calls app.listen() on load).
  await import('../src/server/index.js')
}

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

app.whenReady().then(async () => {
  if (!isDev) {
    await startServer()
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
