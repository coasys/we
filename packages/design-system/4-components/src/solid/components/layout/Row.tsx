import type { FlexCrossAxis, FlexMainAxis } from '@we/design-system-types';
import { designSystemKeys, filterProps, mergeProps } from '@we/design-system-utils';
import { buildLayoutStyles, type LayoutProps } from '@we/solid-utils';
import { createMemo, splitProps } from 'solid-js';

export type RowProps = Omit<LayoutProps, 'ax' | 'ay'> & { ax?: FlexMainAxis; ay?: FlexCrossAxis };

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
