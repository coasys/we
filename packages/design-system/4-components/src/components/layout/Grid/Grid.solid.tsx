export type * from './Grid.types';
import { parseAspect, solveTiling, type Tiling } from '@we/design-utils';
import { createSignal, type JSX, onCleanup } from 'solid-js';

import { createLayoutComponent } from '../createLayoutComponent';
import type { GridProps } from './Grid.types';

/**
 * Grid items only.
 *
 * Children are counted from the DOM so a `$each` over live data needs no bookkeeping, but not
 * everything inside a grid is a tile: an absolutely positioned overlay, or the tier sentinel a
 * `$surface` puts in every one of its boxes, would otherwise be solved for as if it needed a cell.
 */
const UNTILED = '[data-we-untiled], [data-we-surface-tier]';

/**
 * Measure the grid and solve for the arrangement that makes fixed-aspect children largest.
 *
 * Lives here rather than in `finalizeStyle` because it needs the element: no amount of prop
 * inspection answers "how wide did this end up". The maths is a pure function in `@we/design-utils`
 * so the call module can ask the same question about its panel without importing a component.
 *
 * `contentBoxSize`, not `getBoundingClientRect`, so padding and borders are excluded — the tracks
 * divide the content box, and solving against the border box overflows by exactly the padding.
 */
function useTiling(props: GridProps): { ref?: (el: HTMLElement) => void; style?: () => JSX.CSSProperties } {
  if (props.childAspect === undefined) return {};

  const [tiling, setTiling] = createSignal<Tiling>({ columns: 1, rows: 1 });
  let last: Tiling | undefined;

  const ref = (el: HTMLElement) => {
    if (typeof ResizeObserver === 'undefined') return;

    const solve = (width: number, height: number) => {
      const count = [...el.children].filter((child) => !child.matches(UNTILED)).length;
      const style = getComputedStyle(el);
      // The grid's own gap, read rather than passed: a caller setting `gap="400"` should not also
      // have to tell the solver about it, and the two disagreeing is a fit that misses by a token.
      const gap = parseFloat(style.rowGap || style.gap || '0') || 0;
      const next = solveTiling(
        count,
        { width, height },
        { aspect: parseAspect(props.childAspect), gap, current: last },
      );
      if (last && last.columns === next.columns && last.rows === next.rows) return;
      last = next;
      setTiling(next);
      props.onArrange?.(next);
    };

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentBoxSize?.[0];
      solve(box ? box.inlineSize : el.clientWidth, box ? box.blockSize : el.clientHeight);
    });
    observer.observe(el);

    // Children arriving or leaving changes the answer as much as a resize does, and no resize
    // necessarily follows — six tiles becoming five in a box nobody touched is a re-solve.
    const children = new MutationObserver(() => solve(el.clientWidth, el.clientHeight));
    children.observe(el, { childList: true });

    onCleanup(() => {
      observer.disconnect();
      children.disconnect();
    });
  };

  const style = () => ({
    'grid-template-columns': `repeat(${tiling().columns}, 1fr)`,
    // Rows divide the box rather than being derived from content, which is what makes overflow
    // impossible however many children arrive.
    'grid-auto-rows': '1fr',
  });

  return { ref, style };
}

const render = createLayoutComponent<GridProps>({
  defaults: { display: 'grid', gap: '400' },
  ownKeys: ['template', 'columns', 'minChildWidth', 'rows', 'childAspect', 'onArrange'],
  direction: 'column',
  hook: useTiling,
  finalizeStyle: (style, props) => {
    // `childAspect` is deliberately absent from this chain: it is solved against the measured box,
    // so its tracks are written by the hook above, which applies last.
    const gridTemplate = props.template
      ? props.template
      : props.minChildWidth
        ? `repeat(auto-fill, minmax(${props.minChildWidth}, 1fr))`
        : props.childAspect !== undefined
          ? undefined
          : `repeat(${props.columns ?? 1}, 1fr)`;
    return {
      ...style,
      ...(gridTemplate !== undefined && { 'grid-template-columns': gridTemplate }),
      ...(props.rows !== undefined && { 'grid-template-rows': props.rows }),
    };
  },
});

/** @superclass DesignSystemElement */
export function Grid(allProps: GridProps) {
  return render(allProps);
}
