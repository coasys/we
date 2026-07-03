import { designSystemKeys, filterProps, mergeProps } from '@we/design-utils';
import { buildLayoutStyles, getBgImageAttrs, useStateProps } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';

export type * from './Column.types';
import type { ColumnProps } from './Column.types';

const DEFAULTS: Partial<ColumnProps> = {};
const columnKeys = [...designSystemKeys.filter((key) => key !== 'direction'), 'reverse', 'children'];
const columnStyleKeys = columnKeys.filter((key) => key !== 'children');

/** @superclass DesignSystemElement */
export function Column(allProps: ColumnProps) {
  const [designSystemProps, rest] = splitProps(allProps, columnKeys as (keyof ColumnProps)[]);
  const baseStyle = createMemo(() => {
    const usedProps = filterProps(designSystemProps, columnStyleKeys);
    const props = mergeProps(usedProps, DEFAULTS) as ColumnProps;
    return buildLayoutStyles(props, 'column');
  });

  const hasStateProps = () =>
    designSystemProps.hoverProps || designSystemProps.activeProps || designSystemProps.focusProps;

  const { style, attrs } = useStateProps(baseStyle, designSystemProps as ColumnProps, 'column');

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
