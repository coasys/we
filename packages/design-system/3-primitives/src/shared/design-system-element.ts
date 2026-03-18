import type { DSLayer } from '@we/design-utils';
import { LitElement } from 'lit';

import { DesignSystemMixin } from './design-system-mixin';
import { getDesignSystemCSS } from './helpers';

// Shared lifecycle logic for DS elements (dynamic style injection)
function applyDSLifecycle<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base {
    protected _dsStyle?: HTMLStyleElement;

    private _updateDesignSystem() {
      if (!this._dsStyle) return;
      this._dsStyle.textContent = getDesignSystemCSS(this as any, (this as any).getInstanceProps());
    }

    firstUpdated() {
      this._dsStyle = document.createElement('style');
      (this as any).renderRoot.appendChild(this._dsStyle);
      this._updateDesignSystem();
    }

    updated() {
      this._updateDesignSystem();
    }
  };
}

// Class form: default all layers, CEM-compatible (existing DS-aware components extend this)
export abstract class DesignSystemElement extends applyDSLifecycle(DesignSystemMixin(LitElement)) {}

// Factory form: returns a base class scoped to specific layers (for migrated components)
export function DSElement(layers: DSLayer[]) {
  return applyDSLifecycle(DesignSystemMixin(LitElement, layers));
}
