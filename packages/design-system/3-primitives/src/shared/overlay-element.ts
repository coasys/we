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

export abstract class OverlayElement extends DesignSystemElement {
  // Marker property for runtime detection (minification-safe)
  static readonly isOverlay = true;

  override connectedCallback() {
    super.connectedCallback();
    const ctor = this.constructor as ComponentCtor;

    // Mark as overlay for specificity (matches :host([data-we-overlay]))
    this.setAttribute('data-we-overlay', '');

    // Promote to the browser's top layer so position:fixed always resolves to the viewport,
    // regardless of ancestor backdrop-filter / transform / filter containing blocks.
    // popover="manual" disables light-dismiss — our own close handlers remain in control.
    this.setAttribute('popover', 'manual');
    this.showPopover();

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
          width: 100vw;
          height: 100vh;
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
           hover/active/focus rules win due to higher specificity, snapping back to full opacity. */
        :host([data-we-overlay]) [part="base"]:hover:not(:disabled):not([aria-disabled='true']) {
          background: color-mix(in srgb, var(${p}hover-bg, var(${p}bg, transparent)) calc(var(--we-theme-surface-opacity, 1) * 100%), transparent);
          backdrop-filter: blur(var(--we-theme-surface-blur, 0px));
        }
        :host([data-we-overlay]) [part="base"]:focus-within:not(:disabled):not([aria-disabled='true']) {
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
    // The browser auto-hides popovers on disconnect, but we call explicitly for clarity.
    try {
      this.hidePopover();
    } catch {
      // Already hidden or popover API unavailable
    }
  }
}
