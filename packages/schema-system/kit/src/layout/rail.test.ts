/**
 * A rail button says when something is happening behind it.
 *
 * The signal that "somebody's extraction pass is running" used to be a square in the call bar,
 * which only exists during a call and doubled as the switch that stops the pass. The rail is where
 * the panel is opened from and outlives the call, so the glance moved here — and it is asserted on
 * the expansion because the failure mode is silent: a button with no busy state simply never spins.
 */
import { describe, expect, it } from 'vitest';

import { railButton, railGroup } from './rail.ts';

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

/**
 * A group heading's action, in both the forms it can be given.
 *
 * The object form is the one every caller used while there was only one; the node form arrived when
 * the spaces group needed `+` to offer two things — create a space, or join one — which is a menu,
 * and there is no honest way to write a menu as `{ icon, label, onClick }`.
 */
describe('a rail group’s heading action', () => {
  /** The action sits inside an `$if` on the rail being expanded — there is no room for it collapsed. */
  const actionOf = (group: Node) => {
    const json = JSON.stringify(group);
    return { json, group };
  };

  it('expands the short form into a labelled icon button', () => {
    // A store-free handler, because this package is the portable tier and names no store — the
    // real caller passes one in. `portable.test.ts` checks the tests too, which is how it should be.
    const onClick = { $setLocal: 'addOpen', value: true };
    const { json } = actionOf(
      railGroup({
        id: 'spaces',
        label: 'Spaces',
        action: { icon: 'plus', label: 'Add', onClick },
        children: [],
      }) as Node,
    );

    expect(json).toContain('"we-tooltip"');
    expect(json).toContain('"name":"plus"');
    // The accessible name too, not only the tooltip: an icon-only button has no visible word to
    // serve as one, and a tooltip is not a label.
    expect(json).toContain('"label":"Add"');
  });

  it('places a node as it was given, so a heading can offer more than one thing', () => {
    const menu = {
      type: 'DropdownMenu',
      props: { triggerIcon: 'plus', items: [{ id: 'join', label: 'Join a space' }] },
    };
    const { json } = actionOf(railGroup({ id: 'spaces', label: 'Spaces', action: menu, children: [] }) as Node);

    expect(json).toContain('"DropdownMenu"');
    expect(json).toContain('"Join a space"');
    // And it is not wrapped in the icon-button treatment, which would put a button inside a button.
    expect(json).not.toContain('"we-tooltip"');
  });
});
