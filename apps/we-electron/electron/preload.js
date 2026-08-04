const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  getPort: () => ipcRenderer.invoke('get-port'),
  getToken: () => ipcRenderer.invoke('get-token'),
  getIsDevelopment: () => ipcRenderer.invoke('get-is-development'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Account management. Every mutation is registry-only until applyAccountSelection() takes effect.
  listAccounts: () => ipcRenderer.invoke('accounts-list'),
  createAccount: () => ipcRenderer.invoke('accounts-create'),
  renameAccount: (id, name) => ipcRenderer.invoke('accounts-rename', id, name),
  selectAccount: (id) => ipcRenderer.invoke('accounts-select', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts-remove', id),
  applyAccountSelection: () => ipcRenderer.invoke('accounts-apply'),
});
