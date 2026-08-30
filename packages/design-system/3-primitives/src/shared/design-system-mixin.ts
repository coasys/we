import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps, stateKeys, tierKeys } from '@we/design-utils';
import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mixin constructor pattern requires flexible constructor type
type Constructor<T = LitElement> = new (...args: any[]) => T;

const ALL_LAYERS: DSLayer[] = ['layout', 'visual', 'flex', 'typography', 'state'];

type MixedClass<T extends Constructor<LitElement>> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mixin pattern requires any for constructor spread
  new (...args: any[]): InstanceType<T> & {
    getInstanceProps(): Partial<DesignSystemProps>;
    getRawProps(): Partial<DesignSystemProps>;
  };
  /** The DS layers this component has opted into. */
  readonly __dsLayers: readonly DSLayer[];
} & T;

// Define all non-string primitive types (add more as needed, currently only 'wrap' is non-string)
const primitiveTypes: Record<string, unknown> = { wrap: Boolean };

// Mixin to add WE design system properties and methods to a LitElement
export function DesignSystemMixin<T extends Constructor<LitElement>>(
  Base: T,
  layers: DSLayer[] = ALL_LAYERS,
): MixedClass<T> {
  const activeKeys = getKeysForLayers(layers);
  const hasState = layers.includes('state');
  const stateKeySet = new Set<string>(stateKeys);

  /*
    Register the layer keys as reactive properties — and `styles` as an object, like the state props
    below, since a stringified one would be meaningless as an attribute.

    Without that registration Lit never re-renders on a `styles` change, so the escape hatch would
    apply whatever it happened to hold at first paint and ignore every change after. It is filtered
    out of `primitiveKeys` for the same reason it is listed separately: those are reflected strings.
  */
  /*
    Tier bags are objects, like the state bags, and are registered as such.

    `getKeysForLayers` now includes them, which is what makes `mdUpProps` reach `filterProps` at all
    — but reaching it as a *reflected string property* would be a second version of the same bug:
    Lit would stringify the bag into an attribute, and reading it back gives `[object Object]`.
    Registered the same way `hoverProps` is, which is what they are: a partial prop bag applying
    under a condition.

    Unlike the state bags they are not gated on the `state` layer. A tier is not a kind of property,
    it is a condition under which any kind applies — an element with no hover behaviour can still be
    laid out differently at a different width.
  */
  const tierKeySet = new Set<string>(tierKeys);
  const primitiveKeys = activeKeys.filter((key) => !stateKeySet.has(key) && !tierKeySet.has(key) && key !== 'styles');
  property({ type: Object, attribute: false })(Base.prototype, 'styles');
  primitiveKeys.forEach((key) => property({ type: primitiveTypes[key] || String, reflect: true })(Base.prototype, key));
  tierKeys.forEach((key) => property({ type: Object, attribute: false })(Base.prototype, key));
  if (hasState) {
    stateKeys.forEach((key) => property({ type: Object, attribute: false })(Base.prototype, key));
  }

  // Create the mixin
  class DesignSystemMixed extends Base {
    /** The DS layers this component has opted into. */
    static readonly __dsLayers: readonly DSLayer[] = layers;

    // Placeholder for default prop getter defined on the instance itself
    static getDefaultProps?(): Partial<DesignSystemProps>;

    // Get the merged instance props combining used props and default props
    public getInstanceProps() {
      const usedProps = filterProps(this as Record<string, unknown>, activeKeys);
      const defaultProps = (this.constructor as typeof DesignSystemMixed).getDefaultProps?.() ?? {};
      return mergeProps(usedProps, defaultProps) as Partial<DesignSystemProps>;
    }

    // Get only the props explicitly set on this element (no DEFAULT_PROPS fill).
    // Used by updateAllCustomVars to skip setting instance CSS vars for props that
    // came from DEFAULT_PROPS, letting the static theme cascade take effect instead.
    public getRawProps() {
      return filterProps(this as Record<string, unknown>, activeKeys) as Partial<DesignSystemProps>;
    }
  }

  return DesignSystemMixed as MixedClass<T>;
}
