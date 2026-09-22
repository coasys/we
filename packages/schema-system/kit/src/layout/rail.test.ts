/**
 * A rail button says when something is happening behind it.
 *
 * The signal that "somebody's extraction pass is running" used to be a square in the call bar,
 * which only exists during a call and doubled as the switch that stops the pass. The rail is where
 * the panel is opened from and outlives the call, so the glance moved here — and it is asserted on
 * the expansion because the failure mode is silent: a button with no busy state simply never spins.
 */
import { describe, expect, it } from 'vitest';

import { railButton } from './rail.ts';

type Node = { type: string; props?: Record<string, unknown>; children?: Node[] };

const glyph = (button: Node) => (button.children?.[0] as Node).children?.[0] as Node;

describe('a rail button', () => {
  it('is only an icon when nothing can be busy behind it', () => {
    const button = railButton({ icon: 'gear', tooltip: 'Settings' }) as Node;

    expect(glyph(button)).toEqual({ type: 'we-icon', props: { name: 'gear' } });
  });

  it('swaps the icon for a spinner while busy, rather than adding one beside it', () => {
    // A rail button is a square with one glyph in it. A second object beside the icon makes the
    // column's width a lie, exactly as a label would.
    const busy = { $: 'mod.busy' };
    const button = railButton({ icon: 'sparkle', tooltip: 'Extraction', busy }) as Node;
    const swap = glyph(button);

    expect(swap.type).toBe('$if');
    expect(swap.props?.condition).toBe(busy);
    expect((swap.props?.then as Node).type).toBe('we-spinner');
    expect(swap.props?.else).toEqual({ type: 'we-icon', props: { name: 'sparkle' } });
  });
});
