/**
 * The identity window's life, as the Tauri app's `identity_open` runs it (`apps/we-tauri/src-tauri/src/
 * commands/identity.rs`).
 *
 * The main window may open the window on a step and read public custody state, and nothing else.
 * The identity window runs that step and no other, against the custody sidecar. One window at a
 * time: asking again focuses the one open and starts nothing. Closing the window ends the step: an
 * unfinished one is cancelled in custody, and the main window hears how it ended — never a screen.
 *
 * The window itself is made by `openWindow({ onClosed })` (`main.js`), so this file holds no Electron.
 */

import { relative, resolve, sep } from 'path';

/**
 * Where the window's bundle is served from: a scheme of its own (registered in `main.js`), so the
 * window shares an origin, storage and session with nothing else, the app included.
 */
export const IDENTITY_SCHEME = 'we-identity';
export const IDENTITY_PAGE = `${IDENTITY_SCHEME}://window/index.html`;

/** Whether the identity window may show `url`: its own page and nothing else. */
export function isIdentityPage(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}` === IDENTITY_PAGE && !parsed.search;
  } catch {
    return false;
  }
}

/**
 * The file in the bundle folder `dir` that `url` names on the identity scheme, or null for anything
 * outside it.
 */
export function identityFile(url, dir) {
  let parsed, path;
  try {
    parsed = new URL(url);
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${IDENTITY_SCHEME}:` || parsed.host !== 'window') return null;
  const file = resolve(dir, `.${path}`);
  const inside = relative(dir, file);
  if (!inside || inside.startsWith('..') || inside.split(sep).includes('..')) return null;
  return file;
}

/** The steps the main window may ask for, as `we_custody::IdentityStep` reads them. */
function isIdentityStep(step) {
  if (step?.kind === 'create' || step?.kind === 'add-device') return true;
  return step?.kind === 'revoke' && typeof step.keyId === 'string';
}

/**
 * `custody()` is the running sidecar's client, or null; it changes when the executor restarts.
 * `openWindow({ onClosed })` makes the identity window and calls `onClosed` once it is gone.
 */
export function createIdentity({ custody, openWindow }) {
  let window = null;
  let step = null;
  let outcome = null;

  const service = () => {
    const client = custody();
    if (!client) throw new Error('the custody service is not running');
    return client;
  };

  /** Hands the window its screen, keeping how the step ended when the screen is its last. */
  const shown = ({ screen, outcome: ended }) => {
    if (ended) outcome = ended;
    return screen;
  };

  const close = () => {
    if (window && !window.isDestroyed()) window.close();
  };

  return {
    /** The identity window, while one is open. */
    window: () => (window && !window.isDestroyed() ? window : null),

    async open(asked) {
      if (!isIdentityStep(asked)) throw new Error('not an identity step');
      service();
      if (window && !window.isDestroyed()) {
        // The step already in it goes on; this call did not start one.
        window.focus();
        return 'cancelled';
      }
      step = asked;
      outcome = null;
      return new Promise((resolve) => {
        window = openWindow({
          onClosed: () => {
            window = null;
            const ended = outcome ?? 'cancelled';
            if (ended === 'cancelled')
              custody()
                ?.call('cancel')
                .catch(() => {});
            resolve(ended);
          },
        });
      });
    },

    publicState: async () => service().call('publicState'),

    /** Starts the step the main window opened this window for. The window cannot choose another. */
    async start() {
      if (!step) throw new Error('no step was asked for');
      return shown(await service().call('start', { step }));
    },

    step: async (input) => shown(await service().call('step', { input })),

    /** Cancels the step and closes the window. */
    async cancel() {
      await service().call('cancel');
      close();
    },

    /** Closes the window after the step's last screen. */
    async finish() {
      close();
    },
  };
}
