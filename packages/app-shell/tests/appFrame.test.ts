/**
 * Panels dock against the bands the app's own chrome declares, not against a sidebar assumed to be there.
 *
 * The geometry used to hard-code an 80px sidebar on the left and nothing on top, so an app without a
 * sidebar left an 80px dead band and one with a top bar had it covered by the content and by every
 * top-docked panel. The app template declares its bands (`meta.frame`) and the geometry measures
 * against them; the built-in app declares today's furniture, so nothing moves on day one.
 */
import { DEFAULT_APP_FRAME, railBand, snapTargetRects } from '@shared/dockGeometry';
import { appFrame, declareAppFrame } from '@shared/registries/appFrame';
import { afterEach, describe, expect, it } from 'vitest';

const viewport = { width: 1440, height: 900 };
const topLeft = () => snapTargetRects(viewport).find((rect) => rect.id === 'top-left')!;

afterEach(() => declareAppFrame(undefined));

describe('the app frame', () => {
  it('is today’s furniture until an app declares otherwise', () => {
    expect(appFrame()).toEqual(DEFAULT_APP_FRAME);
    expect(DEFAULT_APP_FRAME).toEqual({ left: 80, right: 56, top: 0, bottom: 0 });
  });

  it('moves a panel’s room with the bands the app declares', () => {
    const withSidebar = topLeft();
    declareAppFrame({ top: 48 });
    const withTopBar = topLeft();
    // No sidebar: the left band is gone, so a panel parks further left.
    expect(withTopBar.x).toBeLessThan(withSidebar.x);
    // A top bar: the panel parks below it.
    expect(withTopBar.y).toBeGreaterThanOrEqual(withSidebar.y + 48);
  });

  it('treats a band an app leaves out as empty, and no frame at all as the built-in', () => {
    declareAppFrame({ left: 64 });
    expect(appFrame()).toEqual({ left: 64, right: 0, top: 0, bottom: 0 });
    declareAppFrame(undefined);
    expect(appFrame()).toEqual(DEFAULT_APP_FRAME);
  });

  it('keeps the rail’s clearance to the rail the app has', () => {
    const bar = { height: 74, width: 2000 };
    const inset = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(railBand(viewport, inset, bar)).toBeGreaterThan(0);
    declareAppFrame({ left: 80 });
    // No rail, so nothing to dodge.
    expect(railBand(viewport, inset, bar)).toBe(0);
  });
});
