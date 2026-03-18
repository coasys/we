import type { DSLayer } from '@we/design-utils';
import { LitElement } from 'lit';

import { DesignSystemMixin } from './design-system-mixin';
import { getStaticDSStyles, updateAllCustomVars } from './helpers';

type ComponentCtor = abstract new (...args: unknown[]) => LitElement;

// Cache of DS stylesheets — one per component class, created once, reused for all instances
const dsStyleSheets = new WeakMap<ComponentCtor, CSSStyleSheet>();

// Shared DS lifecycle: adopt static stylesheet + dirty-checked custom var updates
function applyDSBehavior<T extends new (...args: any[]) => LitElement>(Base: T): T {
  return class extends Base {
    _prevDSSnapshot?: string;
    _componentName?: string;

    connectedCallback() {
      super.connectedCallback();
      const ctor = this.constructor as ComponentCtor;
      this._componentName = this.tagName.toLowerCase().replace('we-', '');

      // Create and cache the static DS stylesheet (once per component class)
      if (!dsStyleSheets.has(ctor)) {
        const sheet = new CSSStyleSheet();
        const layers = (ctor as any).__dsLayers as readonly DSLayer[] | undefined;
        sheet.replaceSync(getStaticDSStyles(this._componentName, layers));
        dsStyleSheets.set(ctor, sheet);
      }

      // Adopt the DS stylesheet after Lit's own styles (last = highest cascade priority)
      const root = this.shadowRoot;
      if (root) {
        const sheet = dsStyleSheets.get(ctor)!;
        if (!root.adoptedStyleSheets.includes(sheet)) {
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        }
      }
    }

    updated() {
      const props = (this as any).getInstanceProps();
      const snapshot = JSON.stringify(props);
      if (snapshot === this._prevDSSnapshot) return;
      this._prevDSSnapshot = snapshot;
      updateAllCustomVars(this, this._componentName!, props);
    }
  } as unknown as T;
}

// Class form: default all layers, CEM-compatible (existing DS-aware components extend this)
export abstract class DesignSystemElement extends applyDSBehavior(DesignSystemMixin(LitElement)) {}

// Factory form: returns a base class scoped to specific layers (for migrated components)
export function DSElement(layers: DSLayer[]) {
  return applyDSBehavior(DesignSystemMixin(LitElement, layers));
}

// Pre-built base classes for common layer combinations (CEM-compatible — no function call in extends)
export abstract class LayoutElement extends applyDSBehavior(DesignSystemMixin(LitElement, ['layout'])) {}
export abstract class LayoutTypographyElement extends applyDSBehavior(
  DesignSystemMixin(LitElement, ['layout', 'typography']),
) {}
export abstract class LayoutVisualElement extends applyDSBehavior(
  DesignSystemMixin(LitElement, ['layout', 'visual']),
) {}
export abstract class LayoutVisualTypographyElement extends applyDSBehavior(
  DesignSystemMixin(LitElement, ['layout', 'visual', 'typography']),
) {}
