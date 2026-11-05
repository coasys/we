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
  /**
   * The open window's run: the window, the step it was opened on and how that step ended. Each
   * call keeps the run it came from, so an answer that arrives after its window closed changes
   * nothing of the next one.
   */
  let run = null;
  /** The cancels still unanswered. The next step asks custody nothing until they are, so none ends it. */
  let ending = null;

  const service = () => {
    const client = custody();
    if (!client) throw new Error('the custody service is not running');
    return client;
  };

  const cancelStep = (client) => {
    const sent = client.call('cancel');
    const settled = Promise.all([ending, sent.catch(() => {})]).then(() => {
      if (ending === settled) ending = null;
    });
    ending = settled;
    return sent;
  };

  /** A request of the step `of` runs, once every cancel before it is answered, and never after its window closed. */
  const ask = async (of, method, params) => {
    while (ending) await ending;
    if (of !== run) throw new Error('the identity window was closed');
    return service().call(method, params);
  };

  /** Hands the window its screen, keeping how the step ended when the screen is its last. */
  const shown = (of, { screen, outcome: ended }) => {
    if (ended && of) of.outcome = ended;
    return screen;
  };

  /** Closes the window of `of`, never one opened after it. */
  const close = (of) => {
    if (of?.window && !of.window.isDestroyed()) of.window.close();
  };

  return {
    /** The identity window, while one is open. */
    window: () => (run?.window && !run.window.isDestroyed() ? run.window : null),

    async open(asked) {
      if (!isIdentityStep(asked)) throw new Error('not an identity step');
      service();
      if (run?.window && !run.window.isDestroyed()) {
        // The step already in it goes on; this call did not start one.
        run.window.focus();
        return 'cancelled';
      }
      const opened = { step: asked, outcome: null, window: null };
      run = opened;
      return new Promise((resolve) => {
        opened.window = openWindow({
          onClosed: () => {
            if (run === opened) run = null;
            const ended = opened.outcome ?? 'cancelled';
            if (ended === 'cancelled') {
              const client = custody();
              if (client) cancelStep(client).catch(() => {});
            }
            resolve(ended);
          },
        });
      });
    },

    publicState: async () => service().call('publicState'),

    /** Starts the step the main window opened this window for. The window cannot choose another. */
    async start() {
      const of = run;
      if (!of) throw new Error('no step was asked for');
      return shown(of, await ask(of, 'start', { step: of.step }));
    },

    async step(input) {
      const of = run;
      return shown(of, await ask(of, 'step', { input }));
    },

    /** Cancels the step and closes the window. */
    async cancel() {
      const of = run;
      await cancelStep(service());
      close(of);
    },

    /** Closes the window after the step's last screen. */
    async finish() {
      close(run);
    },
  };
}
