import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, useStateProps } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Grid.types';
import type { GridProps } from './Grid.types';

const DEFAULTS: Partial<GridProps> = { display: 'grid', gap: '400' };
const gridOwnKeys = ['columns', 'minChildWidth'] as const;
const gridKeys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children', ...gridOwnKeys];
const gridStyleKeys = gridKeys.filter((key) => key !== 'children');

export function Grid(allProps: GridProps) {
  const [designSystemProps, rest] = splitProps(allProps, gridKeys as (keyof GridProps)[]);

  const baseStyle = createMemo(() => {
    const { columns, minChildWidth, ...dsProps } = designSystemProps as GridProps & {
      columns?: number;
      minChildWidth?: string;
    };
    const usedProps = filterProps(
      dsProps as Record<string, unknown>,
      gridStyleKeys.filter((k) => !gridOwnKeys.includes(k as (typeof gridOwnKeys)[number])),
    );
    const merged = mergeProps(usedProps, DEFAULTS) as GridProps;
    const style = buildLayoutStyles(merged, 'column');

    const gridTemplate = minChildWidth
      ? `repeat(auto-fill, minmax(${minChildWidth}, 1fr))`
      : `repeat(${columns ?? 1}, 1fr)`;

    return { ...style, 'grid-template-columns': gridTemplate };
  });

  const hasStateProps = () =>
    designSystemProps.hoverProps || designSystemProps.activeProps || designSystemProps.focusProps;

  const { style, handlers } = useStateProps(baseStyle, designSystemProps as GridProps, 'column');

  return (
    <div style={hasStateProps() ? style() : baseStyle()} {...rest} {...(hasStateProps() ? handlers : {})}>
      {designSystemProps.children}
    </div>
  );
}
