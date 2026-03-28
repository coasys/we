import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Row.types';
import type { RowProps } from './Row.types';

const DEFAULTS: Partial<RowProps> = {};
const rowKeys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children'];

export function Row(allProps: RowProps) {
  const [designSystemProps, rest] = splitProps(allProps, rowKeys as (keyof RowProps)[]);
  const usedProps = filterProps(designSystemProps, rowKeys);
  const props = mergeProps(usedProps, DEFAULTS) as RowProps;
  const reactiveStyles = createMemo(() => buildLayoutStyles(props, 'row'));

  return (
    <div style={reactiveStyles()} {...rest}>
      {props.children}
    </div>
  );
}
