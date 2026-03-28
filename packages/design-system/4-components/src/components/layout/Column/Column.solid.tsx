import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Column.types';
import type { ColumnProps } from './Column.types';

const DEFAULTS: Partial<ColumnProps> = {};
const columnKeys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children'];

export function Column(allProps: ColumnProps) {
  const [designSystemProps, rest] = splitProps(allProps, columnKeys as (keyof ColumnProps)[]);
  const usedProps = filterProps(designSystemProps, columnKeys);
  const props = mergeProps(usedProps, DEFAULTS) as ColumnProps;
  const reactiveStyles = createMemo(() => buildLayoutStyles(props, 'column'));

  return (
    <div style={reactiveStyles()} {...rest}>
      {props.children}
    </div>
  );
}
