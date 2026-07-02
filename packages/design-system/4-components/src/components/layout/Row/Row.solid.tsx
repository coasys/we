import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, getBgImageAttrs, useStateProps } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Row.types';
import type { RowProps } from './Row.types';

const DEFAULTS: Partial<RowProps> = {};
const rowKeys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children'];
const rowStyleKeys = rowKeys.filter((key) => key !== 'children');

export function Row(allProps: RowProps) {
  const [designSystemProps, rest] = splitProps(allProps, rowKeys as (keyof RowProps)[]);
  const baseStyle = createMemo(() => {
    const usedProps = filterProps(designSystemProps, rowStyleKeys);
    const props = mergeProps(usedProps, DEFAULTS) as RowProps;
    return buildLayoutStyles(props, 'row');
  });

  const hasStateProps = () =>
    designSystemProps.hoverProps || designSystemProps.activeProps || designSystemProps.focusProps;

  const { style, attrs } = useStateProps(baseStyle, designSystemProps as RowProps, 'row');

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
}
