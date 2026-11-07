import { describe, expect, it } from 'vitest';

import { closeHides, createTray, trayHostAnswered, trayHostPresent } from './tray.js';

describe('trayHostAnswered', () => {
  it('reads the bus answer', () => {
    expect(trayHostAnswered('method return time=1 sender=org.freedesktop.DBus\n   boolean true\n')).toBe(true);
    expect(trayHostAnswered('method return\n   boolean false\n')).toBe(false);
    expect(trayHostAnswered('')).toBe(false);
  });
});

describe('trayHostPresent', () => {
  const answering =
    (stdout, status = 0) =>
    () => ({ stdout, status });

  it('asks the session bus on Linux', () => {
    expect(trayHostPresent('linux', answering('boolean true'))).toBe(true);
    expect(trayHostPresent('linux', answering('boolean false'))).toBe(false);
  });

  // No dbus-send, or no session bus: no tray host.
  it('reads a failed ask as no tray host', () => {
    expect(trayHostPresent('linux', () => ({ error: new Error('ENOENT') }))).toBe(false);
    expect(trayHostPresent('linux', answering('', 1))).toBe(false);
  });

  it('needs no tray host elsewhere', () => {
    const never = () => {
      throw new Error('not asked');
    };
    expect(trayHostPresent('darwin', never)).toBe(true);
    expect(trayHostPresent('win32', never)).toBe(true);
  });
});

describe('closeHides', () => {
  it('hides the window only while the icon can show it again', () => {
    expect(closeHides({ quitting: false, trayUp: true, hostPresent: true })).toBe(true);
    expect(closeHides({ quitting: false, trayUp: false, hostPresent: true })).toBe(false);
    expect(closeHides({ quitting: false, trayUp: true, hostPresent: false })).toBe(false);
  });

  it('lets the window close when the app is quitting', () => {
    expect(closeHides({ quitting: true, trayUp: true, hostPresent: true })).toBe(false);
  });
});

describe('createTray', () => {
  const Menu = { buildFromTemplate: (items) => items };

  it('offers Open and Quit under the product name', () => {
    let menu;
    class Tray {
      setToolTip() {}
      setContextMenu(m) {
        menu = m;
      }
      on() {}
    }
    const onOpen = () => {};
    const onQuit = () => {};
    expect(createTray({ Tray, Menu, icon: 'i.png', name: 'Coasys', onOpen, onQuit })).toBeInstanceOf(Tray);
    expect(menu.filter((i) => i.label).map((i) => [i.label, i.click])).toEqual([
      ['Open Coasys', onOpen],
      ['Quit Coasys', onQuit],
    ]);
  });

  it('answers null, with a warning, when the platform refuses an icon', () => {
    const warned = [];
    class Tray {
      constructor() {
        throw new Error('no tray here');
      }
    }
    expect(
      createTray({
        Tray,
        Menu,
        icon: 'i.png',
        name: 'Coasys',
        onOpen() {},
        onQuit() {},
        log: { warn: (m) => warned.push(m) },
      }),
    ).toBeNull();
    expect(warned[0]).toMatch(/no tray here/);
  });
});
