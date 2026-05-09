const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  extractLmsCookies: (url, partition) =>
    ipcRenderer.invoke('extract-lms-cookies', { url, partition }),
  clearLmsSession: (partition) =>
    ipcRenderer.invoke('clear-lms-session', { partition }),
})
