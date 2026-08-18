const { contextBridge, ipcRenderer } = require('electron')

// The title-bar layout differs per OS: macOS draws the traffic lights in the
// top-LEFT (where the sidebar logo sits in the Windows layout), Windows draws
// min/max/close as an overlay in the top-right. Tag <html> here - the preload
// is guaranteed to run before any renderer script and `process.platform` is
// authoritative - so the .is-mac/.is-electron CSS in src/style.css never
// depends on bundle-eval timing. App.vue re-adds the same classes, which is a
// harmless no-op backstop.
function tagPlatformClasses() {
  const root = document.documentElement
  if (!root) return
  root.classList.add('is-electron')
  if (process.platform === 'darwin') root.classList.add('is-mac')
}
if (document.documentElement) {
  tagPlatformClasses()
} else {
  window.addEventListener('DOMContentLoaded', tagPlatformClasses)
}

// `window.electronAPI` is the renderer's only handle to anything privileged.
// `isElectron` is a capability-detection sentinel; the backend API itself lives
// on Render (see VITE_API_BASE in the electron:build script), so there's no IPC
// bridge for backend calls — only the desktop auto-updater below.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // 'darwin' | 'win32' | 'linux'. The renderer lays the title bar out
  // differently per OS: window controls are top-right on Windows but the
  // traffic lights are top-LEFT on macOS (see .is-mac rules in src/style.css).
  platform: process.platform,
  // Min/max/close are native OS buttons (titleBarOverlay); the renderer only
  // re-tints them when the app theme flips between light and dark (App.vue).
  window: {
    setTitleBarOverlay: (opts) => ipcRenderer.invoke('window:setTitleBarOverlay', opts),
  },
  // Auto-update controls, backed by electron-updater in the main process
  // (see electron/updater.js). All methods are no-ops returning {status:'dev'}
  // when the app isn't packaged.
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    // Awaitable manual check used by the profile-page "Software update" section.
    checkNow: () => ipcRenderer.invoke('updates:checkNow'),
    getVersion: () => ipcRenderer.invoke('updates:getVersion'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    getState: () => ipcRenderer.invoke('updates:getState'),
    // Subscribe to update lifecycle events; returns an unsubscribe function.
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('updates:event', listener)
      return () => ipcRenderer.removeListener('updates:event', listener)
    },
  },
})
