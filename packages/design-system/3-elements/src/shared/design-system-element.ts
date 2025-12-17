import type { DesignSystemProps } from '@we/design-system-types';
import { LitElement } from 'lit';

import { DesignSystemMixin } from './design-system-mixin';
import { getDesignSystemCSS } from './helpers';

// Base class for all design system elements
export abstract class DesignSystemElement extends DesignSystemMixin(LitElement) {
  // Style element to hold design system CSS
  protected _dsStyle?: HTMLStyleElement;

  // Update the design system CSS based on current props
  private _updateDesignSystem() {
    if (!this._dsStyle) return;
    this._dsStyle.textContent = getDesignSystemCSS(this, this.getInstanceProps());
  }

  firstUpdated() {
    // Create a style element to hold design system CSS variables and append it to the render root
    this._dsStyle = document.createElement('style');
    this.renderRoot.appendChild(this._dsStyle);

    // Initial update of design system CSS
    this._updateDesignSystem();
  }

  updated() {
    // Update design system CSS whenever the component updates
    this._updateDesignSystem();
  }
}
