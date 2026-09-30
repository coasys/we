export type * from './Row.types';
import { createLayoutComponent } from '../createLayoutComponent';
import type { RowProps } from './Row.types';

const render = createLayoutComponent<RowProps>({ direction: 'row' });

/** @superclass DesignSystemElement */
export function Row(allProps: RowProps) {
  return render(allProps);
}
