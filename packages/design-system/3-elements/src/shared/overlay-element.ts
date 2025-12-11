import { getDesignSystemCSS } from './helpers';
import { DesignSystemElement } from './design-system-element';

/**
 * Base class for overlay components (modals, drawers, dropdowns) that have:
 * - A full-viewport backdrop (host)
 * - Sized content (base element)
 *
 * Differs from DesignSystemElement by applying sizing props to [part="base"] instead of :host
 * This allows width, height, etc. to control the modal/drawer content size, not the backdrop.
 */

export abstract class OverlayElement extends DesignSystemElement {
  private _updateOverlayDesignSystem() {
    if (!this._dsStyle) return;

    // Get the base design system CSS
    const baseCSS = getDesignSystemCSS(this, this.getInstanceProps());

    // Extract component name for scoped variables
    const componentName = this.tagName.toLowerCase().replace('we-', '');

    // Create the overlay overrides
    const overlayOverrides = `
      /* Force host to always be full viewport */
      :host([data-we-static-css-ready]) {
        position: fixed;
        width: 100vw !important;
        height: 100vh !important;
        min-width: unset !important;
        min-height: unset !important;
        max-width: unset !important;
        max-height: unset !important;
        margin: 0 !important;
      }

      /* Apply sizing props to [part="base"] instead of :host */
      :host([data-we-static-css-ready]) [part="base"] {
        width: var(--we-${componentName}-width) !important;
        height: var(--we-${componentName}-height) !important;
        min-width: var(--we-${componentName}-min-width) !important;
        min-height: var(--we-${componentName}-min-height) !important;
        max-width: var(--we-${componentName}-max-width) !important;
        max-height: var(--we-${componentName}-max-height) !important;
        margin: var(--we-${componentName}-margin) !important;
      }
    `;

    // Combine base CSS with overlay overrides
    this._dsStyle.textContent = baseCSS + '\n' + overlayOverrides;
  }

  // Lifecycle hooks to update overlay design system CSS
  override firstUpdated() {
    super.firstUpdated();
    this._updateOverlayDesignSystem();
  }

  override updated() {
    super.updated();
    this._updateOverlayDesignSystem();
  }
}
