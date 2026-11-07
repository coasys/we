/**
 * The tray icon, and what closing the main window does.
 *
 * The app runs the person's executor, which keeps syncing their spaces while no window is open. So
 * closing the main window hides it, and the app and its executor keep running; the tray icon's menu
 * shows the window again ("Open") and quits the app ("Quit"), which stops the executor. The Tauri
 * app does the same (`src-tauri/src/main_window.rs`).
 *
 * A hidden window with no icon to bring it back would leave a running app nobody can reach. So the
 * window hides only while the icon can be seen: on Linux the icon is a StatusNotifierItem, shown only
 * while a tray host owns `org.kde.StatusNotifierWatcher` on the session bus, and GNOME without an
 * AppIndicator extension has none. Without one, closing the window quits the app, as "Quit" does.
 */
import { spawnSync } from 'child_process';

const WATCHER = 'org.kde.StatusNotifierWatcher';

/** Whether `dbus-send … NameHasOwner string:org.kde.StatusNotifierWatcher` answered yes. */
export function trayHostAnswered(output) {
  return /\bboolean\s+true\b/.test(String(output ?? ''));
}

/**
 * Whether a tray host is there to show the icon. Asked each time, since a host can come and go.
 * Only Linux needs one; elsewhere the OS always shows a tray icon.
 */
export function trayHostPresent(platform = process.platform, run = spawnSync) {
  if (platform !== 'linux') return true;
  const result = run(
    'dbus-send',
    [
      '--session',
      '--dest=org.freedesktop.DBus',
      '--type=method_call',
      '--print-reply',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus.NameHasOwner',
      `string:${WATCHER}`,
    ],
    { encoding: 'utf8', timeout: 2_000 },
  );
  return !result.error && result.status === 0 && trayHostAnswered(result.stdout);
}

/** Whether closing the main window hides it rather than quitting: only while the icon can show it again. */
export function closeHides({ quitting, trayUp, hostPresent }) {
  return !quitting && trayUp && hostPresent;
}

/**
 * The tray icon with "Open <name>" and "Quit <name>". Null, logged, when the platform refuses one.
 */
export function createTray({ Tray, Menu, icon, name, onOpen, onQuit, log = console }) {
  try {
    const tray = new Tray(icon);
    tray.setToolTip(name);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${name}`, click: onOpen },
        { type: 'separator' },
        { label: `Quit ${name}`, click: onQuit },
      ]),
    );
    // Windows and macOS: a click on the icon itself opens the window.
    tray.on('click', onOpen);
    return tray;
  } catch (err) {
    log.warn(`[tray] No tray icon (${err.message}); closing the window quits the app`);
    return null;
  }
}
