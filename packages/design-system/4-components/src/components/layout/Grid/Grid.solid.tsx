export type * from './Grid.types';
import { createLayoutComponent } from '../createLayoutComponent';
import type { GridProps } from './Grid.types';

const render = createLayoutComponent<GridProps>({
  defaults: { display: 'grid', gap: '400' },
  ownKeys: ['template', 'columns', 'minChildWidth', 'rows'],
  direction: 'column',
  finalizeStyle: (style, props) => {
    const gridTemplate = props.template
      ? props.template
      : props.minChildWidth
        ? `repeat(auto-fill, minmax(${props.minChildWidth}, 1fr))`
        : `repeat(${props.columns ?? 1}, 1fr)`;
    return {
      ...style,
      'grid-template-columns': gridTemplate,
      ...(props.rows !== undefined && { 'grid-template-rows': props.rows }),
    };
  },
});

/** @superclass DesignSystemElement */
export function Grid(allProps: GridProps) {
  return render(allProps);
}
