const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  getPort: () => ipcRenderer.invoke('get-port'),
  getToken: () => ipcRenderer.invoke('get-token'),
  getIsDevelopment: () => ipcRenderer.invoke('get-is-development'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
});
