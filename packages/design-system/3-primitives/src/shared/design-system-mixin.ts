import type { DesignSystemProps } from '@we/design-system-types';
import { designSystemKeys, filterProps, mergeProps, stateKeys } from '@we/design-system-utils';
import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';

type Constructor<T = any> = new (...args: any[]) => T;

type MixedClass<T extends Constructor<LitElement>> = {
  new (...args: any[]): InstanceType<T> & {
    getInstanceProps(): Partial<DesignSystemProps>;
  };
} & T;

// Mixin to add WE design system properties and methods to a LitElement
export function DesignSystemMixin<T extends Constructor<LitElement>>(Base: T): MixedClass<T> {
  // Separate primitive keys from state keys
  const stateKeySet = new Set<string>(stateKeys);
  const primitiveKeys = designSystemKeys.filter((key) => !stateKeySet.has(key));

  // Define all non-string primitive types (add more as needed, currently only 'wrap' is non-string)
  const primitiveTypes: Record<string, any> = { wrap: Boolean };

  // Apply all design system properties to the element
  primitiveKeys.forEach((key) => property({ type: primitiveTypes[key] || String, reflect: true })(Base.prototype, key));
  stateKeys.forEach((key) => property({ type: Object, attribute: false })(Base.prototype, key));

  // Create the mixin
  class DesignSystemMixed extends Base {
    // Placeholder for default prop getter defined on the instance itself
    static getDefaultProps?(): Partial<DesignSystemProps>;

    // Get the merged instance props combining used props and default props
    public getInstanceProps() {
      const usedProps = filterProps(this as Record<string, unknown>, designSystemKeys);
      const defaultProps = (this.constructor as typeof DesignSystemMixed).getDefaultProps?.() ?? {};
      return mergeProps(usedProps, defaultProps) as Partial<DesignSystemProps>;
    }
  }

  return DesignSystemMixed as MixedClass<T>;
}
