export type * from './Column.types';
import { createLayoutComponent } from '../createLayoutComponent';
import type { ColumnProps } from './Column.types';

const render = createLayoutComponent<ColumnProps>({ direction: 'column' });

/** @superclass DesignSystemElement */
export function Column(allProps: ColumnProps) {
  return render(allProps);
}
