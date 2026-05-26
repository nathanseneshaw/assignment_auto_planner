const { contextBridge } = require('electron')

// `window.electronAPI` is the renderer's only handle to anything privileged.
// Currently just an `isElectron` sentinel for capability detection — the API
// itself lives on Render (see VITE_API_BASE in the electron:build script),
// so there's no IPC bridge for backend calls.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
})
