/**
 * The Electron credential fix: the admin credential never on the executor's
 * command line, and no IPC answer to anything but the main window's own top frame.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { executorSpawnEnv, handleFromMainWindow, isFromMainWindow } from './ipcSender.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'http://localhost:9080';
const isAppUrl = (url) => {
  try {
    return new URL(url).origin === APP;
  } catch {
    return false;
  }
};

/** A main window with a top frame, as far as the check reads one. */
function window({ destroyed = false } = {}) {
  const mainFrame = { processId: 4, routingId: 1, url: `${APP}/` };
  return { isDestroyed: () => destroyed, webContents: { mainFrame } };
}

const from = (win, frame = win.webContents.mainFrame) => ({ sender: win.webContents, senderFrame: frame });

describe('isFromMainWindow', () => {
  it('answers the main window’s top frame on the app’s origin', () => {
    const win = window();
    expect(isFromMainWindow(from(win), win, isAppUrl)).toBe(true);
  });

  it('refuses an iframe inside the main window — an embedded app', () => {
    const win = window();
    const iframe = { processId: 4, routingId: 7, url: `${APP}/` };
    expect(isFromMainWindow(from(win, iframe), win, isAppUrl)).toBe(false);
    const otherProcess = { processId: 9, routingId: 1, url: 'http://localhost:9081/' };
    expect(isFromMainWindow(from(win, otherProcess), win, isAppUrl)).toBe(false);
  });

  it('refuses the top frame once it shows another origin', () => {
    const win = window();
    const navigated = { ...win.webContents.mainFrame, url: 'https://example.org/' };
    expect(isFromMainWindow(from(win, navigated), win, isAppUrl)).toBe(false);
  });

  it('refuses another window, a destroyed window, and no window', () => {
    const win = window();
    const other = window();
    expect(isFromMainWindow(from(other), win, isAppUrl)).toBe(false);
    const gone = window({ destroyed: true });
    expect(isFromMainWindow(from(gone), gone, isAppUrl)).toBe(false);
    expect(isFromMainWindow(from(win), null, isAppUrl)).toBe(false);
    expect(isFromMainWindow({ sender: win.webContents }, win, isAppUrl)).toBe(false);
  });
});

describe('handleFromMainWindow', () => {
  function registered(win) {
    const handlers = new Map();
    const ipc = { handle: (channel, fn) => handlers.set(channel, fn) };
    handleFromMainWindow(
      ipc,
      () => win,
      isAppUrl,
      'get-token',
      (_event, extra) => `token${extra ?? ''}`,
    );
    return handlers.get('get-token');
  }

  it('passes the main window’s call through, with its arguments', () => {
    const win = window();
    expect(registered(win)(from(win), '!')).toBe('token!');
  });

  it('throws for any other sender, so the caller learns nothing', () => {
    const win = window();
    const iframe = { processId: 4, routingId: 7, url: `${APP}/` };
    expect(() => registered(win)(from(win, iframe))).toThrow(/refused/);
  });
});

describe('the executor’s start', () => {
  it('carries the credential in the environment, keeping the rest', () => {
    const env = executorSpawnEnv({ PATH: '/bin', RUST_LOG: 'info' }, 'secret-token');
    expect(env).toEqual({ PATH: '/bin', RUST_LOG: 'info', AD4M_ADMIN_CREDENTIAL: 'secret-token' });
  });

  it('refuses to start without one', () => {
    expect(() => executorSpawnEnv({}, '')).toThrow();
  });

  it('main.js puts no credential on the command line and registers no unchecked handler', () => {
    const main = readFileSync(join(here, 'main.js'), 'utf8');
    expect(main).not.toMatch(/['"]--admin-credential['"]/);
    expect(main).not.toMatch(/ipcMain\.handle\(/);
    expect(main).not.toMatch(/pkill/);
    expect(main).toMatch(/executorSpawnEnv\(/);
  });
});
