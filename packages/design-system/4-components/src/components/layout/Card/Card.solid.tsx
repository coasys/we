import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, useStateProps } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Card.types';
import type { CardProps } from './Card.types';

const DEFAULTS: Partial<CardProps> = {
  r: 'var(--we-theme-surface-radius, var(--we-radius-400))',
  p: 'var(--we-theme-surface-spacing, var(--we-space-500))',
  gap: 'var(--we-theme-surface-gap, var(--we-space-400))',
  shadow: 'var(--we-theme-shadow, none)',
};

const cardOwnKeys = ['direction'] as const;
const cardKeys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children', ...cardOwnKeys];
const cardStyleKeys = cardKeys.filter((key) => key !== 'children');

export function Card(allProps: CardProps) {
  const [designSystemProps, rest] = splitProps(allProps, cardKeys as (keyof CardProps)[]);
  const direction = () => (designSystemProps as CardProps).direction ?? 'column';

  const baseStyle = createMemo(() => {
    const { direction: _dir, ...dsProps } = designSystemProps as CardProps & { direction?: string };
    const usedProps = filterProps(
      dsProps as Record<string, unknown>,
      cardStyleKeys.filter((k) => k !== 'direction'),
    );
    const props = mergeProps(usedProps, DEFAULTS) as CardProps;
    const style = buildLayoutStyles(props, direction());
    // Apply surface opacity to background only (not element content) when bg is set
    // and the caller hasn't explicitly set opacity.
    if ((designSystemProps as CardProps).opacity === undefined) {
      const bgColor = (style as Record<string, unknown>)['background-color'] as string | undefined;
      if (bgColor) {
        (style as Record<string, unknown>)['background-color'] =
          `color-mix(in srgb, ${bgColor} calc(var(--we-theme-surface-opacity, 1) * 100%), transparent)`;
        (style as Record<string, unknown>)['backdrop-filter'] = 'blur(var(--we-theme-surface-blur, 0px))';
      }
    }
    return style;
  });

  const hasStateProps = () =>
    designSystemProps.hoverProps || designSystemProps.activeProps || designSystemProps.focusProps;

  const { style, handlers } = useStateProps(baseStyle, designSystemProps as CardProps, direction());

  return (
    <div style={hasStateProps() ? style() : baseStyle()} {...rest} {...(hasStateProps() ? handlers : {})}>
      {designSystemProps.children}
    </div>
  );
}
