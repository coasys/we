import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, getBgImageAttrs, type LayoutProps, useStateProps } from '@we/design-utils/solid';
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
export interface LayoutComponentConfig<P extends LayoutProps> {
  /** DS-prop defaults merged beneath the caller's props. */
  defaults?: Partial<P>;
  /** Component-own prop names: split off with the DS props but excluded from style building. */
  ownKeys?: readonly (keyof P & string)[];
  /** Flex direction — fixed, or derived from props (Card). Defaults to 'column'. */
  direction?: 'row' | 'column' | ((props: P) => 'row' | 'column');
  /** Optional last-step transform over the computed style (Grid template, Card opacity). */
  finalizeStyle?: (style: JSX.CSSProperties, props: P) => JSX.CSSProperties;
}

export function createLayoutComponent<P extends LayoutProps>(
  config: LayoutComponentConfig<P>,
): (allProps: P) => JSX.Element {
  const ownKeys = config.ownKeys ?? [];
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
      const merged = mergeProps(usedProps, config.defaults ?? {}) as P;
      const style = buildLayoutStyles(merged, direction());
      return config.finalizeStyle ? config.finalizeStyle(style, designSystemProps as P) : style;
    });

    const hasStateProps = () =>
      designSystemProps.hoverProps ||
      designSystemProps.activeProps ||
      designSystemProps.focusProps ||
      designSystemProps.disabledProps;

    const { style, attrs } = useStateProps(baseStyle, designSystemProps as P, direction());

    return (
      <div
        style={hasStateProps() ? style() : baseStyle()}
        {...getBgImageAttrs(designSystemProps)}
        {...rest}
        {...(hasStateProps() ? attrs : {})}
      >
        {designSystemProps.children}
      </div>
    );
  };
}
