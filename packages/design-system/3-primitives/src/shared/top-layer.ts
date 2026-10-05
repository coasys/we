/**
 * Who may enter the browser's top layer while the host is asking somebody something.
 *
 * ## The attack this closes
 *
 * The host's safety prompts — "delete this?", "install this?", "trust this peer?" — are modals,
 * and a modal is promoted to the top layer when it mounts (see `OverlayElement`). The top layer
 * stacks by *when* something entered it, not by `z-index`, so whatever enters last paints over
 * everything before it. A template that can open an overlay after the host's prompt has opened can
 * therefore cover it — and a template can: `$setLocal` is not gated on a gesture, and an
 * `onAnimationEnd` will flip a flag that `$if`-mounts a `we-modal` with nobody touching anything.
 * Draw "Press Continue" over a dialog asking whether to delete a space, make the covering sheet
 * `pointer-events: none`, and the person's click lands on the host's own Delete.
 *
 * ## Why here, and why a wrap rather than a check in each overlay
 *
 * Everything that reaches the top layer goes through one of two methods: `showPopover` and
 * `showModal`. Six places in this repository call them — overlays, floating panels, the location
 * picker, the drag ghost, the composer's menus — and a foreign element from the seed's `elements`
 * list is code nobody here wrote. A rule each of them had to remember would hold until the seventh.
 * Wrapping the two methods once makes the rule true of every caller without any of them knowing it
 * exists, which is the only kind of rule worth having at a trust boundary.
 *
 * ## What a held top layer does
 *
 * While an owner holds it, a `showPopover`/`showModal` on anything outside the owner — in the
 * composed tree, so a prompt's own dropdowns still open — is **deferred**, not refused: it is
 * remembered and run when the hold is released, if the element is still connected and still not
 * shown. A `popover` element that has not been shown is `display: none` by the browser's own rule,
 * so a deferred overlay paints nothing at all until then. Nothing breaks; it simply waits for the
 * question to be answered.
 *
 * Taking the hold also moves the owner's open popovers to the top of the layer, because the owner
 * and an attacker can open in the same batch: an action raising the host's confirmation and a
 * `$setLocal` mounting a modal, in one handler array, both land before anything could observe the
 * first. Re-raising when the hold begins means the host's prompt ends up last however the batch was
 * ordered.
 */

type ShowFn = (this: HTMLElement, ...args: unknown[]) => unknown;

interface TopLayerState {
  /** The elements holding the top layer, newest last. Only the newest decides. */
  holders: Element[];
  /** What was asked to enter while held, in the order it asked. Each runs once, on release. */
  deferred: { element: HTMLElement; show: () => void }[];
}

/*
  On the window rather than in this module, because this module is not one thing at runtime: the
  package builds each primitive as its own bundle (`splitting: false`), so a copy of this file can be
  loaded more than once — the same hazard that keeps `@we/drag` external. Two copies each holding
  their own list would let a hold taken through one be invisible to the wrap installed by the other.
*/
const STATE_KEY = '__weTopLayer';
function state(): TopLayerState {
  const host = globalThis as unknown as Record<string, TopLayerState | undefined>;
  return (host[STATE_KEY] ??= { holders: [], deferred: [] });
}

/**
 * Whether `node` is `ancestor` or inside it, crossing shadow roots.
 *
 * Composed rather than `Node.contains`, which stops at a shadow boundary: a host prompt's buttons
 * and dropdowns live inside `we-modal`'s and `we-select`'s own shadow roots, and must still count as
 * the prompt's.
 */
function composedContains(ancestor: Node, node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}

/** Whether `element` may enter the top layer now. Always, unless something holds it. */
export function mayEnterTopLayer(element: Element): boolean {
  const { holders } = state();
  const holder = holders[holders.length - 1];
  return !holder || composedContains(holder, element);
}

/** Is it in the top layer already? A browser without the selector answers no. */
function isShown(element: HTMLElement): boolean {
  try {
    if (element instanceof HTMLDialogElement && element.open) return true;
    return element.matches(':popover-open');
  } catch {
    return false;
  }
}

/** Every open popover inside `owner`, in document order, through shadow roots. */
function openPopoversIn(owner: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      if (el.hasAttribute('popover') && isShown(el)) found.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(owner);
  return found;
}

/**
 * Hold the top layer for `owner` until the returned release is called.
 *
 * The host calls this while one of its safety prompts is open, with the element the prompts render
 * into. Releasing runs whatever was deferred, oldest first.
 */
export function holdTopLayer(owner: Element): () => void {
  const { holders } = state();
  holders.push(owner);

  // Last in the layer, whatever arrived in the same batch. See the module docblock.
  for (const popover of openPopoversIn(owner)) {
    try {
      popover.hidePopover();
      popover.showPopover();
    } catch {
      // Detached in the meantime, or no Popover API. Nothing to raise.
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = holders.lastIndexOf(owner);
    if (index !== -1) holders.splice(index, 1);
    if (!holders.length) flushDeferred();
  };
}

function flushDeferred(): void {
  const waiting = state().deferred.splice(0);
  for (const { element, show } of waiting) {
    // Unmounted while it waited — closed, or its template went away. Nothing to show.
    if (!element.isConnected || isShown(element)) continue;
    // A popover that stopped being one (the attribute removed) would throw rather than show.
    if (!(element instanceof HTMLDialogElement) && !element.hasAttribute('popover')) continue;
    try {
      show();
    } catch {
      // Same as above: a race with whatever changed it, and the element is not ours to repair.
    }
  }
}

/**
 * Route every `showPopover` and `showModal` in this window through {@link mayEnterTopLayer}.
 *
 * Called once by the host at start-up, before anything renders. Returns the uninstall, which tests
 * use; the app never uninstalls it. Idempotent per window.
 */
export function installTopLayerGuard(win: Window & typeof globalThis = window): () => void {
  const marker = '__weTopLayerGuard';
  const flagged = win as unknown as Record<string, unknown>;
  if (flagged[marker]) return () => {};

  const restores: (() => void)[] = [];
  const wrap = (proto: object | undefined, name: 'showPopover' | 'showModal') => {
    const original = proto && (Object.getOwnPropertyDescriptor(proto, name)?.value as ShowFn | undefined);
    if (!proto || typeof original !== 'function') return;
    const guarded: ShowFn = function (this: HTMLElement, ...args: unknown[]) {
      if (mayEnterTopLayer(this)) return original.apply(this, args);
      const { deferred } = state();
      if (!deferred.some((entry) => entry.element === this)) {
        deferred.push({ element: this, show: () => original.apply(this, args) });
      }
      return undefined;
    };
    Object.defineProperty(proto, name, { value: guarded, configurable: true, writable: true });
    restores.push(() => Object.defineProperty(proto, name, { value: original, configurable: true, writable: true }));
  };

  wrap(win.HTMLElement?.prototype, 'showPopover');
  wrap(win.HTMLDialogElement?.prototype, 'showModal');
  flagged[marker] = true;

  return () => {
    for (const restore of restores) restore();
    delete flagged[marker];
    state().deferred.splice(0);
    state().holders.splice(0);
  };
}
