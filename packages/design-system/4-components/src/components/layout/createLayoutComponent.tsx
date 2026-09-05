import { designSystemKeys, filterProps, mergeProps, tierKeys } from '@we/design-utils';
import { buildLayoutStyles, getBgImageAttrs, type LayoutProps, useStateProps } from '@we/design-utils/solid';
import { type ThemeFamily, themeFamily } from '@we/tokens';
import { createMemo, type JSX, splitProps } from 'solid-js';

/**
 * The one implementation behind Column, Row, Grid and Card.
 *
 * The four layout components differ only in their defaults, their flex
 * direction, any component-own props (Grid's template/columns/minChildWidth,
 * Card's direction), and an optional final style transform (Grid's
 * grid-template-columns, Card's surface-opacity color-mix). Everything else —
 * prop splitting, style building, bg-image attrs, and the hover/active/focus/
 * disabled state wiring — is this shared scaffold, so a state-handling fix
 * lands in all four at once.
 */
/**
 * Defaults every layout component gets, beneath its own.
 *
 * `overflowWrap` is here rather than in each of the four configs because it is not a fact about
 * Column as opposed to Grid — it is the design system's answer to a string with nowhere to break,
 * the same answer the typography primitives give (see `BASE_TYPOGRAPHY_SPECS`). It inherits, so
 * setting it on the box also covers text these components hold directly: a bare string child, a
 * native `<p>` or `<span>` in a template, rendered block content. Without it, only text that
 * happened to be wrapped in `we-text` would break, which is the sort of half-fix that reads as
 * inconsistent styling rather than as a rule.
 */
const LAYOUT_DEFAULTS: Partial<LayoutProps> = { overflowWrap: 'anywhere' };

export interface LayoutComponentConfig<P extends LayoutProps> {
  /**
   * The theme family this component belongs to — the layer-4 counterpart of `COMPONENT_CASCADE`.
   *
   * A primitive says this once and never mentions it again: `we-modal` is registered as a surface
   * and gets radius, padding and gap from the theme without a prop at any call site. Layer-4
   * components had no equivalent, because they build inline styles rather than adopting a generated
   * stylesheet — so the only way for `Card` to say "I am a surface" was to say it three times, once
   * per axis, and the components that did not bother said it as raw `var()` strings instead.
   *
   * Declared here rather than as a prop because it is a fact about the component, not about the
   * call. A `Card` is a surface; no caller should be able to say otherwise. What varies per call —
   * `EditableImage` being an avatar here and a banner there — is what the family *names* are for,
   * and those stay available on `r`, `p` and `gap`.
   *
   * Expands to whichever axes the family carries (see `themeFamily.ts`), beneath `defaults` and the
   * caller's own props, so both still override it.
   */
  family?: ThemeFamily;
  /** DS-prop defaults merged beneath the caller's props. */
  defaults?: Partial<P>;
  /** Component-own prop names: split off with the DS props but excluded from style building. */
  ownKeys?: readonly (keyof P & string)[];
  /** Flex direction — fixed, or derived from props (Card). Defaults to 'column'. */
  direction?: 'row' | 'column' | ((props: P) => 'row' | 'column');
  /** Optional last-step transform over the computed style (Grid template, Card opacity). */
  finalizeStyle?: (style: JSX.CSSProperties, props: P) => JSX.CSSProperties;
  /**
   * Optional per-component behaviour that needs the element itself.
   *
   * `finalizeStyle` is a pure function of the props, which is enough for everything the layout
   * components did until one of them had to *measure*: `Grid`'s `childAspect` picks its track count
   * from the box it ends up occupying, and no amount of prop inspection can answer that. Runs in the
   * component body, so it may hold signals and register cleanup like any other Solid code.
   */
  hook?: (props: P) => { ref?: (el: HTMLElement) => void; style?: () => JSX.CSSProperties };
}

/**
 * A family name on every axis the family carries — `{ r: 'surface', p: 'surface', gap: 'surface' }`.
 *
 * Derived from the table so a family gaining an axis reaches its components with no edit here, and
 * so a family that has no padding (see `themeFamily.ts` for why `control` and `input` do not) cannot
 * accidentally be given one.
 */
const AXIS_PROP = { radius: 'r', padding: 'p', gap: 'gap' } as const;

function familyDefaults(family: ThemeFamily | undefined): Record<string, string> {
  if (!family) return {};
  return Object.fromEntries(
    Object.keys(themeFamily[family]).map((axis) => [AXIS_PROP[axis as keyof typeof AXIS_PROP], family]),
  );
}

export function createLayoutComponent<P extends LayoutProps>(
  config: LayoutComponentConfig<P>,
): (allProps: P) => JSX.Element {
  const ownKeys = config.ownKeys ?? [];
  const family = familyDefaults(config.family);
  const keys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children', ...ownKeys];
  const styleKeys = keys.filter((key) => key !== 'children' && !ownKeys.includes(key as keyof P & string));

  return function LayoutComponent(allProps: P) {
    const [designSystemProps, rest] = splitProps(allProps, keys as (keyof P)[]);
    const direction = () =>
      typeof config.direction === 'function'
        ? config.direction(designSystemProps as P)
        : (config.direction ?? 'column');

    const baseStyle = createMemo(() => {
      const usedProps = filterProps(designSystemProps as Record<string, unknown>, styleKeys);
      const merged = mergeProps(usedProps, { ...LAYOUT_DEFAULTS, ...family, ...config.defaults }) as P;
      const style = buildLayoutStyles(merged, direction());
      return config.finalizeStyle ? config.finalizeStyle(style, designSystemProps as P) : style;
    });

    // Both axes of variance route through the same var indirection, so either one is reason enough
    // to use it. Missing the tier half here would leave `mdUpProps` typechecking and doing nothing.
    const hasVariantProps = () =>
      designSystemProps.hoverProps ||
      designSystemProps.activeProps ||
      designSystemProps.focusProps ||
      designSystemProps.disabledProps ||
      tierKeys.some((key) => (designSystemProps as Record<string, unknown>)[key]);

    const { style, attrs, checkSurface } = useStateProps(baseStyle, designSystemProps as P, direction());
    const extras = config.hook?.(designSystemProps as P);

    const composedRef = (el: HTMLElement) => {
      checkSurface(el);
      extras?.ref?.(el);
      // A caller's own ref still gets the element: `rest` is spread before this, so without
      // forwarding it here the component would silently swallow it.
      const own = (rest as { ref?: unknown }).ref;
      if (typeof own === 'function') (own as (e: HTMLElement) => void)(el);
    };

    return (
      <div
        style={{ ...(hasVariantProps() ? style() : baseStyle()), ...(extras?.style?.() ?? {}) }}
        {...getBgImageAttrs(designSystemProps)}
        {...rest}
        {...(hasVariantProps() ? attrs : {})}
        ref={composedRef}
      >
        {designSystemProps.children}
      </div>
    );
  };
}
