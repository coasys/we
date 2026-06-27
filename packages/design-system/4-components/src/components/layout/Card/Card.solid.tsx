import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, useStateProps } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Card.types';
import type { CardProps } from './Card.types';

const DEFAULTS: Partial<CardProps> = {
  r: 'var(--we-theme-surface-radius, var(--we-radius-400))',
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
    return buildLayoutStyles(props, direction());
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
