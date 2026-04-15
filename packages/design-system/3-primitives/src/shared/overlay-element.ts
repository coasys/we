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
          z-index: 9999;
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
}
