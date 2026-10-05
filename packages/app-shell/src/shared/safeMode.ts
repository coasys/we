/**
 * Safe mode — the way out of an interface that will not let you out.
 *
 * ## What it is for
 *
 * A template decides everything on screen, and a template can come from a stranger. One that hides
 * every way to another template, or one that hangs the page while it renders, leaves somebody with
 * no way back to an interface that works — and on the web, where a reload keeps the session, not
 * even a restart helps. Safe mode renders WE's own built-in templates and themes instead of
 * whatever was chosen, for this tab, until somebody leaves it. Nothing is changed or deleted; it is
 * a decision about what to draw, taken before anything a template wrote has run.
 *
 * ## Three doors, one room
 *
 * - **The address.** `?safe` on any WE address. Read here, once, before the first template is
 *   committed — which is what makes it impossible to subvert: nothing a template could do has run
 *   yet, and a `history.replaceState` later cannot undo a decision already taken. On the web the
 *   address bar is the one piece of the window a page cannot draw over.
 * - **A key.** Ctrl+Alt+Shift+S (⌘⌥⇧S on a Mac) reloads into it — see
 *   {@link installSafeModeShortcut}. For an interface that loads fine and offers no way out. Heard
 *   on the window in the capture phase, before anything a template rendered could see it.
 * - **A render that never finished.** {@link beginRender} writes "rendering this template" before a
 *   template mounts and {@link settleRender} clears it once the app has stayed responsive with it
 *   for a few seconds, or once it has been replaced. A page that hung or crashed clears nothing, so
 *   the record is still there at the next boot — and that boot starts in safe mode and says why.
 *   This is the door that actually rescues people: it needs nobody to know anything.
 *
 * The desktop app's menu has a fourth door that opens the address above.
 *
 * ## Why per tab
 *
 * Kept in `sessionStorage` once decided, so navigating inside the app and reloading stay safe, and
 * a second tab opened normally is not. Leaving clears it and reloads.
 */

export type SafeModeReason = 'asked' | 'unfinished-render';

export interface SafeModeState {
  on: boolean;
  /** Why — `asked` for the address, the key or the menu; `unfinished-render` for the automatic one. */
  reason: SafeModeReason | null;
  /** For `unfinished-render`, the template that did not finish, as its id. */
  template: string;
}

/** The address parameter. Present with any value, or none. */
export const SAFE_MODE_PARAM = 'safe';
const SESSION_KEY = 'we.safeMode';
/** Templates whose render began and has not been seen to settle. Survives the page, by design. */
const RENDERING_KEY = 'we.rendering';
/** How long a template must leave the app responsive before its render counts as finished. */
export const SETTLE_MS = 4000;

const OFF: SafeModeState = { on: false, reason: null, template: '' };

let decided: SafeModeState | null = null;

/** Storage that may be absent, full or refused — a private window, a blocked origin. */
function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(storage: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Nowhere to keep it. Safe mode still applies to this page; it simply will not be remembered.
  }
}

function renderingNow(): string[] {
  const raw = read(globalThis.localStorage, RENDERING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function setRendering(ids: string[]): void {
  write(globalThis.localStorage, RENDERING_KEY, ids.length ? JSON.stringify(ids) : null);
}

/**
 * Whether this page is in safe mode, decided on the first call and fixed for the page's life.
 *
 * The first call must come before any template is committed — `TemplateStore` makes it as it is
 * created. Reads the address, then the tab's memory, then the record of a render that never
 * finished; strips `?safe` from the address so the app's own routing never sees it.
 */
export function safeMode(): SafeModeState {
  if (decided) return decided;
  decided = decide();
  return decided;
}

function decide(): SafeModeState {
  const win = globalThis.window as Window | undefined;
  if (!win) return OFF;

  const url = new URL(win.location.href);
  if (url.searchParams.has(SAFE_MODE_PARAM)) {
    url.searchParams.delete(SAFE_MODE_PARAM);
    try {
      win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      // A sandboxed frame may refuse. The parameter is harmless left in place.
    }
    return remember({ on: true, reason: 'asked', template: '' });
  }

  const remembered = read(globalThis.sessionStorage, SESSION_KEY);
  if (remembered) {
    try {
      const state = JSON.parse(remembered) as SafeModeState;
      if (state?.on) return { on: true, reason: state.reason ?? 'asked', template: state.template ?? '' };
    } catch {
      // A record from something else under the same key. Treated as not there.
    }
  }

  const unfinished = renderingNow();
  if (unfinished.length) {
    // Cleared now, so leaving safe mode is a fresh start rather than straight back into it.
    setRendering([]);
    return remember({ on: true, reason: 'unfinished-render', template: unfinished[unfinished.length - 1] });
  }

  return OFF;
}

function remember(state: SafeModeState): SafeModeState {
  write(globalThis.sessionStorage, SESSION_KEY, JSON.stringify(state));
  return state;
}

/** Reload into safe mode. What the key and the menu do. */
export function enterSafeMode(): void {
  const win = globalThis.window as Window | undefined;
  if (!win) return;
  write(globalThis.sessionStorage, SESSION_KEY, JSON.stringify({ on: true, reason: 'asked', template: '' }));
  win.location.reload();
}

/** Leave safe mode and reload with what was chosen. */
export function leaveSafeMode(): void {
  const win = globalThis.window as Window | undefined;
  write(globalThis.sessionStorage, SESSION_KEY, null);
  setRendering([]);
  win?.location.reload();
}

/**
 * A template is about to be drawn. Recorded before it mounts, so a render that takes the page down
 * with it leaves the record behind. Returns the settle, for whoever mounted it to call when it goes.
 */
export function beginRender(templateId: string, settleAfter = SETTLE_MS): () => void {
  if (!templateId || safeMode().on) return () => {};
  const ids = renderingNow().filter((id) => id !== templateId);
  setRendering([...ids, templateId]);
  const timer = setTimeout(() => settleRender(templateId), settleAfter);
  return () => {
    clearTimeout(timer);
    settleRender(templateId);
  };
}

/** The template rendered and the app stayed responsive — or it was replaced, which also needs a live page. */
export function settleRender(templateId: string): void {
  const ids = renderingNow();
  if (!ids.includes(templateId)) return;
  setRendering(ids.filter((id) => id !== templateId));
}

/**
 * The page is going away with JavaScript still running — a reload, a close, a navigation. Whatever
 * was mid-render did not hang it, so it is not a reason to start in safe mode next time.
 */
export function installRenderSettleOnExit(win: Window = window): () => void {
  const clear = () => setRendering([]);
  win.addEventListener('pagehide', clear);
  return () => win.removeEventListener('pagehide', clear);
}

/** The key, as a predicate: Ctrl+Alt+Shift+S, or ⌘⌥⇧S. `code` rather than `key`, which ⌥ changes. */
export function isSafeModeChord(event: KeyboardEvent): boolean {
  return event.code === 'KeyS' && event.altKey && event.shiftKey && (event.ctrlKey || event.metaKey);
}

/**
 * Listen for the key. On the window, in the capture phase, so it is heard before anything a
 * template rendered — a focused field, a component stopping propagation — can see the event.
 */
export function installSafeModeShortcut(win: Window = window, onPress: () => void = enterSafeMode): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!isSafeModeChord(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (safeMode().on) return;
    onPress();
  };
  win.addEventListener('keydown', listener, true);
  return () => win.removeEventListener('keydown', listener, true);
}

/** Forget the decision. Tests only — a page decides once. */
export function resetSafeModeForTests(): void {
  decided = null;
}
