import type { DesignSystemProps } from '@we/design-types';
import type { DSLayer } from '@we/design-utils';
import { type CSSResultGroup, type CSSResultOrNative, LitElement, unsafeCSS } from 'lit';

import { DesignSystemMixin } from './design-system-mixin';
import { DS_LAYER_ORDER, getStaticDSStyles, updateAllCustomVars } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript requires any[] for mixin constructors
type ComponentCtor = abstract new (...args: any[]) => LitElement;

// Cache of DS stylesheets — one per component class, created once, reused for all instances
const dsStyleSheets = new WeakMap<ComponentCtor, CSSStyleSheet>();

// A component style moved into the base layer, keyed by the style it came from — `sharedStyles`
// is in most primitives' `static styles`, and one layered copy of it serves all of them.
const baseLayered = new WeakMap<object, CSSResultOrNative>();

/**
 * A component's own style, inside `we-base`.
 *
 * Built from the authored text. Re-serialising parsed rules looked equivalent and is not: CSSOM
 * serialisation of a shorthand holding `var()` comes back lossy, which on a prototype of this took
 * `we-spinner`'s ring borders and `we-skeleton`'s wave gradient. Only a native sheet with no source
 * text falls back to its rules.
 */
function inBaseLayer(style: CSSResultOrNative): CSSResultOrNative {
  let layered = baseLayered.get(style);
  if (!layered) {
    const text =
      'cssText' in style && typeof style.cssText === 'string'
        ? style.cssText
        : Array.from((style as CSSStyleSheet).cssRules, (rule) => rule.cssText).join('\n');
    layered = unsafeCSS(`${DS_LAYER_ORDER}\n@layer we-base {\n${text}\n}`);
    baseLayered.set(style, layered);
  }
  return layered;
}

// Shared DS lifecycle: adopt static stylesheet + dirty-checked custom var updates
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript requires any[] for mixin constructors
function applyDSBehavior<T extends new (...args: any[]) => LitElement>(Base: T): T {
  return class extends Base {
    /**
     * The component's `static styles`, moved into the base cascade layer as Lit finalizes them.
     *
     * A rule outside every layer beats every layer, so a component sheet adopted as written would
     * override every breakpoint and state the DS sheet declares — see "Cascade layers" in
     * `helpers.ts`. Once per class, before anything is adopted: rewriting an instance's adopted
     * sheets after Lit had adopted them measured as a real cost on mount.
     */
    static finalizeStyles(styles?: CSSResultGroup): CSSResultOrNative[] {
      const finalize = (LitElement as unknown as { finalizeStyles(s?: CSSResultGroup): CSSResultOrNative[] })
        .finalizeStyles;
      return finalize.call(this, styles).map(inBaseLayer);
    }

    _prevDSSnapshot?: string;
    _componentName?: string;

    connectedCallback() {
      super.connectedCallback();
      const ctor = this.constructor as ComponentCtor;
      this._componentName = this.tagName.toLowerCase().replace('we-', '');

      // Create and cache the static DS stylesheet (once per component class)
      if (!dsStyleSheets.has(ctor)) {
        const sheet = new CSSStyleSheet();
        const ctorMeta = ctor as unknown as Record<string, unknown>;
        const layers = ctorMeta.__dsLayers as readonly DSLayer[] | undefined;
        const defaultProps = (ctorMeta.getDefaultProps as (() => Partial<DesignSystemProps>) | undefined)?.();
        sheet.replaceSync(getStaticDSStyles(this._componentName, layers, defaultProps));
        dsStyleSheets.set(ctor, sheet);
      }

      // Adopt the DS stylesheet after Lit's own styles. Within `we-base` that still decides ties at
      // equal specificity; the tier and state layers it also brings sit above both.
      const root = this.shadowRoot;
      if (root) {
        const sheet = dsStyleSheets.get(ctor)!;
        if (!root.adoptedStyleSheets.includes(sheet)) {
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        }
      }
    }

    updated(changedProperties: Map<PropertyKey, unknown>) {
      super.updated(changedProperties);
      const el = this as unknown as {
        getInstanceProps(): Partial<DesignSystemProps>;
        getRawProps(): Partial<DesignSystemProps>;
      };
      const props = el.getInstanceProps();
      const snapshot = JSON.stringify(props);
      if (snapshot === this._prevDSSnapshot) return;
      this._prevDSSnapshot = snapshot;
      updateAllCustomVars(this, this._componentName!, props, el.getRawProps());
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
