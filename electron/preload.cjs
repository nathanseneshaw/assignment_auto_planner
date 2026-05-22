const { contextBridge } = require('electron')

// `window.electronAPI` is the renderer's only handle to anything privileged.
// Currently just an `isElectron` sentinel for capability detection — UTD
// scraping has moved server-side (Playwright + stealth in the Express
// process), so there's no longer an IPC bridge.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  apiPort: 3001,
})
