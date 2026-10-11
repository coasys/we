/**
 * The four ways a timeline can be read — anchored at the newest or the oldest end, drawn with the
 * newest at the bottom or the top — and the one question they come down to: which end is anchored.
 *
 * Asserted by evaluating the expressions rather than by reading them, because each is a comparison of
 * two booleans and a reader checking the string checks the easy half. Scroll position itself is the
 * browser's; this pins what the scroller is told.
 */
import { evaluateExpression, getFunction, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { timeline, timelineMoreAt, timelineOrder } from './timeline.ts';

/** Evaluate one expression with `local` bound, the way the renderer would. */
const value = (expression: string, locals: Record<string, unknown>) =>
  evaluateExpression(parseExpression(expression), {
    root: (name) => (name === 'local' ? { bound: true, value: locals } : { bound: false, value: undefined }),
    call: (name, args) => (getFunction(name)?.impl as ((a: unknown[]) => unknown) | undefined)?.(args),
  });

const CASES = [
  // fromStart, orientation, anchored at bottom, drawn order of [newest-first query]
  { fromStart: false, orientation: 'newestBottom', bottom: true },
  { fromStart: false, orientation: 'newestTop', bottom: false },
  { fromStart: true, orientation: 'newestBottom', bottom: false },
  { fromStart: true, orientation: 'newestTop', bottom: true },
];

describe('a timeline', () => {
  for (const { fromStart, orientation, bottom } of CASES) {
    const name = `${fromStart ? 'from the start' : 'following the live end'}, ${orientation}`;
    const locals = { fromStart, orientation, rows: fromStart ? [1, 2, 3] : [3, 2, 1] };

    it(`draws the rows the right way round — ${name}`, () => {
      const drawn = value(timelineOrder('local.rows', 'local.fromStart', 'local.orientation'), locals);
      // Newest at the bottom reads 1, 2, 3 down the page whichever end is loaded; newest at the top, 3, 2, 1.
      expect(drawn).toEqual(orientation === 'newestBottom' ? [1, 2, 3] : [3, 2, 1]);
    });

    it(`puts "more" at the edge away from the anchor — ${name}`, () => {
      expect(value(timelineMoreAt('start', 'local.fromStart', 'local.orientation'), locals)).toBe(bottom);
      expect(value(timelineMoreAt('end', 'local.fromStart', 'local.orientation'), locals)).toBe(!bottom);
    });

    it(`pins the anchored end — ${name}`, () => {
      const node = timeline({
        fromStart: 'local.fromStart',
        orientation: 'local.orientation',
        children: [],
        onLoadOlder: { $action: 'older' },
        onLoadNewer: { $action: 'newer' },
        onJumpNewest: { $action: 'newest' },
        onJumpOldest: { $action: 'oldest' },
      });
      const pin = (node.props as { pin: { $: string } }).pin.$;
      expect(value(pin, locals)).toBe(bottom ? 'end' : '');
    });
  }

  it('jumps to the newest at whichever edge the newest is drawn', () => {
    const node = timeline({
      fromStart: 'local.fromStart',
      orientation: 'local.orientation',
      children: [],
      onLoadOlder: { $action: 'older' },
      onLoadNewer: { $action: 'newer' },
      onJumpNewest: { $action: 'newest' },
      onJumpOldest: { $action: 'oldest' },
    });
    const props = node.props as Record<string, { $if: { condition: { $: string }; then: unknown; else: unknown } }>;
    // Top is newest only when drawn newest-at-top: then the top button means "newest".
    expect(props['on:jumpstart'].$if.then).toEqual({ $action: 'newest' });
    expect(props['on:jumpstart'].$if.else).toEqual({ $action: 'oldest' });
    expect(props['on:jumpend'].$if.then).toEqual({ $action: 'oldest' });
    expect(value(props['on:jumpstart'].$if.condition.$, { orientation: 'newestTop' })).toBe(true);
  });
});
