/**
 * Chrome outranks the panels it sits beside.
 *
 * The two edges keep this true by opposite means, and only one of them is expressible as geometry.
 * The right edge reserves nothing (`RAIL_PX = 0`) and slides the module rail inwards out of a
 * panel's way. The left edge cannot: `SIDEBAR_PX` reserves it so a left dock opens *beside* the
 * sidebar, and the sidebar itself is what the whole layout is measured from — so there it is a
 * question of stacking, and stacking is the thing no screenshot of a working app will catch.
 *
 * It was wrong for as long as docks have existed and showed only in one gesture: collapsed, the
 * sidebar and a left dock never overlap, so nothing was visible until the pointer arrived and the
 * rail expanded from 80px to 240px — behind the video panel.
 *
 * Asserted against the tokens and the schema rather than a render, because both halves are static
 * decisions: a dock is placed on `sticky` by `dockFrame`, and chrome asks for the layer above it.
 */
import { sidebar } from '@we/template-shell';
import { zIndex } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { dockFrame } from '../src/shared/registries/dockRegistry';

/** The `props` of the first node in a tree carrying the named prop. */
function propsWith(node: unknown, key: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = propsWith(item, key);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  if (props && key in props) return props;
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const found = propsWith(value, key);
      if (found) return found;
    }
  }
  return null;
}

describe('the shell sidebar and a docked panel', () => {
  it('puts persistent chrome above panels that come and go', () => {
    expect(Number(zIndex.chrome)).toBeGreaterThan(Number(zIndex.sticky));
    // Still under the layers that are meant to cover everything — a modal, a toast, a tooltip.
    expect(Number(zIndex.chrome)).toBeLessThan(Number(zIndex.modal));
  });

  it('is not settled by DOM order, which favours the panel', () => {
    // The sidebar registers at `dock-left` and every module dock at `dock-right`, and ANCHOR_ORDER
    // puts dock-left first — so at equal z-index the panel paints last and wins. The sidebar cannot
    // win this by being declared later; it has to outrank.
    const dock = dockFrame({ id: 'call:0', edge: 'left' } as never, { type: 'Column' } as never);

    expect(propsWith(dock, 'zIndex')?.zIndex).toBe('sticky');
    expect(propsWith(sidebar, 'zIndex')?.zIndex).toBe('chrome');
  });
});
