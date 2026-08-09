/**
 * Dock geometry — where a docked module panel lands, and what the app gives up for it.
 *
 * Worth testing directly rather than through a rendered shell, because every interesting case is a
 * decision about *whether* to give up room, and those are the cases a screenshot cannot tell apart:
 * a panel that floats and a panel that insets look identical until you look at what is behind them.
 */
import { describe, expect, it } from 'vitest';

import { contentInset, dockThickness, MIN_DOCK_PX, NARROW_VIEWPORT_PX, resolveDock } from '../src/shared/dockGeometry';

const desktop = { width: 1600, height: 900 };
const laptop = { width: NARROW_VIEWPORT_PX - 100, height: 700 };

const dock = (over: Partial<Parameters<typeof resolveDock>[0]> = {}) => ({
  id: 'call:0',
  edge: 'right' as const,
  size: 'md' as const,
  float: false,
  ...over,
});

describe('resolveDock', () => {
  it('takes the edge outright, leaving nothing for chrome to sit in', () => {
    const geometry = resolveDock(dock(), desktop);

    // Flush to the window edge. Panels used to open *beside* the module rail, which left them
    // stranded in the middle of the edge with the rail outside them and the editor's own rails on
    // top — three things claiming one edge. Floating chrome positions itself against the content
    // region instead, so opening a dock slides it inwards. See `RAIL_PX`.
    expect(geometry.right).toBe('0px');
    expect(geometry.top).toBeDefined();
    expect(geometry.bottom).toBeDefined();
    expect(geometry.floating).toBe(false);
    // Never anchored on both axes — a dock has a thickness and a span, not four offsets.
    expect(geometry.left).toBeUndefined();
  });

  it('gives a floating strip its content width rather than a band of empty panel', () => {
    const geometry = resolveDock(dock({ size: 'sm', float: true }), desktop);

    expect(geometry.width).toBeUndefined();
    expect(geometry.transform).toBe('translateX(-50%)');
    // Along the bottom, because floating *control* chrome lives at the top — the call bar is a pill
    // at top centre, and a strip placed there would land on it.
    expect(geometry.bottom).toBeDefined();
    expect(geometry.top).toBeUndefined();
  });

  it('lets a maximised panel cover the content region instead of insetting to nothing', () => {
    const geometry = resolveDock(dock({ size: 'full', float: true }), desktop);

    expect(geometry.floating).toBe(true);
    expect(geometry.left).toBeDefined();
    expect(geometry.right).toBeDefined();
    expect(contentInset([dock({ size: 'full', float: true })], desktop).right).toBe(0);
  });

  it('renders nothing without an edge', () => {
    expect(resolveDock(dock({ edge: null }), desktop)).toEqual({ edge: null, floating: true });
  });

  it('floats rather than insets on a narrow window', () => {
    // The trade only makes sense when there is content area to trade. A 440px panel beside a 400px
    // viewport is not two usable things.
    expect(resolveDock(dock(), laptop).floating).toBe(true);
    expect(contentInset([dock()], laptop)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('dragging', () => {
  it('lets a dragged size beat the named one', () => {
    // The module keeps saying what it wants — `md`, an opening bid — and the host keeps deciding
    // what it gets, which now includes remembering that somebody moved it.
    const geometry = resolveDock(dock({ resizedTo: 600 }), desktop);
    expect(geometry.width).toBe('592px'); // less the gap it sits off the edge by
    expect(contentInset([dock({ resizedTo: 600 })], desktop).right).toBe(600);
  });

  it('never lets a drag outgrow the window it was not dragged on', () => {
    // A panel dragged wide on a monitor must not still be wider than a laptop screen when the same
    // session moves to one.
    const laptopWide = { width: 1280, height: 800 };
    const thickness = dockThickness('right', 'md', laptopWide, 5_000);
    expect(thickness).toBeLessThanOrEqual(1280);
  });

  it('refuses to shrink a panel into a sliver', () => {
    expect(dockThickness('right', 'md', desktop, 10)).toBe(MIN_DOCK_PX);
  });

  it('puts the handle on the side facing the content it takes room from', () => {
    // Which is also which way "wider" points, and the reason the sign lives in the host rather than
    // in the handle: it inverts between edges.
    expect(resolveDock(dock({ edge: 'right' }), desktop).handle).toBe('left');
    expect(resolveDock(dock({ edge: 'left' }), desktop).handle).toBe('right');
    expect(resolveDock(dock({ edge: 'bottom' }), desktop).handle).toBe('top');
    expect(resolveDock(dock({ edge: 'top' }), desktop).handle).toBe('bottom');
  });

  it('offers no handle to a panel that takes no room', () => {
    // Nothing to trade, so nothing to drag — and a divider on a floating strip would suggest
    // otherwise.
    expect(resolveDock(dock({ size: 'sm', float: true }), desktop).handle).toBeUndefined();
    expect(resolveDock(dock({ size: 'full', float: true }), desktop).handle).toBeUndefined();
  });
});

describe('dockThickness', () => {
  it('scales the large size with the display and pins the smaller ones', () => {
    // "Most of the screen" is a different number on a laptop and a monitor; "a panel" is not.
    expect(dockThickness('right', 'md', desktop)).toBe(dockThickness('right', 'md', { width: 2560, height: 1440 }));
    expect(dockThickness('right', 'lg', { width: 2560, height: 1440 })).toBeGreaterThan(
      dockThickness('right', 'lg', desktop),
    );
  });

  it('never asks for more room than the content region has', () => {
    const tiny = { width: 400, height: 300 };
    expect(dockThickness('right', 'lg', tiny)).toBeLessThanOrEqual(400);
    expect(dockThickness('bottom', 'lg', tiny)).toBeLessThanOrEqual(300);
  });
});

describe('contentInset', () => {
  it('subtracts only what is actually docked', () => {
    const inset = contentInset([dock(), dock({ id: 'notes:0', edge: 'left', size: 'sm' })], desktop);

    expect(inset.right).toBe(dockThickness('right', 'md', desktop));
    expect(inset.left).toBe(dockThickness('left', 'sm', desktop));
    expect(inset.top).toBe(0);
  });

  it('stacks two panels sharing an edge', () => {
    // Nothing places them side by side yet, but an inset that under-reported would put the second
    // panel over content the app believes is visible.
    const inset = contentInset([dock(), dock({ id: 'notes:0' })], desktop);
    expect(inset.right).toBe(dockThickness('right', 'md', desktop) * 2);
  });
});
