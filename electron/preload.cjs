const { contextBridge, ipcRenderer } = require('electron')

// `window.electronAPI` is the renderer's only handle to anything privileged.
// `isElectron` is a capability-detection sentinel; the backend API itself lives
// on Render (see VITE_API_BASE in the electron:build script), so there's no IPC
// bridge for backend calls — only the desktop auto-updater below.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // Auto-update controls, backed by electron-updater in the main process
  // (see electron/updater.js). All methods are no-ops returning {status:'dev'}
  // when the app isn't packaged.
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
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
