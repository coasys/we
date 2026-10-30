/*
  The identity window's preload: its four calls to the custody service (`@we/identity-window`'s
  transport), and nothing else of Electron. The main process answers them for this window only.
*/
const { contextBridge, ipcRenderer } = require('electron');

// The window draws a refusal as a sentence, so the IPC wrapping around it is dropped.
const call = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).catch((error) => {
    throw new Error(String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
  });

contextBridge.exposeInMainWorld('identity', {
  start: () => call('identity-flow-start'),
  step: (input) => call('identity-flow-step', input),
  cancel: () => call('identity-flow-cancel'),
  finish: () => call('identity-flow-finish'),
});
