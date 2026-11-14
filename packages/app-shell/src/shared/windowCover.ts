/**
 * An element of the app that covers the whole window — a phone's menu, open — and so is, for that
 * time, the only thing there is.
 *
 * A compact rail (`railShell`'s `compact`) covers the window while it is open. Drawn over the page
 * was all it did: the page underneath stayed in the tab order and in the accessibility tree, so Tab
 * past the menu's last control landed on a page nobody could see, and a screen reader read it out
 * as though it were there. A cover is a modal surface and owes what a modal does, and the host pays
 * it once here for any element that says it covers the window (`COVER_ATTR="true"`), rather than
 * each app or template reimplementing it:
 *
 * - **Everything else is inert** — every sibling of the cover and of each of its ancestors up to the
 *   app's layer — which takes it out of the tab order, out of the pointer's reach and out of the
 *   accessibility tree, the one attribute doing all three.
 * - **Tab stays inside**, wrapping from the last control to the first and back, across shadow roots
 *   (a `we-button`'s real `<button>` is inside its own).
 * - **Focus goes back** to what had it when the cover opened — the control that opened it — when it
 *   closes and leaves focus nowhere: on the body, or on a control the closing hid.
 *
 * Closing is the cover's own business (the rail's Escape), since only it holds the state that opens
 * it. The same arrangement as the safety prompts, which make the app layer inert from the host
 * rather than asking each template to cooperate.
 */

/** Set to `"true"` on an element while it covers the window; anything else is not covering. */
export const COVER_ATTR = 'data-we-covers-window';

/** The element nested deepest that has focus, through shadow roots — `document.activeElement` stops at a host. */
function deepActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Whether Tab can land on this element. The same test `we-modal`'s trap uses (`overlay-element.ts`). */
function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.tabIndex < 0) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href');
  if (['button', 'input', 'select', 'textarea'].includes(tag)) return true;
  return el.hasAttribute('tabindex');
}

/** Whether an element is drawn: a folded group's rows are in the DOM and not reachable. */
function isDrawn(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/** Everything focusable inside `root`, in document order, through slots and shadow roots. */
export function focusableWithin(root: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (node: Node) => {
    if (node instanceof HTMLSlotElement) {
      for (const assigned of node.assignedNodes({ flatten: true })) visit(assigned);
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.inert) return;
      if (isFocusable(node) && isDrawn(node)) found.push(node);
      if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) visit(child);
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of root.childNodes) visit(child);
  return found;
}

/** Whether `node` is `root` or inside it, through shadow roots. */
function within(root: Element, node: Node | null): boolean {
  for (let at: Node | null = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) {
    if (at === root) return true;
  }
  return false;
}

/**
 * Make everything in `layer` but `cover` inert. Returns what it changed, so undoing it leaves alone
 * an element something else had already made inert.
 */
function inertAround(cover: Element, layer: Element): HTMLElement[] {
  const changed: HTMLElement[] = [];
  for (let at: Element = cover; at !== layer && at.parentElement; at = at.parentElement) {
    for (const sibling of at.parentElement.children) {
      if (sibling === at || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
  }
  return changed;
}

/**
 * Watch `layer` for an element covering the window, and hold the rest of it inert, Tab inside, and
 * focus's way back, while one does. Returns the way to stop.
 *
 * Several can be open at once — a sheet opened from inside the menu, or a cover laid beside it — and
 * the one in front is the one opened last, not the first in the document: inside a nested cover the
 * outer one's controls are as covered as the page, and the older of two side by side is covered by
 * the newer. Each remembers what had focus as it opened, so closing one gives focus back to its own
 * opener, inside the cover that is in front again.
 */
export function installWindowCover(layer: HTMLElement): () => void {
  /** Every element covering the window, in the order they opened, with what had focus as each did. */
  const opened = new Map<Element, HTMLElement | null>();
  /** The one in front, which the rest is held inert around. */
  let cover: Element | null = null;
  let changed: HTMLElement[] = [];

  /*
    Whether something above the app has the keyboard, and the trap stands aside: the layer made inert
    by the host (a safety prompt, drawn outside it), or focus in a surface outside the layer (that
    prompt, a portal). Sending Tab back into the cover then sent it into an inert layer, where focus
    cannot go, and left the person nowhere. Focus on nothing at all — the body — is still the cover's
    to take.
  */
  const elsewhere = (node: Node | null): boolean =>
    layer.closest('[inert]') !== null ||
    (node !== null && node !== document.body && node !== document.documentElement && !within(layer, node));

  const onKeyDown = (event: KeyboardEvent) => {
    if (!cover || event.key !== 'Tab') return;
    const active = deepActiveElement();
    if (elsewhere(active)) return;
    const focusable = focusableWithin(cover);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const inside = focusable.includes(active as HTMLElement);
    if (event.shiftKey ? !inside || active === first : !inside || active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  // Focus arriving outside while covered — from a click on what is left uncovered, or a script —
  // is taken back in.
  const onFocusIn = (event: FocusEvent) => {
    const target = event.composedPath()[0] as Node | undefined;
    if (!cover || !target || within(cover, target) || elsewhere(target)) return;
    focusableWithin(cover)[0]?.focus();
  };

  /** Hold everything in the layer but `next` inert, and Tab inside it. */
  const hold = (next: Element) => {
    cover = next;
    changed = inertAround(next, layer);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
  };
  /** Let go of the cover in front, and give focus back to `back` if the letting go left it nowhere. */
  const release = (back: HTMLElement | null) => {
    for (const el of changed) el.inert = false;
    changed = [];
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    cover = null;
    if (!back) return;
    /*
      After the frame, once what the closing hid has been laid out as hidden — before that the
      focused row still reports itself drawn. Only when focus is nowhere: closed by a control that
      went somewhere and put focus there, it stays where it was put.
    */
    requestAnimationFrame(() => {
      const active = deepActiveElement();
      const lost = !active || active === document.body || (active instanceof HTMLElement && !isDrawn(active));
      if (lost && back.isConnected && isDrawn(back)) back.focus();
    });
  };

  const update = () => {
    // Gone from the layer counts as closed, mark or no mark: a cover unmounted while open is not open.
    const marked = new Set(layer.querySelectorAll(`[${COVER_ATTR}="true"]`));
    let back: HTMLElement | null = null;
    for (const [el, opener] of opened) {
      if (marked.has(el)) continue;
      opened.delete(el);
      if (el === cover) back = opener;
    }
    const active = deepActiveElement();
    for (const el of marked) {
      if (!opened.has(el)) opened.set(el, active instanceof HTMLElement && active !== document.body ? active : null);
    }
    const next = [...opened.keys()].pop() ?? null;
    if (next === cover) {
      // The same cover, and something else arrived beside it: hold that inert as well.
      if (cover) changed.push(...inertAround(cover, layer));
      return;
    }
    // Covered by a newer one rather than closed: no focus to give back yet.
    if (cover) release(back);
    if (next) hold(next);
  };

  /*
    The mark anywhere in the app, and anything added or taken away anywhere in it: the rail is nested
    under the app's chrome, so a cover can leave with an ancestor, still marked, and only the subtree
    sees that. One observer, because observing one node twice replaces the first set of options with
    the second. Records arrive in batches, so a busy page costs one lookup per batch.
  */
  const observer = new MutationObserver(update);
  observer.observe(layer, { subtree: true, childList: true, attributes: true, attributeFilter: [COVER_ATTR] });
  update();
  return () => {
    observer.disconnect();
    if (cover) release(opened.get(cover) ?? null);
    opened.clear();
  };
}
