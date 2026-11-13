const { contextBridge, ipcRenderer } = require('electron');

/** Listeners for the tray's "Executor settings…", and whether one came with nobody listening. */
const openSettingsListeners = new Set();
let openSettingsPending = false;
ipcRenderer.on('open-executor-settings', () => {
  if (openSettingsListeners.size === 0) openSettingsPending = true;
  for (const listener of openSettingsListeners) listener();
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  getPort: () => ipcRenderer.invoke('get-port'),
  getToken: () => ipcRenderer.invoke('get-token'),
  getIsDevelopment: () => ipcRenderer.invoke('get-is-development'),
  getDevLinkLanguageBundle: () => ipcRenderer.invoke('get-dev-link-language-bundle'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  /*
    Choosing which screen to share, on a machine whose OS has no picker of its own.

    The main process asks — see `askRendererForScreenSource` — because only it knows the ask is
    needed: with `useSystemPicker` on, the handler that sends this is not reached at all where the
    OS draws its own. Two members, one each way, and the listener hands back its own unsubscribe so
    a caller's teardown needs no knowledge of ipcRenderer.
  */
  onScreenSourceRequest: (listener) => {
    const forward = (_event, sources) => listener(sources);
    ipcRenderer.on('screen-source-request', forward);
    return () => ipcRenderer.removeListener('screen-source-request', forward);
  },
  // An empty id cancels the share, which is an answer rather than a failure.
  chooseScreenSource: (id) => ipcRenderer.send('screen-source-picked', id),

  // Account management. Every mutation is registry-only until applyAccountSelection() takes effect.
  listAccounts: () => ipcRenderer.invoke('accounts-list'),
  createAccount: () => ipcRenderer.invoke('accounts-create'),
  setAccountDisplay: (id, display) => ipcRenderer.invoke('accounts-display', id, display),
  selectAccount: (id) => ipcRenderer.invoke('accounts-select', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts-remove', id),
  applyAccountSelection: () => ipcRenderer.invoke('accounts-apply'),

  // Start the executor over (a new port and credential) and reload the window.
  restartExecutor: () => ipcRenderer.invoke('executor-restart'),
  chooseFile: (options) => ipcRenderer.invoke('executor-choose-file', options),

  /*
    The executor this app runs, as the app before a session reads it: starting, ready, or failed and
    why. The window opens before it is up, so it asks, hears each change, and may try a failed start
    again. `onState` hands back its own unsubscribe.
  */
  executor: {
    state: () => ipcRenderer.invoke('executor-state'),
    onState: (listener) => {
      const forward = (_event, state) => listener(state);
      ipcRenderer.on('executor-state', forward);
      return () => ipcRenderer.removeListener('executor-state', forward);
    },
    start: () => ipcRenderer.invoke('executor-start'),
    /*
      The tray's "Executor settings…": open Settings where the executor's are. An ask that comes
      before anything listens (the window loading, or the app before a session) is held and given to
      the first listener, so it is not lost.
    */
    onOpenSettings: (listener) => {
      openSettingsListeners.add(listener);
      if (openSettingsPending) {
        openSettingsPending = false;
        listener();
      }
      return () => openSettingsListeners.delete(listener);
    },
    // The WE password, where no keyring could be used: sent once, from the host's own field.
    password: (password) => ipcRenderer.invoke('executor-agent-password', password),
  },

  // Every download in the app: the main process asks where, and writes it. See `save-file` in main.js.
  saveFile: (file) => ipcRenderer.invoke('save-file', file),

  /*
    The custody sidecar: open its window on a change to the identity, which resolves with how the
    change ended, and read its public state. No word, passphrase or key comes this way. Absent on
    Windows, where there is no custody service.
  */
  custody:
    process.platform === 'win32'
      ? undefined
      : {
          open: (step) => ipcRenderer.invoke('identity-open', step),
          publicState: () => ipcRenderer.invoke('identity-public-state'),
        },
});
