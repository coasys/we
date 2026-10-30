/**
 * Which renderer may call the main process: the main window's own top frame, on the app's origin.
 *
 * ## Why every handler checks
 *
 * `ipcMain.handle` answers whoever sends on the channel. The preload is attached only to the main
 * window, so in the ordinary case that is the app — but "the ordinary case" is the whole of the
 * guarantee. `get-token` hands out the executor's admin credential, which is every capability the
 * executor has; an embedded app in an iframe (Flux, served on another origin), a page the window was
 * navigated to by a bug, or a second window a future change opens with the same preload would each
 * be answered too. The navigation guards in `main.js` make those unlikely; this makes them
 * irrelevant, because the answer depends on who asked rather than on what could reach the channel.
 *
 * ## What counts as the main window
 *
 * Three things, all required:
 * - the sender is the main window's `webContents`, not another window's;
 * - the frame that sent it is that window's top frame, not an iframe inside it — compared by process
 *   and routing id, since a `WebFrameMain` is not guaranteed to be the same object twice;
 * - the frame's document is on the app's own origin.
 *
 * A refusal throws, so `ipcRenderer.invoke` rejects: a caller that should not have asked learns
 * nothing about the answer, and a bug in the app shows up as an error rather than as silence.
 */

/** Whether `event` came from `window`'s top frame, showing a document `isAppUrl` accepts. */
export function isFromMainWindow(event, window, isAppUrl) {
  if (!event || !window || window.isDestroyed?.()) return false;
  const contents = window.webContents;
  if (!contents || event.sender !== contents) return false;
  const frame = event.senderFrame;
  const top = contents.mainFrame;
  if (!frame || !top) return false;
  if (frame.processId !== top.processId || frame.routingId !== top.routingId) return false;
  return isAppUrl(frame.url);
}

/**
 * `ipcMain.handle(channel, handler)`, answering only the main window. `getWindow` is read at call
 * time: the window is made after the handlers are registered, and is replaced if it is ever re-made.
 */
export function handleFromMainWindow(ipcMain, getWindow, isAppUrl, channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isFromMainWindow(event, getWindow(), isAppUrl)) {
      throw new Error(`[we] ${channel} refused: the sender is not the app's main window`);
    }
    return handler(event, ...args);
  });
}

/**
 * The executor's environment for one start: the admin credential in `AD4M_ADMIN_CREDENTIAL`, never
 * on its command line. An argument is readable by every user of the computer through `ps`, and the
 * executor's own help says so; an environment is readable only by the same user (and root), the
 * boundary the credential is meant to have.
 */
export function executorSpawnEnv(baseEnv, credential) {
  if (!credential) throw new Error('[we] the executor needs an admin credential');
  return { ...baseEnv, AD4M_ADMIN_CREDENTIAL: credential };
}
