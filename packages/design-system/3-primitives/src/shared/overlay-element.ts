import { focusSelector } from '@we/design-utils';
import type { LitElement } from 'lit';

import { DesignSystemElement } from './design-system-element';

/**
 * Base class for overlay components (modals, drawers, dropdowns) that have:
 * - A full-viewport backdrop (host)
 * - Sized content (base element)
 *
 * Differs from DesignSystemElement by applying sizing props to [part="base"] instead of :host.
 * This allows width, height, etc. to control the modal/drawer content size, not the backdrop.
 *
 * Uses a separate adopted stylesheet (no !important needed) that wins via cascade order —
 * it's adopted after the DS stylesheet, so at equal specificity the overlay rules win.
 *
 * Uses the Popover API (popover="manual") to promote the host to the browser's top layer.
 * This escapes any ancestor CSS containing-block traps — backdrop-filter, transform, filter —
 * that would otherwise confine position:fixed to the ancestor's bounds instead of the viewport.
 * The element stays in its original DOM position so CSS variable inheritance (including
 * scoped theme vars on ancestor wrappers) is fully preserved.
 */

type ComponentCtor = abstract new (...args: unknown[]) => LitElement;

// Cache of overlay stylesheets — one per component class
const overlayStyleSheets = new WeakMap<ComponentCtor, CSSStyleSheet>();

/**
 * Every overlay currently on screen, oldest first.
 *
 * Overlays stack for real — a modal raises a "discard this?" confirmation *over* itself, and the
 * one underneath has to stay open while the question is answered. Each one listens for Escape on
 * `document`, so without a stack every open overlay reacts to the same keypress: Escape on that
 * confirmation dismissed the confirmation *and* re-ran the close it was asking about. Backdrop
 * clicks never had this problem, since only the topmost backdrop is under the pointer.
 */
const openOverlays: OverlayElement[] = [];

export abstract class OverlayElement extends DesignSystemElement {
  // Marker property for runtime detection (minification-safe)
  static readonly isOverlay = true;

  /**
   * Whether this overlay is the one a keypress belongs to.
   *
   * Protected rather than private so each overlay's own keydown handler can gate on it — the base
   * class cannot own the handler itself, because what Escape *means* differs (a modal closes; a
   * drawer closes; something with an inner editor may want to swallow it first).
   */
  protected isTopmostOverlay(): boolean {
    return openOverlays[openOverlays.length - 1] === this;
  }

  override connectedCallback() {
    super.connectedCallback();
    const ctor = this.constructor as ComponentCtor;

    // Pushed on connect, so the order is mount order — which for overlays is the order they were
    // stacked in, since each is mounted by the thing that opened it.
    if (!openOverlays.includes(this)) openOverlays.push(this);

    // Mark as overlay for specificity (matches :host([data-we-overlay]))
    this.setAttribute('data-we-overlay', '');

    // Promote to the browser's top layer so position:fixed always resolves to the viewport,
    // regardless of ancestor backdrop-filter / transform / filter containing blocks.
    // popover="manual" disables light-dismiss — our own close handlers remain in control.
    this.setAttribute('popover', 'manual');
    /*
      Guarded, because a browser without the Popover API throws here rather than degrading.

      An unguarded call is a `TypeError` in `connectedCallback` — which does not fail the overlay,
      it fails the *element*, so a WebView predating Popover rendered no modals, no drawers and no
      popovers at all rather than rendering them un-promoted. The promotion is an enhancement (it
      escapes an ancestor's containing-block trap); losing it is a layout problem in an unusual
      ancestor, and losing the element is every dialog in the app.
    */
    try {
      this.showPopover();
    } catch {
      // No top layer here. `position: fixed` resolves against the nearest containing block instead.
    }

    // Create and cache the overlay stylesheet (once per class)
    if (!overlayStyleSheets.has(ctor)) {
      const componentName = this.tagName.toLowerCase().replace('we-', '');
      const p = `--we-${componentName}-`;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        /* Force host to always be full viewport */
        :host([data-we-overlay]) {
          position: fixed;
          inset: 0;
          /* Dynamic units: on a phone the address bar makes 100vh taller than what is visible, so
             a full-screen overlay measured that way puts its last rows under the browser chrome and
             its close button off the bottom of the screen. Identical to vh on a desktop. */
          width: 100dvw;
          height: 100dvh;
          min-width: unset;
          min-height: unset;
          max-width: unset;
          max-height: unset;
          margin: 0;
          /* Reset UA [popover] defaults that would otherwise leak through */
          padding: 0;
          border: none;
          background: transparent;
          overflow: visible;
          color: inherit;
          /* z-index is a no-op in the top layer but kept for fallback environments */
          z-index: var(--we-z-modal);
        }

        /* Apply sizing props to [part="base"] instead of :host */
        :host([data-we-overlay]) [part="base"] {
          width: var(${p}width);
          height: var(${p}height);
          min-width: var(${p}min-width);
          min-height: var(${p}min-height);
          max-width: var(${p}max-width);
          max-height: var(${p}max-height);
          margin: var(${p}margin);
          background: color-mix(in srgb, var(${p}bg, transparent) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent);
          backdrop-filter: blur(var(--we-theme-surface-blur, 0px));
        }

        /* Re-apply color-mix + backdrop-filter for state selectors — without this, the DS-generated
           hover/active/focus rules win due to higher specificity, snapping back to full opacity.
           The focus arm is built from the same shared focusSelector() the DS generator uses, so it
           cannot drift: if it matched a wider set of states than the rule it exists to override, an
           overlay would apply its focus background in situations where the DS applies nothing. */
        :host([data-we-overlay]) [part="base"]:hover:not(:disabled):not([aria-disabled='true']) {
          background: color-mix(in srgb, var(${p}hover-bg, var(${p}bg, transparent)) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent);
          backdrop-filter: blur(var(--we-theme-surface-blur, 0px));
        }
        ${focusSelector(`:host([data-we-overlay]) [part="base"]`, `:not(:disabled):not([aria-disabled='true'])`)} {
          background: color-mix(in srgb, var(${p}focus-bg, var(${p}bg, transparent)) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent);
          backdrop-filter: blur(var(--we-theme-surface-blur, 0px));
        }
        :host([data-we-overlay]) [part="base"]:active:not(:disabled):not([aria-disabled='true']) {
          background: color-mix(in srgb, var(${p}active-bg, var(${p}bg, transparent)) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent);
          backdrop-filter: blur(var(--we-theme-surface-blur, 0px));
        }
        :host([data-we-overlay]) [part="base"]:disabled,
        :host([data-we-overlay]) [part="base"][aria-disabled='true'] {
          background: color-mix(in srgb, var(${p}disabled-bg, var(${p}bg, transparent)) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent);
          backdrop-filter: blur(var(--we-theme-surface-blur, 0px));
        }
      `);
      overlayStyleSheets.set(ctor, sheet);
    }

    // Adopt after the DS stylesheet (last = highest cascade priority)
    const root = this.shadowRoot;
    if (root) {
      const sheet = overlayStyleSheets.get(ctor)!;
      if (!root.adoptedStyleSheets.includes(sheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      }
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    const i = openOverlays.indexOf(this);
    if (i !== -1) openOverlays.splice(i, 1);
    this.releaseFocus();
    // The browser auto-hides popovers on disconnect, but we call explicitly for clarity.
    try {
      this.hidePopover();
    } catch {
      // Already hidden or popover API unavailable
    }
  }

  // ── Focus containment ───────────────────────────────────────────────────────
  //
  // ## Why this is in the base class, and why it is not the obvious query
  //
  // `we-modal` had a trap and it never ran once. It queried `[part=base]`'s **shadow** subtree for
  // focusables — and a modal's content is *slotted light DOM*, so the list was always empty and the
  // handler returned on every keypress. `we-drawer` had no trap at all. Both declared
  // `aria-modal="true"`, which is a promise that focus is contained; neither kept it. A keyboard
  // user tabbed straight out behind the scrim and went on interacting with an app they could not
  // see, still being told they were in a dialog.
  //
  // The fix has to walk the **composed** tree: the focusable things are in the light DOM (slotted
  // by the consumer), inside `we-button`'s and `we-input`'s own shadow roots (so a plain
  // `querySelectorAll` misses them), or both at once. `collectFocusable` descends slots and shadow
  // roots for that reason.
  //
  // Here rather than in `we-modal` because every overlay that says `aria-modal` owes the same thing,
  // and the one that did not have it is the evidence that a copy per overlay does not get written.

  /** What had focus when the overlay opened, so closing can give it back. */
  private _previouslyFocused: HTMLElement | null = null;

  /** Everything focusable inside the overlay, in tab order, across slots and shadow roots. */
  protected collectFocusable(): HTMLElement[] {
    const found: HTMLElement[] = [];
    const seen = new Set<Node>();

    const visit = (node: Node) => {
      if (seen.has(node)) return;
      seen.add(node);

      if (node instanceof HTMLSlotElement) {
        // Slotted light-DOM content, which is what a consumer actually puts in a dialog and what the
        // old query could never see.
        for (const assigned of node.assignedNodes({ flatten: true })) visit(assigned);
        return;
      }

      if (node instanceof HTMLElement) {
        if (node !== this && isFocusable(node)) found.push(node);
        // Into the component's own shadow root: `we-button` renders a real `<button>` in there, and
        // that is the thing that takes focus.
        if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) visit(child);
      }

      for (const child of node.childNodes) visit(child);
    };

    if (this.renderRoot) for (const child of (this.renderRoot as ParentNode).childNodes) visit(child);
    return found;
  }

  /**
   * Keep Tab inside the overlay. Call from the overlay's own keydown handler.
   *
   * Returns whether it acted, so a caller can tell "wrapped" from "let it through".
   */
  protected trapFocus(e: KeyboardEvent): boolean {
    const focusable = this.collectFocusable();
    if (!focusable.length) {
      // Nothing to focus, so nowhere for Tab to go *inside*. Refusing it outright is still better
      // than letting focus escape a dialog that claims to be modal.
      e.preventDefault();
      return true;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // `deepActiveElement`, because the focused thing is usually inside a component's shadow root and
    // `document.activeElement` reports the host — under which every comparison here is false.
    const active = deepActiveElement();
    if (e.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
      e.preventDefault();
      last.focus();
      return true;
    }
    if (!e.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
      e.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  /**
   * Remember what had focus and move it inside. Call once the overlay's content has rendered.
   *
   * The first focusable thing, not the dialog itself: a dialog opens because somebody is about to
   * do something, and putting the caret in the field they came for is the difference between a
   * keyboard user starting work and hunting for it.
   */
  protected captureFocus(): void {
    if (this._previouslyFocused) return;
    this._previouslyFocused = deepActiveElement();
    const focusable = this.collectFocusable();
    // Skip the close button when there is anything else: "Close" is a poor first stop in a dialog
    // that asked a question.
    const target = focusable.find((el) => el.getAttribute('part') !== 'close-button') ?? focusable[0];
    target?.focus();
  }

  /** Give focus back to whatever had it. Called on disconnect. */
  protected releaseFocus(): void {
    const previous = this._previouslyFocused;
    this._previouslyFocused = null;
    if (previous?.isConnected) previous.focus();
  }
}

/** The focused element, through shadow roots — `document.activeElement` stops at the host. */
function deepActiveElement(): HTMLElement | null {
  let active = document.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  return active;
}

/** Whether this element can take focus right now. */
function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.tabIndex < 0) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href');
  if (['button', 'input', 'select', 'textarea'].includes(tag)) return true;
  if (el.hasAttribute('tabindex')) return true;
  // A custom element that made itself focusable — `we-button` sets tabindex on its inner control,
  // so the host is skipped and the control found instead.
  return false;
}
