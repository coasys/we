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
import { chromeRail, sidebar } from '@we/template-shell';
import { zIndex } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { PANEL_LAYER_BASE } from '../src/shared/dockGeometry';
import { dockFrame } from '../src/shared/registries/dockRegistry';

/** The `props` of the first node in a tree carrying every named prop. */
function propsWithAll(node: unknown, ...keys: string[]): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = propsWithAll(item, ...keys);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  if (props && keys.every((key) => key in props)) return props;
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const found = propsWithAll(value, ...keys);
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

    // The panel's own box — identified by its shadow, which nothing else in the frame has. The drag
    // guides also carry a `zIndex` and a `bg`, and they sit a layer higher on purpose (see below).
    // Its z-index is a step on the sticky band the geometry hands it, not the band's name: see the
    // next test for the band, and `layerOrder` for the step.
    expect(propsWithAll(dock, 'zIndex', 'shadow')?.zIndex).toEqual({ $: "shellStore.dockGeometry['call:0'].layer" });
    expect(propsWithAll(sidebar, 'zIndex')?.zIndex).toBe('chrome');
  });

  it('puts the module rail on that layer too, rather than trusting document order', () => {
    /*
      The regression this file exists for, arriving from the other side.

      The rail said `sticky` and stayed above the panels because it registers after them at the same
      anchor and they all shared one layer — so the last one painted won. The moment panels could be
      *raised* they stopped sharing a layer, and a raised one covered the rail and the pickers that
      open out of it over the content: the chrome you get out of a panel with, underneath the panel.
      Document order is not a layering rule; the ladder has a rung for this.
    */
    expect(propsWithAll(chromeRail, 'zIndex')?.zIndex).toBe('chrome');
  });

  it('counts panels up from sticky and never reaches chrome', () => {
    /*
      A panel paints at `PANEL_LAYER_BASE + n`, n being how many panels were touched before it. The
      base is a copy of the token, for arithmetic, and this is what keeps the copy honest. The
      headroom is what keeps a raised panel from climbing over the sidebar: fifty steps is more
      panels than a screen can hold.
    */
    expect(PANEL_LAYER_BASE).toBe(Number(zIndex.sticky));
    expect(PANEL_LAYER_BASE + 32).toBeLessThan(Number(zIndex.chrome));
  });
});
