/**
 * Dock geometry — where a docked module panel lands, and what the app gives up for it.
 *
 * Worth testing directly rather than through a rendered shell, because every interesting case is a
 * decision about *whether* to give up room, and those are the cases a screenshot cannot tell apart:
 * a panel that floats and a panel that insets look identical until you look at what is behind them.
 */
import { describe, expect, it } from 'vitest';

import { contentInset, dockThickness, NARROW_VIEWPORT_PX, resolveDock } from '../src/shared/dockGeometry';

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
  it('spans its edge and clears the module rail', () => {
    const geometry = resolveDock(dock(), desktop);

    // Anchored right, not at the window edge: covering the rail would hide the way to close the
    // panel that is covering it.
    expect(geometry.right).toBe('56px');
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
