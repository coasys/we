/**
 * Dock geometry — where a module panel lands, and what the app gives up for it.
 *
 * Worth testing directly rather than through a rendered shell, because every interesting case is a
 * decision about *whether* to give up room, and those are the cases a screenshot cannot tell apart:
 * a panel that floats and a panel that displaces look identical until you look at what is behind
 * them.
 *
 * The rule the whole file turns on: **a panel that displaces spans its edge; a panel that floats
 * does not.** Most of what follows is that sentence, from one side or the other.
 */
import { DROP_LINE_THICKNESS } from '@we/drag';
import { describe, expect, it } from 'vitest';

import {
  arrangeDrop,
  arrangeHomeDrop,
  BOTTOM_CHROME_PX,
  canFold,
  chooseTarget,
  CHROME_RAIL_PX,
  COLLAPSED_PX,
  columnLayout,
  columnMembers,
  columnSlots,
  contains,
  type ContentInset,
  contentInset,
  coveredInset,
  displaces,
  DOCK_GAP_PX,
  type DockRequest,
  dockThickness,
  type DropTarget,
  EDGE_REACH_PX,
  edgeGroups,
  edgeOfSnap,
  edgeZone,
  fitPlacement,
  type FloatPlacement,
  floorOf,
  grown,
  homeLaneMembers,
  insertionSlots,
  type LaneMember,
  laneThickness,
  layerOrder,
  MIN_DOCK_PX,
  MIN_FLOAT_PX,
  NARROW_VIEWPORT_PX,
  nearEdge,
  NO_INSET,
  NO_TOP_CHROME,
  occupiedFor,
  PANEL_CHROME,
  PANEL_LAYER_BASE,
  placementFromDeclaration,
  RAIL_TOP_PX,
  railBand,
  type Rect,
  rectOf,
  resolveDock,
  SEAM_PX,
  seamBetween,
  seedPlacement,
  SIDEBAR_PX,
  snapCandidate,
  snapOrigin,
  type SnapPoint,
  snapTargetRects,
  snapTargetSize,
  targetRank,
} from '../src/shared/dockGeometry';

const desktop = { width: 1600, height: 900 };
const laptop = { width: NARROW_VIEWPORT_PX - 100, height: 700 };

const placement = (over: Partial<FloatPlacement> = {}): FloatPlacement => ({
  snap: 'right',
  x: 0,
  y: 0,
  w: 440,
  h: 300,
  displace: true,
  ...over,
});

const dock = (over: Partial<DockRequest> = {}): DockRequest => ({
  id: 'call:0',
  edge: 'right' as const,
  size: 'md' as const,
  float: false,
  ...over,
});

const px = (value?: string) => (value === undefined ? undefined : parseFloat(value));

describe('a panel that displaces', () => {
  it('spans its edge and takes exactly what the content gave up', () => {
    const geometry = resolveDock(dock({ placement: placement() }), desktop);

    expect(geometry.floating).toBe(false);
    expect(geometry.right).toBe('0px');
    expect(geometry.width).toBe('440px');
    // Spanning is what makes the inset honest: a partial-height panel would still cost a full
    // column, so the two halves of the rule have to agree.
    expect(geometry.top).toBeDefined();
    expect(geometry.bottom).toBeDefined();
    expect(contentInset([dock({ placement: placement() })], desktop).right).toBe(440);
  });

  it('meets the content edge to edge, with no gap to fall through', () => {
    // A floating panel is a card over the app and needs air; a displacing one has taken room *from*
    // the app, so a gap there is a strip of background where the content used to be.
    expect(resolveDock(dock({ placement: placement() }), desktop).right).toBe('0px');
    expect(
      px(resolveDock(dock({ placement: placement({ snap: null, displace: false }) }), desktop).left),
    ).toBeGreaterThan(SIDEBAR_PX);
  });

  it('puts its one handle on the side facing the content it takes room from', () => {
    // Which is also which way "wider" points, and the reason the sign lives in the host rather than
    // in the handle: it inverts between edges.
    expect(resolveDock(dock({ placement: placement({ snap: 'right' }) }), desktop).handleX).toBe('left');
    expect(resolveDock(dock({ placement: placement({ snap: 'left' }) }), desktop).handleX).toBe('right');
    expect(resolveDock(dock({ placement: placement({ snap: 'bottom' }) }), desktop).handleY).toBe('top');
    expect(resolveDock(dock({ placement: placement({ snap: 'top' }) }), desktop).handleY).toBe('bottom');
    // One axis only: a spanning panel has nothing to trade on the other.
    expect(resolveDock(dock({ placement: placement({ snap: 'right' }) }), desktop).handleY).toBeUndefined();
  });

  it('refuses to shrink into a sliver', () => {
    const thin = resolveDock(dock({ placement: placement({ w: 10 }) }), desktop);
    expect(thin.width).toBe(`${MIN_DOCK_PX}px`);
  });

  it('stacks behind a panel already holding that edge', () => {
    // Without the offset both resolve to the same box and sit on top of one another, which nothing
    // noticed while only one module had a dock.
    const second = resolveDock(dock({ id: 'notes:0', placement: placement() }), desktop, {
      ...NO_INSET,
      right: 440,
    });
    expect(second.right).toBe('440px');
  });
});

describe('two strips meeting at a corner', () => {
  const bottomDocked: ContentInset = { ...NO_INSET, bottom: 300 };

  it('gives the corner to the side, which spans the full height', () => {
    // Both clearing each other left a square of background where they met, which reads as a hole in
    // the layout. Every application that lays panels out this way gives it to the vertical edges.
    const side = resolveDock(dock({ placement: placement({ snap: 'right' }) }), desktop, bottomDocked);

    expect(side.bottom).toBe('0px');
    expect(side.top).toBe('0px');
  });

  it('keeps the horizontal one clear of the sides', () => {
    const rightDocked: ContentInset = { ...NO_INSET, right: 440 };
    const bottom = resolveDock(
      dock({ placement: placement({ snap: 'bottom', thicknessY: 300 }) }),
      desktop,
      rightDocked,
    );

    expect(bottom.right).toBe('440px');
  });
});

describe('a panel that floats', () => {
  const floating = placement({ snap: 'bottom-right', displace: false, w: 360, h: 200 });

  it('takes no room at all', () => {
    expect(contentInset([dock({ placement: floating })], desktop)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('sits at its snap, off the edges by a gap', () => {
    const geometry = resolveDock(dock({ placement: floating }), desktop);

    expect(geometry.floating).toBe(true);
    expect(geometry.width).toBe('360px');
    expect(geometry.height).toBe('200px');
    expect(px(geometry.left)! + 360).toBeLessThan(desktop.width);
    expect(px(geometry.top)! + 200).toBeLessThan(desktop.height);
  });

  it('recomputes its position from the snap rather than remembering pixels', () => {
    // What keeps a corner panel in its corner when the window changes shape, instead of drifting
    // into the middle of it.
    const wide = resolveDock(dock({ placement: floating }), { width: 1600, height: 900 });
    const narrow = resolveDock(dock({ placement: floating }), { width: 1200, height: 900 });
    expect(px(wide.left)).toBeGreaterThan(px(narrow.left)!);
  });

  it('is dragged from any side or corner', () => {
    // Which sides render is the frame's decision (`grips`), and for a floating panel it is all of
    // them: it takes room from nothing, so every edge is free to move and the corners move two at
    // once. The geometry still names the pair facing the room, which is what a *displacing* panel
    // narrows to one of.
    const geometry = resolveDock(dock({ placement: floating }), desktop);
    expect(geometry.floating).toBe(true);
    expect(geometry.handleX).toBeDefined();
    expect(geometry.handleY).toBeDefined();
  });

  it("cannot be dropped into the band the app's controls occupy", () => {
    // It was closed to snapping and open to dragging, which made the rule look arbitrary: the panel
    // refused to snap under the call bar and then let you drop it there by hand.
    const low = placement({ snap: null, displace: false, x: 600, y: desktop.height, w: 360, h: 200 });
    const box = resolveDock(dock({ placement: low }), desktop);

    expect(px(box.top)! + 200).toBeLessThanOrEqual(desktop.height - BOTTOM_CHROME_PX);
  });

  it('is clamped into view, however it was stored', () => {
    // A placement saved on a monitor must not leave a panel's controls off-screen on a laptop.
    const stray = placement({ snap: null, displace: false, x: 9_000, y: 9_000, w: 360, h: 200 });
    const geometry = resolveDock(dock({ placement: stray }), desktop);

    expect(px(geometry.left)! + 360).toBeLessThanOrEqual(desktop.width);
    expect(px(geometry.top)! + 200).toBeLessThanOrEqual(desktop.height);
  });

  it('keeps a floor under both dimensions', () => {
    const tiny = resolveDock(dock({ placement: placement({ snap: null, displace: false, w: 1, h: 1 }) }), desktop);
    expect(tiny.width).toBe(`${MIN_FLOAT_PX}px`);
    expect(tiny.height).toBe(`${MIN_FLOAT_PX}px`);
  });
});

describe('displacing is an edge idea', () => {
  it('is refused from a corner, however the flag is set', () => {
    // A rectangular layout cannot flow around a floating box, so insetting for a corner panel would
    // carve out a full column and leave most of it empty.
    expect(displaces(placement({ snap: 'top-left', displace: true }), desktop)).toBe(false);
    expect(displaces(placement({ snap: null, displace: true }), desktop)).toBe(false);
    expect(displaces(placement({ snap: 'right', displace: true }), desktop)).toBe(true);
  });

  it('names the edge for the four that have one', () => {
    expect(edgeOfSnap('right')).toBe('right');
    expect(edgeOfSnap('bottom-right')).toBeNull();
    expect(edgeOfSnap(null)).toBeNull();
  });

  it('is given up entirely on a narrow window', () => {
    // The trade only makes sense when there is content area to trade. A 440px panel beside a 400px
    // viewport is not two usable things.
    expect(displaces(placement(), laptop)).toBe(false);
    expect(resolveDock(dock({ placement: placement() }), laptop).floating).toBe(true);
    expect(contentInset([dock({ placement: placement() })], laptop)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('maximised', () => {
  it("is the user's to turn on, from any panel", () => {
    // Not the module's any more: "how much room" is a layout question like position and size, and the
    // call module was the only one that could do it at all.
    const geometry = resolveDock(dock({ placement: placement({ maximised: true }) }), desktop);

    expect(geometry.floating).toBe(true);
    expect(geometry.left).toBe('0px');
    expect(contentInset([dock({ placement: placement({ maximised: true }) })], desktop).right).toBe(0);
  });

  it('is the whole window, sidebar and floating chrome included', () => {
    /*
      It used to stop short of the sidebar, the rail and the call bar's band, on the reasoning that
      full screen cannot mean the whole screen while permanent chrome is over it. That was right
      about what must not be covered — the panel's own titlebar, which is the way out — and wrong
      about what to do with it: reserving a *band* per edge protected far more than a titlebar, and
      protected the wrong shape. The rail is a short column at top-right and the call bar a centred
      pill, so most of each reserved strip was empty and showed the template through it.
    */
    const geometry = resolveDock(dock({ placement: placement({ maximised: true }) }), desktop, NO_INSET, {
      left: 0,
      right: CHROME_RAIL_PX,
      top: 0,
      bottom: BOTTOM_CHROME_PX,
    });

    expect(px(geometry.top)).toBe(0);
    expect(px(geometry.bottom)).toBe(0);
    expect(px(geometry.left)).toBe(0);
    expect(px(geometry.right)).toBe(0);
  });

  it('pads its content by the chrome painted over it, having taken the whole window', () => {
    /*
      The other half of covering everything. The box reaches every edge so no template shows through
      around it; the content keeps clear of the call bar, which is still painted over the panel and
      which a maximised panel — unlike every other placement — cannot be moved out from under.

      Horizontal edges only: the sidebar and the module rail hide while a panel is maximised, so
      what is left over it is whatever the modules declared at the top and bottom.
    */
    const chrome: ContentInset = { left: 0, right: CHROME_RAIL_PX, top: 0, bottom: BOTTOM_CHROME_PX };
    const geometry = resolveDock(dock({ placement: placement({ maximised: true }) }), desktop, NO_INSET, chrome);

    expect(px(geometry.padBottom)).toBe(BOTTOM_CHROME_PX);
    expect(px(geometry.padTop)).toBe(0);
    // Not the rail's edge, which has nothing on it once the rail has hidden itself.
    expect(px(geometry.right)).toBe(0);
  });

  it('gives an ordinary panel no such padding, having nothing over it', () => {
    // Every other placement is clamped out of the chrome bands, so there is nothing to keep clear of.
    const geometry = resolveDock(dock({ placement: placement({ snap: 'top-left', displace: false }) }), desktop);

    expect(geometry.padTop).toBeUndefined();
    expect(geometry.padBottom).toBeUndefined();
  });

  it('still keeps clear of a panel that has taken room from the content', () => {
    // The line between the two: permanent furniture is the app's own and covering it is what full
    // screen means, but another *displacing* panel is something the user opened and is currently
    // trading content area for. Covering that is losing something rather than filling the screen.
    const geometry = resolveDock(dock({ placement: placement({ maximised: true }) }), desktop, {
      ...NO_INSET,
      right: 320,
    });

    expect(px(geometry.right)).toBe(320);
    expect(px(geometry.left)).toBe(0);
  });

  it('leaves the placement underneath it untouched', () => {
    // So turning it off returns the panel to exactly the corner and size it was at, rather than to a
    // default somebody has to find again.
    const parked = placement({ snap: 'bottom-right', displace: false, w: 360, h: 200 });
    const maximised = resolveDock(dock({ placement: { ...parked, maximised: true } }), desktop);
    const restored = resolveDock(dock({ placement: parked }), desktop);

    expect(maximised.width).toBeUndefined();
    expect(restored.width).toBe('360px');
  });

  it('covers the content region and insets nothing', () => {
    // Insetting it would leave a content viewport of zero width, which is not a layout any template
    // survives.
    const geometry = resolveDock(dock({ size: 'full' }), desktop);

    expect(geometry.floating).toBe(true);
    expect(geometry.left).toBe('0px');
    expect(geometry.right).toBe('0px');
    expect(contentInset([dock({ size: 'full' })], desktop).right).toBe(0);
  });

  it('offers no handles, having nothing left to give', () => {
    const geometry = resolveDock(dock({ size: 'full' }), desktop);
    expect(geometry.handleX).toBeUndefined();
    expect(geometry.handleY).toBeUndefined();
  });
});

describe('what a module’s bid becomes', () => {
  it('opens a panel that asked to inset exactly where it asked, spanning', () => {
    // The whole of the old behaviour, so a panel nobody has dragged looks as it always did.
    const seeded = seedPlacement(dock({ edge: 'right', float: false }), desktop);

    expect(seeded.snap).toBe('right');
    expect(seeded.displace).toBe(true);
    expect(seeded.thicknessX).toBe(dockThickness('right', 'md', desktop));
    // Only the axis it opens on. The perpendicular one falls back to the card, so a panel moved to
    // the bottom becomes as tall as the card it would restore to rather than as tall as it was wide.
    expect(seeded.thicknessY).toBeUndefined();
  });

  it('seeds a card for a panel that opens docked, so it has something to become', () => {
    // Dragging it off its edge restores `w`/`h`, and those used to be the dock's own dimensions —
    // so undocking a side panel produced a full-height column rather than a card.
    const seeded = seedPlacement(dock({ edge: 'right', float: false }), desktop);

    expect(seeded.w).toBeLessThan(desktop.width / 2);
    expect(seeded.h).toBeLessThan(desktop.height / 2);
  });

  it('opens a panel that asked to float as a card in the bottom-right', () => {
    const seeded = seedPlacement(dock({ float: true, size: 'sm' }), desktop);

    expect(seeded.snap).toBe('bottom-right');
    expect(seeded.displace).toBe(false);
    // 16:9, because the first thing to float is a video stage.
    expect(seeded.h).toBe(Math.round((seeded.w * 9) / 16));
  });

  it('renders nothing without an edge', () => {
    expect(resolveDock(dock({ edge: null }), desktop)).toEqual({ edge: null, floating: true });
  });
});

describe('room another panel has already taken', () => {
  const notesDocked: ContentInset = { ...NO_INSET, right: 440 };

  it('keeps a snapped panel clear of it', () => {
    // The bug: snapping a video to the right landed it on top of a docked notes panel, because every
    // position here was measured against the window rather than against what was left of it.
    const floating = placement({ snap: 'right', displace: false, w: 360, h: 200 });
    const clear = resolveDock(dock({ placement: floating }), desktop, notesDocked);

    expect(px(clear.left)! + 360).toBeLessThanOrEqual(desktop.width - 440);
  });

  it('keeps a maximised panel clear of it too', () => {
    // Same region, same answer — which is why full screen needed no separate fix.
    const geometry = resolveDock(dock({ placement: placement({ maximised: true }) }), desktop, notesDocked);

    expect(geometry.right).toBe('440px');
  });

  it('moves the landing spots themselves, not just where a panel ends up', () => {
    // The targets are drawn from the same rects the drop test measures, so a marker that stayed put
    // while the panel moved would be pointing at a place it could no longer go — which is exactly
    // what the right-hand markers did once the panel started clamping and they did not.
    const clear = snapTargetRects(desktop, notesDocked).find((rect) => rect.id === 'right')!;
    const full = snapTargetRects(desktop).find((rect) => rect.id === 'right')!;

    expect(clear.x).toBeLessThan(full.x);
    expect(clear.x + clear.w).toBeLessThanOrEqual(desktop.width - notesDocked.right);
  });

  it('answers the drop test with the same rects it drew', () => {
    // Overlap is measured against the drawn box, so the two have to be computed from one set of
    // numbers: markers narrowed while the hit test was not would light a target the drop refused.
    const target = snapTargetRects(desktop, notesDocked).find((rect) => rect.id === 'right')!;
    const over = { x: target.x, y: target.y, w: target.w, h: target.h };

    expect(snapCandidate(over, desktop, notesDocked)).toBe('right');
  });

  it('never counts the panel against itself', () => {
    // A displacing panel resolved against its own thickness would walk off its edge, one width per
    // frame. Nothing here passes a panel its own contribution — the store excludes it by index.
    const docked = resolveDock(dock({ placement: placement({ snap: 'right', thicknessX: 440 }) }), desktop);

    expect(docked.right).toBe('0px');
  });
});

describe('reordering a strip', () => {
  const boxes = [
    { x: 1200, y: 0, w: 400, h: 900 },
    { x: 800, y: 0, w: 400, h: 900 },
  ];

  it('offers a slot on an edge that has nothing on it, so a strip can be started', () => {
    // Without this an empty edge had no target that *took room*: the eight snap boxes can only float a
    // panel against a side, so docking to a fresh edge meant dropping it somewhere else first and then
    // finding the displace toggle.
    const [slot] = insertionSlots('right', [], desktop);

    expect(slot.index).toBe(0);
    expect(slot.hit.h).toBe(desktop.height);
    // A wider *target* than a gap between panels: with nothing either side of it to imply the result,
    // this one is claiming a whole side. The line drawn in it is the same 3px either way.
    expect(slot.hit.w).toBeGreaterThan(insertionSlots('right', boxes, desktop)[0].hit.w);
    expect(slot.line.w).toBe(DROP_LINE_THICKNESS);
  });

  it('keeps the outermost slot on screen', () => {
    // Centred on the boundary, it straddled the screen edge and showed as a sliver you could only
    // sometimes see — which reads as the rule being intermittent rather than as a drawing bug.
    const [outer] = insertionSlots('right', boxes, desktop);

    expect(outer.hit.x + outer.hit.w).toBeLessThanOrEqual(desktop.width);
    expect(outer.hit.x).toBeGreaterThanOrEqual(SIDEBAR_PX);
    // And the line sits *on* the edge rather than centred in its target, which floated it a dozen
    // pixels inboard of the boundary it describes.
    expect(outer.line.x + outer.line.w).toBe(desktop.width);
  });

  it('measures the gaps in a region that still contains the strip', () => {
    // The bug this cost two rounds of guessing: the caller's "what must I keep clear of" excludes
    // every docked panel, including the ones these lines are about. Computed in that region, all of a
    // strip's boundaries fall outside it and clamp to the same spot — three lines drawn on top of one
    // another at the strip's inner edge, which is the one place you cannot drop.
    const strip: ContentInset = { ...NO_INSET, right: 800 };
    const collapsed = insertionSlots('right', boxes, desktop, strip).map((slot) => Math.round(slot.line.x));
    const correct = insertionSlots('right', boxes, desktop).map((slot) => Math.round(slot.line.x));

    expect(new Set(collapsed).size).toBe(1);
    expect(new Set(correct).size).toBe(3);
    // One per boundary: the screen edge, and the inner side of each panel.
    expect(correct).toEqual([
      desktop.width - DROP_LINE_THICKNESS,
      1200 - DROP_LINE_THICKNESS / 2,
      800 - DROP_LINE_THICKNESS / 2,
    ]);
  });

  it('offers one gap per panel, plus one against the edge itself', () => {
    // Two panels, three places to land: outside both, between them, inside both.
    expect(insertionSlots('right', boxes, desktop)).toHaveLength(3);
  });

  it('counts outwards from the edge, which is the direction a strip grows', () => {
    // Index 0 is nearest the edge — the rightmost panel for a right-hand strip, which is the opposite
    // of reading order and the same as "distance from the edge".
    const slots = insertionSlots('right', boxes, desktop);

    expect(slots[0].line.x).toBeGreaterThan(slots[1].line.x);
    expect(slots[1].line.x).toBeGreaterThan(slots[2].line.x);
  });

  it('runs along the strip rather than sitting in it as a box', () => {
    // A gap has to say *between these two*, which a box the size of a panel cannot. The number here is
    // the hit area; the frame centres a 3px hairline in it, because a target you can hit while
    // dragging a panel is much thicker than a seam anybody wants to look at.
    const [slot] = insertionSlots('right', boxes, desktop);

    expect(slot.hit.w).toBeLessThan(32);
    expect(slot.line.w).toBe(DROP_LINE_THICKNESS);
    expect(slot.hit.h).toBe(desktop.height);
  });

  it('runs the other way for a horizontal strip', () => {
    const stacked = [
      { x: 0, y: 600, w: 1600, h: 300 },
      { x: 0, y: 300, w: 1600, h: 300 },
    ];
    const slots = insertionSlots('bottom', stacked, desktop);

    expect(slots[0].line.y).toBeGreaterThan(slots[1].line.y);
    expect(slots[0].line.w).toBe(desktop.width - SIDEBAR_PX);
  });

  it('never lets two panels on an edge compare equal', () => {
    // A tie is the bug: each believes the other is behind it, both shift by the other's thickness, and
    // they overlap in the middle with a gap at the edge. It came back the moment `order` existed,
    // because a panel given `order: 0` by a drop tied with whichever panel was first in the registry.
    const dropped = placement({ snap: 'right', displace: true, thicknessX: 400, order: 0 });
    const never = placement({ snap: 'right', displace: true, thicknessX: 400 });
    const panels = [dock({ id: 'a', placement: never }), dock({ id: 'b', placement: dropped })];

    // Exactly one of them steps past the other — the sum of what they clear is one panel, not two.
    const cleared = occupiedFor(panels, 0, desktop).right + occupiedFor(panels, 1, desktop).right;
    expect(cleared).toBe(400);
  });

  it('puts a panel that never chose a position after the ones that did', () => {
    // Which is also "a panel joining a strip without being dropped into it lands at the end".
    const placed = placement({ snap: 'right', displace: true, thicknessX: 400, order: 0 });
    const unplaced = placement({ snap: 'right', displace: true, thicknessX: 400 });
    const panels = [dock({ id: 'unplaced', placement: unplaced }), dock({ id: 'placed', placement: placed })];

    expect(occupiedFor(panels, 1, desktop).right).toBe(0);
    expect(occupiedFor(panels, 0, desktop).right).toBe(400);
  });

  it('ranks a strip by the order the user set, not the order things registered in', () => {
    // The bug this exists for: stacking came from the registry, so a panel dragged out of a strip
    // returned to the slot it left however far along the edge it was dropped.
    const first = placement({ snap: 'right', displace: true, thicknessX: 400, order: 1 });
    const second = placement({ snap: 'right', displace: true, thicknessX: 400, order: 0 });
    const panels = [dock({ id: 'a', placement: first }), dock({ id: 'b', placement: second })];

    // `a` registered first but was ordered second, so it is the one that steps past.
    expect(occupiedFor(panels, 0, desktop).right).toBe(400);
    expect(occupiedFor(panels, 1, desktop).right).toBe(0);
  });
});

describe('what a panel has to keep clear of', () => {
  const card = placement({ snap: 'right', displace: false, w: 360, h: 200 });
  const notes = placement({ snap: 'right', displace: true, thicknessX: 440 });

  it('makes a floating panel clear a displacing one on the same edge, whatever the order', () => {
    // The bug: the exemption that lets two *displacing* panels take turns was being applied to a
    // floating one, so a video snapped right sat behind a notes panel that registered after it. Its
    // landing markers moved correctly the whole time, because a panel mid-drag has no snap for the
    // exemption to match on — it fired only once the video was dropped.
    const panels = [dock({ id: 'call:0', placement: card }), dock({ id: 'notes:0', placement: notes })];

    expect(occupiedFor(panels, 0, desktop).right).toBe(440);
  });

  it('still lets two displacing panels stack rather than dodge each other', () => {
    const panels = [dock({ id: 'a', placement: notes }), dock({ id: 'b', placement: notes })];

    // The first ignores the second, the second steps past the first. Both counting the other would
    // leave a gap the width of a panel between them.
    expect(occupiedFor(panels, 0, desktop).right).toBe(0);
    expect(occupiedFor(panels, 1, desktop).right).toBe(440);
  });

  it('never counts a panel against itself', () => {
    const panels = [dock({ id: 'notes:0', placement: notes })];
    expect(occupiedFor(panels, 0, desktop).right).toBe(0);
  });

  it('ignores panels that take no room', () => {
    // A floating or maximised neighbour covers content rather than displacing it, so there is nothing
    // for anyone to clear.
    const panels = [
      dock({ id: 'call:0', placement: card }),
      dock({ id: 'b', placement: placement({ snap: 'right', maximised: true }) }),
      dock({ id: 'c', placement: card }),
    ];

    expect(occupiedFor(panels, 0, desktop)).toEqual(NO_INSET);
  });
});

describe('fitting a panel to its content', () => {
  const aspect = { ratio: 16 / 9, insetX: 24, insetY: 24 };
  // What the panel's chrome costs on each axis: the frame's own, plus the module's own padding.
  // Read from the constants rather than restated, which is how the 24 written here stayed wrong for
  // as long as the one in the source did.
  const chrome = PANEL_CHROME.y + aspect.insetY;
  const chromeX = PANEL_CHROME.x + aspect.insetX;

  const fitted = (over: Partial<FloatPlacement>) =>
    fitPlacement(placement({ snap: null, displace: false, ...over }), aspect, { spanning: false });

  it('trims the height of a panel that is too tall', () => {
    const before = placement({ snap: null, displace: false, w: 360, h: 600 });
    const after = fitPlacement(before, aspect, { spanning: false });

    expect(after.h).toBeLessThan(before.h);
    expect(after.w).toBe(before.w);
  });

  it('trims the width of a panel that is too wide, rather than growing it taller', () => {
    // The case that read as a different feature: keeping the width and solving for height *grew* the
    // panel here, so the button appeared to enlarge a video nobody had asked it to touch.
    const before = placement({ snap: null, displace: false, w: 900, h: 260 });
    const after = fitPlacement(before, aspect, { spanning: false });

    expect(after.w).toBeLessThan(before.w);
    expect(after.h).toBe(before.h);
  });

  it('never grows a floating panel on either axis', () => {
    for (const box of [
      { w: 360, h: 600 },
      { w: 900, h: 260 },
      { w: 500, h: 500 },
    ]) {
      const after = fitted(box);
      expect(after.w).toBeLessThanOrEqual(box.w);
      expect(after.h).toBeLessThanOrEqual(box.h);
    }
  });

  it('does nothing the second time', () => {
    // Idempotent, which is what "the picture stays the size it is" buys: after one press the panel
    // already matches the ratio, so there is no slack left to take.
    const once = fitted({ w: 900, h: 260 });
    const twice = fitPlacement(once, aspect, { spanning: false });

    expect(twice.w).toBe(once.w);
    expect(twice.h).toBe(once.h);
  });

  it('leaves the picture at the size it was', () => {
    // The whole rule, stated as a measurement: the content box's shorter axis is untouched, so the
    // picture rendered inside it does not move.
    const before = placement({ snap: null, displace: false, w: 900, h: 260 });
    const after = fitPlacement(before, aspect, { spanning: false });

    expect(after.h - chrome).toBe(before.h - chrome);
    expect((after.w - chromeX) / (after.h - chrome)).toBeCloseTo(aspect.ratio, 1);
  });

  it('leaves no band on either axis, at any arrangement', () => {
    /*
      The regression this pair of constants existed to prevent and did not.

      `fitPlacement` shortens the panel by whatever it believes the chrome to be, so understating it
      leaves the content that much short of what it asked for — and content that goes height-limited
      hands the difference back on the *other* axis, multiplied by its aspect ratio. A wide
      arrangement multiplies hardest: three 16:9 tiles across is a ratio of 5.33, and the eleven
      pixels this was out by came back as fifty-four pixels of empty panel down each side, while the
      same error stacked vertically came back as four and looked perfect. Hence both orientations.
    */
    const PAD = 12;
    const GAP = 12;

    for (const [cols, rows, w, h] of [
      [1, 3, 420, 1000],
      [1, 2, 460, 900],
      [2, 2, 900, 700],
      [2, 1, 1200, 400],
      [3, 1, 1400, 320],
    ]) {
      const shape = {
        ratio: (cols * 16) / (rows * 9),
        insetX: PAD * 2 + (cols - 1) * GAP,
        insetY: PAD * 2 + (rows - 1) * GAP,
      };
      const after = fitPlacement(placement({ snap: null, displace: false, w, h }), shape, { spanning: false });

      // What the tiles actually get to divide, once the frame and the stage's padding are gone.
      const tilesW = after.w - PANEL_CHROME.x - PAD * 2 - (cols - 1) * GAP;
      const tilesH = after.h - PANEL_CHROME.y - PAD * 2 - (rows - 1) * GAP;
      const tileW = Math.min(tilesW / cols, (tilesH / rows) * (16 / 9));

      expect(tilesW - cols * tileW).toBeLessThan(2);
      expect(tilesH - (rows * tileW * 9) / 16).toBeLessThan(2);
    }
  });

  it('prefers a measured chrome to the constants', () => {
    // The constants are a copy of something the frame decides, and a copy is worth exactly as much
    // as the last time somebody remembered to update it. A caller holding the element measures.
    const before = placement({ snap: null, displace: false, w: 900, h: 400 });
    const assumed = fitPlacement(before, aspect, { spanning: false });

    // Passing what the constants say must be indistinguishable from passing nothing…
    expect(fitPlacement(before, aspect, { spanning: false, chrome: PANEL_CHROME })).toEqual(assumed);

    // …and a frame that really is taller leaves less room for the picture, so the fit is smaller.
    const taller = fitPlacement(before, aspect, { spanning: false, chrome: { x: PANEL_CHROME.x, y: 60 } });
    expect(taller.w).toBeLessThan(assumed.w);
    expect(assumed.w - taller.w).toBeCloseTo((60 - PANEL_CHROME.y) * aspect.ratio, 0);
  });

  it('sets the thickness instead when the panel spans an edge', () => {
    // The one case that can grow, and unavoidably: the axis with the slack is the one a spanning
    // panel does not own, so its thickness is what moves.
    const docked = placement({ snap: 'right', displace: true, thicknessX: 200, h: 900 });
    const after = fitPlacement(docked, aspect, { spanning: true, edge: 'right' });

    expect(after.thicknessX).toBeGreaterThan(200);
    expect(after.w).toBe(docked.w);
  });

  it('writes only the axis it solved, leaving the other to fall back to the card', () => {
    // One field per axis is the whole of why: a single `thickness` meant a width solved here became
    // a *height* the moment the panel was snapped to the bottom, and nothing said it had changed
    // meaning. There is no conversion — how wide a panel wants to be says nothing about how tall.
    const docked = placement({ snap: 'right', displace: true, h: 900 });
    const after = fitPlacement(docked, aspect, { spanning: true, edge: 'right' });

    expect(after.thicknessX).toBeDefined();
    expect(after.thicknessY).toBeUndefined();
  });

  it('declines a fit no edge is wide enough to honour, rather than writing one and being clamped', () => {
    /*
      The bug this whole pair of fields came out of. A spanning fit solves `span × ratio`, so wide
      content against a tall edge asks for more than the screen has — the call stage on a 4K side edge
      wanted 3761px of a 3760px region for a *single* 16:9 tile. It was written anyway and clamped at
      paint time, so the panel covered the region, the clamp hid why, and the value persisted:
      invisible while the panel floated, since a float reads `w`/`h`, and waiting to take over the
      moment it displaced again.

      Clamping instead would be no better. It destroys the size the user chose and still leaves the
      band, because a panel at the full width of its edge is exactly as letterboxed as it was.
    */
    // The reported case: a 4K side edge and one 16:9 tile. The bound is `dockThickness` at `lg`,
    // the largest a dock is ever asked for, which is what the store passes.
    const viewport = { width: 3840, height: 2160 };
    const tall = placement({ snap: 'right', displace: true, thicknessX: 350, h: viewport.height });
    const wide = { ratio: 16 / 9 };
    const maxThickness = dockThickness('right', 'lg', viewport);

    expect(fitPlacement(tall, wide, { spanning: true, edge: 'right', maxThickness })).toEqual(tall);
    // Still applies where there is genuinely room for it, so the guard is a bound and not a refusal.
    expect(fitPlacement(tall, wide, { spanning: true, edge: 'right', maxThickness: 99999 }).thicknessX).toBeGreaterThan(
      350,
    );
  });
});

describe('reading a resolved box back as a rectangle', () => {
  it('measures a right-hand displacing panel from the edge it is pinned to', () => {
    // It carries `right` and a `width` and no `left` at all, so reaching for `left` fell through to
    // the stored placement — the position it had when it last floated, or the seed's zero.
    const box = resolveDock(dock({ placement: placement({ snap: 'right', w: 440 }) }), desktop);
    const rect = rectOf(box, desktop, placement({ x: 0, y: 0 }));

    expect(rect.x).toBe(desktop.width - 440);
    expect(rect.w).toBe(440);
  });

  it('measures a maximised panel from four offsets and no size', () => {
    // The case that made dragging out of full screen land at the far left: with no `width` to read,
    // the fraction of the titlebar the pointer had hold of was computed against the *small* remembered
    // size, so grabbing anywhere right of centre put the restored panel off the left edge.
    const box = resolveDock(dock({ placement: placement({ maximised: true }) }), desktop);
    const rect = rectOf(box, desktop, placement({ w: 360, h: 200 }));

    expect(rect.x).toBe(0);
    expect(rect.w).toBe(desktop.width);
    expect(rect.y).toBe(0);
    expect(rect.h).toBe(desktop.height);
  });

  it('reads a floating panel straight off, and falls back only when there is no box', () => {
    const floating = placement({ snap: 'bottom-right', displace: false, w: 360, h: 200 });
    const box = resolveDock(dock({ placement: floating }), desktop);
    const rect = rectOf(box, desktop, floating);

    expect(rect.w).toBe(360);
    expect(rect.h).toBe(200);
    expect(rectOf(undefined, desktop, floating)).toEqual({ x: floating.x, y: floating.y, w: 360, h: 200 });
  });
});

describe('snapping', () => {
  it('puts each corner in its corner, clear of the sidebar', () => {
    const corners: SnapPoint[] = ['top-left', 'bottom-left'];
    for (const snap of corners) {
      expect(snapOrigin(snap, 300, 200, desktop).x).toBeGreaterThanOrEqual(SIDEBAR_PX);
    }
    expect(snapOrigin('top-right', 300, 200, desktop).x).toBeGreaterThan(desktop.width / 2);
    expect(snapOrigin('bottom', 300, 200, desktop).y).toBeGreaterThan(desktop.height / 2);
  });

  it('keeps the bottom row clear of the app’s floating controls', () => {
    // A panel snapped to that corner lands behind the call bar, which is where the bar now is.
    for (const snap of ['bottom-left', 'bottom', 'bottom-right'] as SnapPoint[]) {
      expect(snapOrigin(snap, 300, 200, desktop).y + 200).toBeLessThanOrEqual(desktop.height - BOTTOM_CHROME_PX);
    }
  });

  it('lights a target only once the panel is over it', () => {
    // Proximity used to decide this — thirds of the region — so a panel merely near an edge snapped
    // whether or not it had reached the marker, and dropping a video *near* a corner but deliberately
    // not in it was impossible.
    const target = snapTargetRects(desktop).find((rect) => rect.id === 'top-left')!;

    expect(snapCandidate({ x: target.x, y: target.y, w: 200, h: 150 }, desktop)).toBe('top-left');
    // Well inside the top-left third, and touching nothing.
    expect(
      snapCandidate({ x: target.x + target.w + 80, y: target.y + target.h + 80, w: 60, h: 40 }, desktop),
    ).toBeNull();
  });

  it('takes the target it covers most, when a panel spans two', () => {
    const left = snapTargetRects(desktop).find((rect) => rect.id === 'left')!;
    const wide = { x: left.x, y: left.y, w: left.w * 2, h: left.h };

    expect(snapCandidate(wide, desktop)).toBe('left');
  });

  it('leaves the middle alone, so a panel can simply stay where it was put', () => {
    // Without somewhere that snaps to nothing, every drop would snap and free positioning would be
    // unreachable — which is most of the screen, by area.
    expect(snapCandidate({ x: 700, y: 400, w: 200, h: 150 }, desktop)).toBeNull();
  });

  it('draws markers, not landing strips', () => {
    // They were a fifth of the region and read as targets you had to hit. The drawn box is also the
    // hit test now, so its size is a real decision rather than decoration.
    const { w, h } = snapTargetSize(desktop);

    expect(w).toBeLessThan((desktop.width - SIDEBAR_PX) / 6);
    expect(h).toBeLessThan(desktop.height / 6);
  });
});

describe('dockThickness', () => {
  it('scales the large size with the display and pins the smaller ones', () => {
    // "Most of the screen" is a different number on a laptop and a monitor; "a panel" is not.
    expect(dockThickness('right', 'md', desktop)).toBe(440);
    expect(dockThickness('right', 'md', { width: 2560, height: 1440 })).toBe(440);
    expect(dockThickness('right', 'lg', { width: 2560, height: 1440 })).toBeGreaterThan(
      dockThickness('right', 'lg', desktop),
    );
  });

  it('never lets a drag outgrow the window it was not dragged on', () => {
    const laptopWide = { width: 1280, height: 800 };
    expect(dockThickness('right', 'md', laptopWide, 5_000)).toBeLessThanOrEqual(1280);
  });
});

/**
 * Chrome that does not move for a floating panel.
 *
 * The rule the file opens with, applied to the app's own furniture rather than to another panel:
 * the module rail slides inwards by following `--we-chrome-right`, and only a *displacing* panel
 * publishes that. A floating one takes no room, so nothing slides, so it has to do the clearing —
 * and the two therefore need different answers about the same edge. `RAIL_PX = 0` is the displacing
 * answer and `CHROME_RAIL_PX` is the floating one; the tests below are mostly the difference.
 */
describe('chrome a floating panel must clear', () => {
  const chrome: ContentInset = { left: 0, right: CHROME_RAIL_PX, top: 0, bottom: BOTTOM_CHROME_PX };

  it('keeps a right-hand snap clear of the rail', () => {
    const origin = snapOrigin('right', 400, 300, desktop, NO_INSET, chrome);
    expect(origin.x + 400).toBeLessThanOrEqual(desktop.width - CHROME_RAIL_PX);
  });

  it('moves the landing spots with it, so the marker is where the panel will go', () => {
    // The markers are the rule, not decoration — `snapCandidate` hit-tests the drawn box. A target
    // still at the window edge would light up over a rail the panel is no longer allowed to reach.
    const target = snapTargetRects(desktop, NO_INSET, chrome).find((rect) => rect.id === 'bottom-right');
    expect(target!.x + target!.w).toBeLessThanOrEqual(desktop.width - CHROME_RAIL_PX);
  });

  it('does not let a free drag put one there either', () => {
    // The band was closed to snapping and open to dragging on the top edge once, which made the rule
    // look arbitrary. The right edge was open to both.
    const box = resolveDock(dock({ float: true }), desktop, NO_INSET, chrome);
    expect(px(box.left)! + px(box.width)!).toBeLessThanOrEqual(desktop.width - CHROME_RAIL_PX);
  });

  it('does not apply to a maximised panel, which covers everything', () => {
    // The one placement that ignores this. The rail stays reachable by dropping below the panel's
    // titlebar instead — see `railBand` — and the call bar is at the bottom, where a panel has no
    // controls to cover.
    const box = resolveDock(
      dock({ placement: placement({ maximised: true, displace: false }) }),
      desktop,
      NO_INSET,
      chrome,
    );
    expect(px(box.right)).toBe(0);
    expect(px(box.bottom)).toBe(0);
  });

  it('leaves a displacing panel alone, which is the whole point of the split', () => {
    // It has taken the edge, so the rail has already moved out of its way. A displacing panel that
    // also cleared the rail would stop 56px short of an edge nothing is holding any more.
    const box = resolveDock(dock({ placement: placement({ displace: true }) }), desktop, NO_INSET, chrome);
    expect(px(box.right)).toBe(0);
  });

  it('grows the band when a module says its chrome did', () => {
    // What the constant could not do. It was sized for the call bar alone, and the transcribe module
    // contributes an extraction panel into the same fixed column — above the bar, so the band grows.
    // Asserted as the difference rather than an absolute, so the floating panel's own edge gap stays
    // one number in one place instead of being restated here.
    const taller: ContentInset = { ...chrome, bottom: BOTTOM_CHROME_PX + 56 };
    const base = snapOrigin('bottom', 400, 300, desktop, NO_INSET, chrome).y;
    expect(snapOrigin('bottom', 400, 300, desktop, NO_INSET, taller).y).toBe(base - 56);
  });
});

/**
 * How far the module rail drops to clear the chrome at the top of the window.
 *
 * The rail is pinned to the right of the *content* and the call bar to its centre, so a panel
 * displacing the right edge moves the rail by its whole width and the bar by half — and a wide
 * enough panel walks one into the other. It is the only collision the shell computes, because it is
 * the only one left: every panel state is already handled before this is asked.
 */
/**
 * What the content gives up, when the panels ask for more than there is.
 *
 * The inset is published as `--we-chrome-<edge>` and every piece of chrome positions against it, so
 * an inset wider than the window is not a rounding error — it is the rail and the call bar leaving
 * the screen. Which is what happened: each panel was clamped against the *whole* content region and
 * the results summed, so three that each fitted on their own reported more than the window between
 * them.
 */
describe('the inset when the panels do not fit', () => {
  const strip = (widths: number[]): DockRequest[] =>
    widths.map((w, index) => ({
      id: `p${index}`,
      edge: 'right' as const,
      size: 'md' as const,
      float: false,
      placement: placement({ w }),
    }));

  const region = desktop.width - SIDEBAR_PX;

  it('adds up while there is room', () => {
    expect(contentInset(strip([700, 700]), desktop).right).toBe(1400);
  });

  it('never exceeds the room there is', () => {
    // 2100 before: `--we-chrome-right: 2100px` on a 1600px window put the module rail 500px off the
    // left edge of the screen, and `--we-chrome-center-x` — derived from the same number — took the
    // call bar with it.
    expect(contentInset(strip([700, 700, 700]), desktop).right).toBe(region);
  });

  it('is not pushed past it by the minimum size either', () => {
    // The floor and the ceiling mean opposite things: `MIN_DOCK_PX` is "thinner than this is not
    // worth having", the remaining room is "there is no more screen". The floor must not win.
    expect(contentInset(strip([1400, 400]), desktop).right).toBe(region);
  });

  it('counts each edge separately', () => {
    const both: DockRequest[] = [
      { id: 'r', edge: 'right', size: 'md', float: false, placement: placement({ w: 700 }) },
      { id: 'b', edge: 'bottom', size: 'md', float: false, placement: placement({ snap: 'bottom', h: 300 }) },
    ];
    expect(contentInset(both, desktop)).toEqual({ left: 0, right: 700, top: 0, bottom: 300 });
  });
});

describe('the band under the module rail', () => {
  const inset = (over: Partial<ContentInset> = {}): ContentInset => ({ ...NO_INSET, ...over });
  const bar = { height: 74, width: 520 };

  it('is zero with no chrome at the top — there is nothing to clear', () => {
    // No call running. The band used to fire for any open panel at all, so starting a call moved the
    // rail for a video floating in the opposite corner.
    expect(railBand(desktop, inset({ right: 900 }))).toBe(0);
  });

  it('ignores a call bar the rail is nowhere near', () => {
    // The rail is at the window's edge and the bar is in the middle of the screen.
    expect(railBand(desktop, inset(), bar)).toBe(0);
  });

  it('clears the bar once a wide panel has walked the rail into it', () => {
    // 900 wide on a 1600 window: the rail's left edge is at 1600-900-56 = 644, and the bar is centred
    // at 1600/2 + (80-900)/2 = 390, spanning 130..650. Six pixels of rail over the call controls.
    expect(railBand(desktop, inset({ right: 900 }), bar)).toBe(bar.height - RAIL_TOP_PX);
  });

  it('clears the whole column, not one bar of it', () => {
    // The call bar with the extraction panel stacked under it. The cap used to be one bar deep, so
    // the rail moved and stayed overlapping the thing it had moved for.
    const stacked = { height: 74 + 56, width: 520 };
    expect(railBand(desktop, inset({ right: 900 }), stacked)).toBe(stacked.height - RAIL_TOP_PX);
  });

  it('takes no term for a panel displacing the top, since both ends move together', () => {
    // The rail's own offset already includes `--we-chrome-top`, and so does the bar's, so the
    // distance between them is unchanged. Subtracting it here would double-count.
    expect(railBand(desktop, inset({ right: 900, top: 300 }), bar)).toBe(bar.height - RAIL_TOP_PX);
  });

  it('is not moved by a panel, whatever state it is in', () => {
    // Every panel is out of the rail's way before this is asked — see the note on `railBand`. A
    // maximised one briefly had a term here so the rail could sit below its titlebar; the rail hides
    // instead, which made it dead. A band that fired for any open panel moved the rail for a video
    // floating in the opposite corner.
    expect(railBand(desktop, inset({ right: 900 }), NO_TOP_CHROME)).toBe(0);
  });
});

/**
 * A column divides an edge between the floating panels sharing it.
 *
 * The arrangement the eight snaps could not express: two cards down the left, sharing the height,
 * rather than two cards in two corners with a hole between them. Distinct from a *strip*, which is
 * what displacing panels form and which stacks perpendicular to its edge instead.
 */
describe('a floating column', () => {
  const float = (over: Partial<FloatPlacement> = {}): FloatPlacement =>
    placement({ snap: 'left', displace: false, w: 320, h: 200, ...over });

  it('stacks members down the edge instead of overlapping them', () => {
    const boxes = columnLayout([float(), float()], 'left', desktop);

    expect(boxes).toHaveLength(2);
    // Same column, so the same x; different seats, so different y.
    expect(boxes[0].x).toBe(boxes[1].x);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
    // And they do not overlap: the second starts below the first, with the gap between them.
    expect(boxes[1].y).toBe(boxes[0].y + boxes[0].h + DOCK_GAP_PX);
  });

  it('divides the spare room evenly when nobody says otherwise', () => {
    const [a, b] = columnLayout([float(), float()], 'left', desktop);

    // Equal bases and an absent grow (which means 1) is an even split.
    expect(a.h).toBeCloseTo(b.h, 5);
  });

  it('gives the slack to whoever asked for it', () => {
    const [fixed, greedy] = columnLayout([float({ grow: 0 }), float({ grow: 1 })], 'left', desktop);

    // grow: 0 keeps its own height; the other absorbs everything left over. This is what
    // "the transcript takes most of the height, the panel under it does not" is made of.
    expect(fixed.h).toBe(200);
    expect(greedy.h).toBeGreaterThan(fixed.h);
  });

  it('closing a member gives its room to the neighbours and moves nothing else', () => {
    const three = columnLayout([float(), float(), float()], 'left', desktop);
    const two = columnLayout([float(), float()], 'left', desktop);

    // The survivors grow. The point of base-plus-grow over proportions is that they grow *from their
    // own base* rather than being re-proportioned against each other.
    expect(two[0].h).toBeGreaterThan(three[0].h);
    expect(two[0].y).toBe(three[0].y);
  });

  it('keeps each member its own width', () => {
    const [a, b] = columnLayout([float({ w: 320 }), float({ w: 260 })], 'left', desktop);

    // A shared width would mean resizing one resized all of them, which is not what a card does.
    expect(a.w).toBe(320);
    expect(b.w).toBe(260);
  });

  it('hangs a right-hand column off the right edge', () => {
    const [left] = columnLayout([float()], 'left', desktop);
    const [right] = columnLayout([float({ snap: 'right' })], 'right', desktop);

    expect(right.x).toBeGreaterThan(left.x);
  });

  it('divides the width rather than the height on a top or bottom edge', () => {
    const boxes = columnLayout([float({ snap: 'top' }), float({ snap: 'top' })], 'top', desktop);

    // The axis flips with the edge: along the top, members share the width.
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[1].x).toBe(boxes[0].x + boxes[0].w + DOCK_GAP_PX);
  });

  it('never shrinks a member below the point where it stops being a panel', () => {
    const many = Array.from({ length: 12 }, () => float({ h: 400 }));
    const boxes = columnLayout(many, 'left', desktop);

    for (const box of boxes) expect(box.h).toBeGreaterThanOrEqual(MIN_FLOAT_PX);
  });

  it('gives every member the whole region on a narrow window', () => {
    const boxes = columnLayout([float(), float()], 'left', laptop);

    // Two 350px cards over content on a phone leave nothing of any of the three, so the arrangement
    // changes its mind rather than shrinking: full-bleed sheets, last one on top.
    expect(boxes[0]).toEqual(boxes[1]);
    expect(boxes[0].w).toBeGreaterThan(laptop.width / 2);
  });

  it('is empty for an edge nobody is on', () => {
    expect(columnLayout([], 'left', desktop)).toEqual([]);
  });
});

describe('who is in a column', () => {
  const member = (over: Partial<FloatPlacement> = {}) => ({
    placement: placement({ snap: 'left', displace: false, ...over }),
  });

  /** Wide enough that a displacing panel really does displace. See `NARROW_VIEWPORT_PX`. */
  const wide = { width: 1440, height: 900 };

  it('is decided by the snap, not by a declaration', () => {
    const panels = [member(), member({ snap: 'right' }), member()];

    expect(columnMembers(panels, 'left', wide)).toHaveLength(2);
  });

  it('leaves out panels that are not floating there', () => {
    const panels = [member(), member({ displace: true }), member({ maximised: true })];

    // A displacing panel is in a *strip*, and a maximised one is not on an edge at all.
    expect(columnMembers(panels, 'left', wide)).toHaveLength(1);
  });

  it('counts a displacing panel as a column member on a window too narrow to displace', () => {
    /*
      Below `NARROW_VIEWPORT_PX` the trade is refused and the panel covers instead — so it is
      floating, whatever its flag says. Read off the flag it belonged to neither arrangement: not
      the strip (which counts only what really displaces) and not the column, so two of them on one
      edge landed on the same snap and overlapped exactly.
    */
    const narrow = { width: 700, height: 900 };
    const panels = [member({ displace: true }), member({ displace: true })];

    expect(columnMembers(panels, 'left', narrow)).toHaveLength(2);
    expect(columnMembers(panels, 'left', wide)).toHaveLength(0);
  });

  it('excludes corners, which are a place for one card', () => {
    const panels = [member({ snap: 'top-left' }), member({ snap: 'bottom-left' })];

    expect(columnMembers(panels, 'left', wide)).toHaveLength(0);
  });

  it('orders members by the order a drop gave them', () => {
    const first = member({ order: 1 });
    const second = member({ order: 0 });

    expect(columnMembers([first, second], 'left', wide)).toEqual([second, first]);
  });
});

describe('the seams in a floating column', () => {
  const box = (y: number, h = 200): Rect => ({ x: 100, y, w: 320, h });

  it('offers one seat more than it has members', () => {
    expect(columnSlots('left', [box(20), box(240)])).toHaveLength(3);
  });

  it('runs its lines along the edge, not across the region', () => {
    const [first] = columnSlots('left', [box(20)]);

    // A strip's lines span the region because its members stack inward; a column's span the column,
    // because that is the boundary they are describing.
    expect(first.line.w).toBe(320);
    expect(first.line.h).toBeLessThan(10);
  });

  it('flips the axis for a top or bottom edge', () => {
    const [first] = columnSlots('top', [{ x: 100, y: 20, w: 320, h: 200 }]);

    expect(first.line.h).toBe(200);
    expect(first.line.w).toBeLessThan(10);
  });

  it('puts a seat above the first member and below each one', () => {
    const slots = columnSlots('left', [box(100), box(320)]);

    expect(slots[0].line.y).toBeLessThan(100);
    expect(slots[1].line.y).toBeGreaterThan(300);
    expect(slots[2].line.y).toBeGreaterThan(520);
  });

  it('gives a hit box far thicker than the line it draws', () => {
    const [slot] = columnSlots('left', [box(20)]);

    // A target you can land on while dragging has to be thicker than a seam anybody wants to look at.
    expect(slot.hit.h).toBeGreaterThan(slot.line.h * 4);
  });

  it('draws nothing for an edge with no column on it', () => {
    // A column is started by snapping to the edge, which the eight targets already offer.
    expect(columnSlots('left', [])).toEqual([]);
  });
});

/**
 * What an interface's own declaration becomes — the middle rung of three.
 *
 * A panel is placed by what the user last dragged it to, failing that by what the template asked
 * for, failing that by the module's own bid. This is the middle one.
 */
describe('a template’s declared placement', () => {
  it('turns a named size into pixels, against the viewport the template cannot see', () => {
    const md = placementFromDeclaration({ snap: 'left', size: 'md' }, desktop);
    const sm = placementFromDeclaration({ snap: 'left', size: 'sm' }, desktop);

    expect(md.w).toBeGreaterThan(sm.w);
    // The same table a docked panel's thickness comes from, so `md` means one thing everywhere.
    expect(md.w).toBe(dockThickness('left', 'md', desktop));
  });

  it('carries the snap, the order and the grow through untouched', () => {
    const placed = placementFromDeclaration({ snap: 'left', order: 2, grow: 0 }, desktop);

    expect(placed.snap).toBe('left');
    expect(placed.order).toBe(2);
    expect(placed.grow).toBe(0);
  });

  it('leaves order and grow absent when the declaration says nothing', () => {
    const placed = placementFromDeclaration({ snap: 'left' }, desktop);

    // Absent means "no opinion", which is what lets a column default to an even split and a strip
    // fall back to registration order. Writing 0 would be an opinion.
    expect(placed.order).toBeUndefined();
    expect(placed.grow).toBeUndefined();
  });

  it('refuses to displace from a corner', () => {
    const corner = placementFromDeclaration({ snap: 'top-left', displace: true }, desktop);
    const edge = placementFromDeclaration({ snap: 'left', displace: true }, desktop);

    // The same rule the displace toggle enforces: a rectangular layout cannot flow around a corner,
    // so a template must not be able to ask for the one arrangement that cannot be honoured.
    expect(corner.displace).toBe(false);
    expect(edge.displace).toBe(true);
  });

  it('lands bottom-right when the declaration names no position', () => {
    // The corner every picture-in-picture has trained people to look for, and what seedPlacement
    // already does for a module that asks to float.
    expect(placementFromDeclaration({}, desktop).snap).toBe('bottom-right');
  });
});

/**
 * What floating panels are covering, which is the question `contentInset` deliberately does not
 * answer.
 *
 * A floating panel takes no room, so the content region stays the whole area and a surface drawing
 * into it has no way to know which part of itself is hidden. The board found out the hard way: its
 * layout parks an unplaced card in the top-left of what it believes is in view, which is where a
 * left-snapped transcript panel sits, so every freshly extracted record was drawn underneath one.
 */
describe('what floating panels cover', () => {
  const floating = (over: Partial<FloatPlacement> = {}) => placement({ displace: false, ...over });

  it('reports a floating panel that contentInset reports as nothing', () => {
    const request = dock({ placement: floating({ snap: 'left', w: 320 }) });

    expect(contentInset([request], desktop).left).toBe(0);
    expect(coveredInset([request], desktop).left).toBe(320);
  });

  it('reports nothing for a panel that displaces, which contentInset has already counted', () => {
    // The two are complementary, not overlapping: a panel takes room or covers it, never both, so
    // adding them is always the honest total.
    const request = dock({ placement: placement({ snap: 'left', w: 320 }) });

    expect(coveredInset([request], desktop)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('takes the widest of two panels sharing an edge, not their sum', () => {
    /*
      The geometry `contentInset` gets right in the other direction. Displacing panels on one edge
      form a strip and stack inward, so their thicknesses add; floating ones form a column and divide
      the edge along its length, one above the other, so the covered band is as wide as the widest.
      Summing would report the left edge twice as covered as it is.
    */
    const covered = coveredInset(
      [
        dock({ id: 'transcript', placement: floating({ snap: 'left', w: 320 }) }),
        dock({ id: 'extraction', placement: floating({ snap: 'left', w: 240 }) }),
      ],
      desktop,
    );

    expect(covered.left).toBe(320);
  });

  it('ignores a corner panel, which covers a corner rather than a band', () => {
    // Under-reporting is the right direction to be wrong in: content lands slightly nearer a panel
    // than intended, rather than being crowded out of a strip that is mostly clear.
    const request = dock({ placement: floating({ snap: 'top-left', w: 320 }) });

    expect(coveredInset([request], desktop)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('ignores a maximised panel, which leaves no uncovered region to be about', () => {
    const request = dock({ placement: floating({ snap: 'left', maximised: true }) });

    expect(coveredInset([request], desktop)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

/**
 * A column member's height is a base plus a share of the spare room.
 *
 * Which is what made dragging the boundary between two of them impossible rather than merely
 * awkward: a resize measured the *rendered* height and wrote it back as the base, so the share was
 * counted twice and the panel jumped taller by exactly that share the moment a drag began, before
 * the pointer had moved. A divider avoids it by construction — it moves the boundary rather than
 * setting a height, so the total is unchanged, the slack is unchanged, and each panel moves by the
 * pixels the pointer did.
 */
describe('a floating column', () => {
  const member = (over: Partial<FloatPlacement> = {}): FloatPlacement =>
    placement({ snap: 'left', displace: false, w: 320, h: 200, ...over });

  it('divides the spare room by grow, so two shares against one is about two thirds', () => {
    const [top, bottom] = columnLayout([member({ grow: 2 }), member({ grow: 1 })], 'left', desktop);

    /*
      The *slack* splits two to one, which is what `grow` says: equal bases, so each height is that
      base plus its share. Asserted as the ratio of what was handed out rather than as a number,
      because the room a column has is the region less whatever chrome is reserved — and this is
      about the division, not about how much there was to divide.

      Exactly two thirds of the *column* would need the bases in the same ratio too, which is why
      `grow` is documented as a share of the spare room rather than of the whole.
    */
    expect(top.h - 200).toBeCloseTo((bottom.h - 200) * 2, 0);
  });

  it('gives a member with no grow its base and nothing more', () => {
    // The workshop declared `1` against a `0` and got a panel towering over a strip: no grow does not
    // mean "less", it means the other one takes every pixel of the slack.
    const [, bottom] = columnLayout([member({ grow: 1 }), member({ grow: 0 })], 'left', desktop);

    expect(bottom.h).toBe(200);
  });

  it('keeps the total when the boundary moves, which is what makes a divider safe', () => {
    /*
      The property the divider action relies on. Adding to one base exactly what is taken from the
      other leaves the sum — and therefore the slack, and therefore every share — untouched, so each
      rendered height moves by precisely the base delta and nothing is counted twice.
    */
    const before = columnLayout([member({ h: 200 }), member({ h: 200 })], 'left', desktop);
    const after = columnLayout([member({ h: 260 }), member({ h: 140 })], 'left', desktop);

    expect(after[0].h - before[0].h).toBe(60);
    expect(after[1].h - before[1].h).toBe(-60);
    expect(after[0].h + after[1].h).toBe(before[0].h + before[1].h);
  });
});

/**
 * Lanes — the second coordinate an edge always needed.
 *
 * `band` is how far inboard, `order` is how far along, and neither depends on `displace` any more.
 * Before this, one number answered both and the flag chose which, so the arrangement a panel got was
 * decided by a question about whether it took room: a displacing panel could only ever stack inward
 * and a floating one could only ever divide the edge. "Two sidebars, one above the other, both
 * pushing the content aside" was unreachable from either side.
 *
 * Most of what follows is one sentence from two directions: **panels in the same lane divide it,
 * panels in different lanes stack.**
 */
describe('grouping an edge into lanes', () => {
  const panel = (over: Partial<FloatPlacement> = {}) => ({
    placement: placement({ snap: 'left', displace: true, w: 300, h: 200, ...over }),
  });

  it('gives a panel that named no band a lane of its own, so nothing that predates lanes changes', () => {
    // The compatibility rule, and the reason `band` is absent rather than defaulting to 0. Two module
    // panels opening on one edge, neither ever arranged, stacked inward before lanes existed — and
    // must go on doing so rather than silently halving each other the first time both are open.
    const groups = edgeGroups([panel(), panel()], 'left', desktop);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.members.length === 1)).toBe(true);
  });

  it('makes one lane of the panels that named the same band', () => {
    const groups = edgeGroups([panel({ band: 0, order: 0 }), panel({ band: 0, order: 1 })], 'left', desktop);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it('puts the lanes somebody named before the ones nobody did', () => {
    // The rule `occupiedFor` used to carry as a pairwise comparison, said once and about lanes: an
    // arrangement first, then everything else in the order it registered — which is also "a panel
    // that arrives without being dropped anywhere lands at the end", for nothing.
    const groups = edgeGroups([panel(), panel({ band: 1 }), panel({ band: 0 })], 'left', desktop);

    expect(groups.map((group) => group.band)).toEqual([0, 1, null]);
  });

  it('orders a lane along the edge by order, and the lanes across it by band', () => {
    const groups = edgeGroups(
      [panel({ band: 1, order: 1 }), panel({ band: 0 }), panel({ band: 1, order: 0 })],
      'left',
      desktop,
    );

    expect(groups.map((group) => group.band)).toEqual([0, 1]);
    expect(groups[1].members.map((member) => member.placement.order)).toEqual([0, 1]);
  });

  it('keeps every float in one lane, last, whatever band they claim', () => {
    // A float takes no room, so there is nothing for it to be inboard of. Honouring a band here would
    // invent lanes that cost the content nothing and place cards as though they had.
    const groups = edgeGroups(
      [panel({ displace: false, band: 3 }), panel({ displace: false }), panel({ band: 0 })],
      'left',
      desktop,
    );

    expect(groups.map((group) => group.displacing)).toEqual([true, false]);
    expect(groups[1].members).toHaveLength(2);
    expect(groups[1].band).toBeNull();
  });

  it('leaves corners out of it, as it always did', () => {
    expect(edgeGroups([panel({ snap: 'top-left', band: 0 })], 'left', desktop)).toEqual([]);
  });

  it('counts a lane as thick as the widest panel in it, not as their sum', () => {
    expect(laneThickness([placement({ w: 300 }), placement({ w: 440 })], 'right')).toBe(440);
  });
});

describe('what a lane costs the content', () => {
  const request = (id: string, over: Partial<FloatPlacement> = {}): DockRequest =>
    dock({ id, placement: placement({ snap: 'right', displace: true, w: 300, ...over }) });

  it('charges once for two panels sharing a lane, since they are one band across the edge', () => {
    // Summing here would report an edge twice as deep as it is and push the whole layout into the
    // middle of the screen — the mistake `coveredInset` already exists to avoid one axis over.
    const panels = [request('a', { band: 0, order: 0 }), request('b', { band: 0, order: 1 })];

    expect(contentInset(panels, desktop).right).toBe(300);
  });

  it('charges twice for two lanes, since the second sits inboard of the first', () => {
    const panels = [request('a', { band: 0 }), request('b', { band: 1 })];

    expect(contentInset(panels, desktop).right).toBe(600);
  });

  it('charges the widest of a lane, so a panel joining one cannot be left hanging over the content', () => {
    const panels = [request('a', { band: 0, w: 300 }), request('b', { band: 0, w: 440 })];

    expect(contentInset(panels, desktop).right).toBe(440);
  });

  it('goes on charging twice for two panels that named no lane, exactly as it did before lanes', () => {
    expect(contentInset([request('a'), request('b')], desktop).right).toBe(600);
  });
});

describe('what a panel in a lane has to keep clear of', () => {
  const request = (id: string, over: Partial<FloatPlacement> = {}): DockRequest =>
    dock({ id, placement: placement({ snap: 'right', displace: true, w: 300, ...over }) });

  it('clears the lanes outboard of its own and none of the ones inboard', () => {
    const panels = [request('outer', { band: 0 }), request('inner', { band: 1 })];

    expect(occupiedFor(panels, 0, desktop).right).toBe(0);
    expect(occupiedFor(panels, 1, desktop).right).toBe(300);
  });

  it('clears nothing on account of a lane-mate, who is beside it rather than in front of it', () => {
    // The whole point of a lane: these two divide the edge, so neither steps past the other. Counting
    // a lane-mate would push the second panel inboard by the first's width and leave the lane
    // straddling the seam it was supposed to share.
    const panels = [request('a', { band: 0, order: 0 }), request('b', { band: 0, order: 1 })];

    expect(occupiedFor(panels, 0, desktop).right).toBe(0);
    expect(occupiedFor(panels, 1, desktop).right).toBe(0);
  });

  it('makes a floating panel clear every lane, since it is keeping off the edge rather than holding it', () => {
    const panels = [
      request('outer', { band: 0 }),
      request('inner', { band: 1 }),
      dock({ id: 'card', placement: placement({ snap: 'right', displace: false }) }),
    ];

    expect(occupiedFor(panels, 2, desktop).right).toBe(600);
  });
});

describe('a displacing lane', () => {
  const member = (over: Partial<FloatPlacement> = {}): FloatPlacement =>
    placement({ snap: 'left', displace: true, w: 300, h: 200, ...over });

  const lane = (members: FloatPlacement[], edge: 'left' | 'right' | 'top' | 'bottom' = 'left') =>
    columnLayout(members, edge, desktop, NO_INSET, NO_INSET, { displacing: true });

  it('divides the height between its members and leaves no gap between them', () => {
    // A gap between two panels that have taken room from the content is a strip of background where
    // the content used to be — which is what `DOCK_GAP_PX` is for on a card and wrong here.
    const [top, bottom] = lane([member(), member()]);

    expect(top.y + top.h).toBe(bottom.y);
    expect(top.h + bottom.h).toBe(desktop.height);
  });

  it('gives every member the same width, because a lane with two widths is two lanes', () => {
    const [top, bottom] = lane([member({ w: 300 }), member({ w: 440 })]);

    expect(top.w).toBe(440);
    expect(bottom.w).toBe(440);
    expect(top.x).toBe(bottom.x);
  });

  it('hands the spare height out by grow, the same division a floating one makes', () => {
    const [top, bottom] = lane([member({ grow: 2 }), member({ grow: 1 })]);

    expect(top.h - 200).toBeCloseTo((bottom.h - 200) * 2, 0);
  });

  it('divides the width rather than the height on a top or bottom edge', () => {
    const [first, second] = lane([member({ snap: 'top' }), member({ snap: 'top' })], 'top');

    expect(first.x + first.w).toBe(second.x);
    expect(first.h).toBe(second.h);
  });

  it('hangs off the right edge when that is the edge it is on', () => {
    const [top] = lane([member({ snap: 'right' }), member({ snap: 'right' })], 'right');

    expect(top.x + top.w).toBe(desktop.width);
  });

  it('spans the full height, ignoring what the horizontal edges took — the sides own the corners', () => {
    const [top, bottom] = columnLayout([member(), member()], 'left', desktop, { ...NO_INSET, bottom: 200 }, NO_INSET, {
      displacing: true,
    });

    expect(top.y).toBe(0);
    expect(top.h + bottom.h).toBe(desktop.height);
  });
});

describe('a displacing panel given a seat', () => {
  const seated = (seat: Rect) =>
    resolveDock(
      dock({ placement: placement({ snap: 'right', displace: true, w: 300 }) }),
      desktop,
      NO_INSET,
      NO_INSET,
      seat,
    );

  it('spans its seat rather than the whole edge', () => {
    const geometry = seated({ x: 1300, y: 400, w: 300, h: 500 });

    expect(px(geometry.top)).toBe(400);
    expect(px(geometry.height)).toBe(500);
    // Still pinned to its edge across the other axis: a lane is a band on the edge, not a card.
    expect(px(geometry.right)).toBe(0);
    expect(geometry.floating).toBe(false);
  });

  it('takes its thickness from the seat, so two panels in one lane cannot draw two widths', () => {
    // The placement asks for 300 and the lane resolved to 440 — the widest of its members. Reading
    // the panel's own number here is how one sidebar would have come out with a step down its side.
    expect(px(seated({ x: 1160, y: 0, w: 440, h: 900 }).width)).toBe(440);
  });

  it('spans the whole edge with no seat, which is every arrangement that predates lanes', () => {
    const geometry = resolveDock(dock({ placement: placement({ snap: 'right', displace: true }) }), desktop);

    expect(px(geometry.top)).toBe(0);
    expect(px(geometry.bottom)).toBe(0);
    expect(geometry.height).toBeUndefined();
  });
});

describe('a template declaring a lane', () => {
  it('carries the band through untouched', () => {
    expect(placementFromDeclaration({ snap: 'left', displace: true, band: 1, order: 2 }, desktop)).toMatchObject({
      band: 1,
      order: 2,
    });
  });

  it('leaves it absent when the declaration says nothing, which means a lane of its own', () => {
    // Defaulting to 0 would put every displacing panel an interface declares into one lane and halve
    // them against each other — the opposite of what a declaration silent about lanes is asking for.
    expect(placementFromDeclaration({ snap: 'left', displace: true }, desktop).band).toBeUndefined();
  });
});

/**
 * Dropping a panel on an edge, and the renumbering that follows.
 *
 * Pure and tested here rather than in the store, because it rewrites two coordinates for every panel
 * on an edge and a mistake in it shows up as a panel appearing somewhere nobody dropped it — several
 * frames later, with nothing to point at.
 */
describe('a drop on an edge', () => {
  const panel = (over: Partial<FloatPlacement> = {}) => ({
    placement: placement({ snap: 'left', displace: true, w: 300, h: 200, ...over }),
  });
  const drop = (panels: { placement: FloatPlacement }[], moving: number, target: Omit<DropTarget, 'edge'>) =>
    arrangeDrop(panels, moving, { edge: 'left', ...target }, desktop);

  it('opens a lane of its own at the position it was dropped, pushing the rest inboard', () => {
    // The old strip drop, in the coordinate that owns it now.
    const arranged = drop([panel({ band: 0 }), panel({ band: 1 }), panel({ snap: null, displace: false })], 2, {
      mode: 'band',
      position: 0,
    });

    expect(arranged).toEqual([
      { index: 2, band: 0, order: 0 },
      { index: 0, band: 1, order: 0 },
      { index: 1, band: 2, order: 0 },
    ]);
  });

  it('appends past the last lane when the position is past the end', () => {
    const arranged = drop([panel({ band: 0 }), panel({ snap: null, displace: false })], 1, {
      mode: 'band',
      position: 9,
    });

    expect(arranged).toEqual([
      { index: 0, band: 0, order: 0 },
      { index: 1, band: 1, order: 0 },
    ]);
  });

  it('takes a seat in the lane it was dropped into, sharing that lane band', () => {
    const arranged = drop([panel({ band: 0 }), panel({ band: 1 }), panel({ snap: null, displace: false })], 2, {
      mode: 'lane',
      lane: 1,
      position: 0,
    });

    expect(arranged).toEqual([
      { index: 0, band: 0, order: 0 },
      { index: 2, band: 1, order: 0 },
      { index: 1, band: 1, order: 1 },
    ]);
  });

  it('names an unnamed lane by joining it, since absent stops meaning "mine alone" the moment it is shared', () => {
    // Two panels that never named a band are two lanes. Dropping a third into the second of them
    // makes that lane real, so every panel on the edge comes out holding the band it now has —
    // there being no other stable way to say "these two".
    const arranged = drop([panel(), panel(), panel({ snap: null, displace: false })], 2, {
      mode: 'lane',
      lane: 1,
      position: 1,
    });

    expect(arranged).toEqual([
      { index: 0, band: 0, order: 0 },
      { index: 1, band: 1, order: 0 },
      { index: 2, band: 1, order: 1 },
    ]);
  });

  it('leaves the panel being moved out of the arrangement it is joining', () => {
    /*
      Or a drop would offer a seat either side of where the panel already is, and a lane it was the
      only member of would be held open by a panel that has left it. Moving the outer of two lanes
      inboard has to leave one lane behind, not two.
    */
    const arranged = drop([panel({ band: 0 }), panel({ band: 1 })], 0, { mode: 'band', position: 1 });

    expect(arranged).toEqual([
      { index: 1, band: 0, order: 0 },
      { index: 0, band: 1, order: 0 },
    ]);
  });

  it('gives the floating lane no band at all, which is what makes a float take no room', () => {
    const arranged = drop([panel({ displace: false }), panel({ band: 0 })], 0, {
      mode: 'lane',
      lane: 'float',
      position: 0,
    });

    expect(arranged).toEqual([{ index: 0, order: 0 }]);
    expect(arranged.every((entry) => entry.band === undefined)).toBe(true);
  });

  it('starts a lane on an empty edge, which is how an arrangement gets going', () => {
    const arranged = drop([panel({ snap: null, displace: false })], 0, { mode: 'band', position: 0 });

    expect(arranged).toEqual([{ index: 0, band: 0, order: 0 }]);
  });

  it('falls back to a lane of its own when the lane it named has gone', () => {
    // The panel was the only member of that lane, so leaving it out took the lane with it. Landing
    // beside nothing is better than landing nowhere.
    const arranged = drop([panel({ band: 0 }), panel({ band: 1 })], 1, { mode: 'lane', lane: 1, position: 0 });

    expect(arranged).toEqual([
      { index: 1, band: 0, order: 0 },
      { index: 0, band: 1, order: 0 },
    ]);
  });
});

/**
 * Which panel paints over which.
 *
 * Every frame used to share the one `sticky` layer, so overlap was settled by document order — the
 * registry's — and nothing a person did could change it. Maximise a panel and anything registered
 * after it went on painting over the top.
 */
describe('stacking panels', () => {
  it('puts the most recently touched panel on top', () => {
    const layers = layerOrder(['a', 'b', 'c'], { a: 3, b: 1, c: 2 });

    expect(layers.a).toBeGreaterThan(layers.c);
    expect(layers.c).toBeGreaterThan(layers.b);
  });

  it('keeps untouched panels in the order they registered, underneath everything touched', () => {
    // A screen where nothing has been clicked stacks exactly as it always did.
    const layers = layerOrder(['a', 'b', 'c'], { c: 1 });

    expect(layers.a).toBe(PANEL_LAYER_BASE);
    expect(layers.b).toBe(PANEL_LAYER_BASE + 1);
    expect(layers.c).toBe(PANEL_LAYER_BASE + 2);
  });

  it('counts up from the sticky band, one step per panel', () => {
    const layers = layerOrder(['a', 'b'], {});

    expect(Math.min(...Object.values(layers))).toBe(PANEL_LAYER_BASE);
    expect(Math.max(...Object.values(layers))).toBe(PANEL_LAYER_BASE + 1);
  });
});

/**
 * The divider between two lane-mates.
 *
 * It used to be a grip inside the earlier panel's frame, straddling the frame's edge — and the frame
 * clips, so the half outside it and the whole of its line were never drawn. The seam is a box the
 * geometry publishes and the frame's wrapper draws from outside both panels.
 */
describe('the seam between two lane-mates', () => {
  it('is centred on the boundary and spans the pair, for a vertical lane', () => {
    const seam = seamBetween({ x: 88, y: 0, w: 320, h: 400 }, { x: 88, y: 408, w: 320, h: 400 }, 'vertical');

    expect(seam.y + seam.h / 2).toBe(404);
    expect(seam.h).toBe(SEAM_PX);
    expect(seam.x).toBe(88);
    expect(seam.w).toBe(320);
  });

  it('stands on the shared edge of two displacing panels, which have no gap', () => {
    const seam = seamBetween({ x: 80, y: 0, w: 300, h: 450 }, { x: 80, y: 450, w: 300, h: 450 }, 'vertical');

    expect(seam.y + seam.h / 2).toBe(450);
  });

  it('runs the other way for a horizontal lane', () => {
    const seam = seamBetween({ x: 0, y: 0, w: 400, h: 200 }, { x: 408, y: 0, w: 400, h: 200 }, 'horizontal');

    expect(seam.x + seam.w / 2).toBe(404);
    expect(seam.w).toBe(SEAM_PX);
    expect(seam.y).toBe(0);
    expect(seam.h).toBe(200);
  });

  it('spans the wider of two members that do not share a width', () => {
    // Floating lane-mates keep their own widths; the divider covers both so it is under the pointer
    // wherever along the boundary somebody reaches for it.
    const seam = seamBetween({ x: 88, y: 0, w: 320, h: 400 }, { x: 88, y: 408, w: 440, h: 400 }, 'vertical');

    expect(seam.w).toBe(440);
  });
});

/**
 * A panel's own floor, and folding it to its titlebar.
 *
 * `MIN_DOCK_PX` and `MIN_FLOAT_PX` were one floor for every panel, wrong in both directions: a call
 * stage below 300px shows tiles nobody can see, and a transcript is readable at half that. A panel
 * says where usable stops; folding is the one time it goes deliberately below it.
 */
describe('where usable stops', () => {
  it('is the host default for a panel that says nothing', () => {
    expect(floorOf(undefined, 'w', true)).toBe(MIN_DOCK_PX);
    expect(floorOf(undefined, 'h', false)).toBe(MIN_FLOAT_PX);
  });

  it('is what the panel declared, per axis, when it did', () => {
    expect(floorOf({ width: 320 }, 'w', true)).toBe(320);
    expect(floorOf({ width: 320 }, 'h', true)).toBe(MIN_DOCK_PX);
  });

  it('is the titlebar for a folded panel, whatever it declared', () => {
    expect(floorOf({ height: 400 }, 'h', false, true)).toBe(COLLAPSED_PX);
  });

  it('holds a lane member at its declared floor when the lane is over-subscribed', () => {
    // 900px of height, three panels each asking 600, one of which refuses to go below 400. The
    // other two share what is left rather than all three shrinking alike.
    const member = (min?: { height: number }): LaneMember => ({
      ...placement({ snap: 'left', displace: false, h: 600 }),
      min,
    });
    const [held, a, b] = columnLayout([member({ height: 400 }), member(), member()], 'left', desktop);

    expect(held.h).toBe(400);
    expect(a.h).toBeLessThan(400);
    expect(a.h).toBe(b.h);
  });

  it('refuses to resolve a lone displacing panel narrower than it declared', () => {
    const geometry = resolveDock(
      dock({ min: { width: 360 }, placement: placement({ snap: 'right', displace: true, w: 200 }) }),
      desktop,
    );

    expect(px(geometry.width)).toBe(360);
  });

  it('refuses to resolve a floating card smaller than it declared', () => {
    const geometry = resolveDock(
      dock({
        min: { width: 300, height: 240 },
        placement: placement({ snap: 'bottom-right', displace: false, w: 150, h: 150 }),
      }),
      desktop,
    );

    expect(px(geometry.width)).toBe(300);
    expect(px(geometry.height)).toBe(240);
  });
});

describe('a panel folded to its titlebar', () => {
  const member = (over: Partial<FloatPlacement> = {}) => placement({ snap: 'left', displace: false, h: 300, ...over });

  it('takes only its bar in a lane, and its lane-mate takes the rest', () => {
    const [folded, open] = columnLayout([member({ collapsed: true }), member()], 'left', desktop);

    expect(folded.h).toBe(COLLAPSED_PX);
    expect(open.h).toBeGreaterThan(300);
  });

  it('wants none of the spare room, so unfolding gives back exactly what it had', () => {
    // Its grow reads as zero while folded: the room it would have taken goes to the others and comes
    // back when it opens, rather than being split with it while it has nothing to show.
    const before = columnLayout([member({ grow: 1 }), member({ grow: 1 })], 'left', desktop);
    const during = columnLayout([member({ grow: 1, collapsed: true }), member({ grow: 1 })], 'left', desktop);
    const after = columnLayout([member({ grow: 1 }), member({ grow: 1 })], 'left', desktop);

    expect(during[1].h).toBeGreaterThan(before[1].h);
    expect(after[0].h).toBe(before[0].h);
  });

  it('is its bar tall as a lone card too', () => {
    const geometry = resolveDock(
      dock({ placement: placement({ snap: 'bottom-right', displace: false, h: 300, collapsed: true }) }),
      desktop,
    );

    expect(px(geometry.height)).toBe(COLLAPSED_PX);
  });
});

/**
 * Seats — several panels in one place, one showing.
 *
 * The overflow valve. Lanes raised how many panels an edge can hold at once; a seat is how it holds
 * more than it can show. Two panels sharing an explicit `order` in one lane are tabs.
 */
describe('a seat shared by several panels', () => {
  const panel = (over: Partial<FloatPlacement> = {}) => ({
    placement: placement({ snap: 'left', displace: true, band: 0, ...over }),
  });

  it('is made by naming the same order, and nothing else', () => {
    const [lane] = edgeGroups([panel({ order: 0 }), panel({ order: 0 }), panel({ order: 1 })], 'left', desktop);

    expect(lane.seats.map((seat) => seat.length)).toEqual([2, 1]);
  });

  it('never merges two panels that named no order, whatever sat them side by side', () => {
    // The same rule as band: absent means "of my own". Two module panels that never said where they
    // sit must not become tabs of each other the first time both are open.
    const [lane] = edgeGroups([panel(), panel()], 'left', desktop);

    expect(lane.seats.map((seat) => seat.length)).toEqual([1, 1]);
  });

  it('orders a seat by tab, and the lane by order', () => {
    const [lane] = edgeGroups(
      [panel({ order: 1 }), panel({ order: 0, tab: 1 }), panel({ order: 0, tab: 0 })],
      'left',
      desktop,
    );

    expect(lane.seats[0].map((member) => member.placement.tab)).toEqual([0, 1]);
    expect(lane.seats[1][0].placement.order).toBe(1);
    // `members` is the same panels flattened, seat by seat — what everything else still reads.
    expect(lane.members).toHaveLength(3);
  });
});

describe('a drop onto a seat', () => {
  const panel = (over: Partial<FloatPlacement> = {}) => ({
    placement: placement({ snap: 'left', displace: true, ...over }),
  });
  const drop = (panels: { placement: FloatPlacement }[], moving: number, target: Omit<DropTarget, 'edge'>) =>
    arrangeDrop(panels, moving, { edge: 'left', ...target }, desktop);

  it('stacks the panel behind whatever is in that seat, sharing its order', () => {
    const arranged = drop(
      [panel({ band: 0, order: 0 }), panel({ band: 0, order: 1 }), panel({ snap: null, displace: false })],
      2,
      {
        mode: 'tab',
        lane: 0,
        position: 1,
      },
    );

    expect(arranged).toEqual([
      { index: 0, band: 0, order: 0 },
      { index: 1, band: 0, order: 1, tab: 0 },
      { index: 2, band: 0, order: 1, tab: 1 },
    ]);
  });

  it('gives a seat of one no tab at all, so a panel alone never reads as stacked', () => {
    const arranged = drop([panel({ band: 0, order: 0 }), panel({ snap: null, displace: false })], 1, {
      mode: 'lane',
      lane: 0,
      position: 1,
    });

    expect(arranged.every((entry) => entry.tab === undefined)).toBe(true);
  });

  it('takes a panel out of a seat when it is dropped elsewhere, and the seat closes up', () => {
    // A seat of two loses one and becomes a seat of one, which names no tab.
    const arranged = drop([panel({ band: 0, order: 0, tab: 0 }), panel({ band: 0, order: 0, tab: 1 })], 1, {
      mode: 'band',
      position: 1,
    });

    expect(arranged).toEqual([
      { index: 0, band: 0, order: 0 },
      { index: 1, band: 1, order: 0 },
    ]);
  });

  it('falls back to a seat of its own when the seat it named has gone', () => {
    const arranged = drop([panel({ band: 0, order: 0 })], 0, { mode: 'tab', lane: 0, position: 0 });

    expect(arranged).toEqual([{ index: 0, band: 0, order: 0 }]);
  });

  it('stacks into the floating lane too', () => {
    const arranged = drop([panel({ displace: false, order: 0 }), panel({ snap: null, displace: false })], 1, {
      mode: 'tab',
      lane: 'float',
      position: 0,
    });

    expect(arranged).toEqual([
      { index: 0, order: 0, tab: 0 },
      { index: 1, order: 0, tab: 1 },
    ]);
  });
});

/**
 * Home lanes — a lane in the template's own flow.
 *
 * A section declared `home` starts in the template rather than on an edge; breaking it out is a
 * change of snap, and putting it back is snapping to `home`. Same coordinates, in the template.
 */
describe('a section at home in the template', () => {
  it('starts at home when the declaration names a lane, whatever snap it also names', () => {
    const declared = placementFromDeclaration({ home: 'sidebar', snap: 'left', order: 1 }, desktop);

    expect(declared.snap).toBe('home');
    expect(declared.home).toBe('sidebar');
    expect(declared.order).toBe(1);
  });

  it('is open but draws no box in the dock layer', () => {
    const geometry = resolveDock(
      dock({ placement: { ...placement({ snap: 'home', displace: false }), home: 'sidebar' } }),
      desktop,
    );

    expect(geometry.edge).toBe('right');
    expect(geometry.home).toBe(true);
    expect(geometry.top).toBeUndefined();
    expect(geometry.width).toBeUndefined();
  });

  it('takes no room and covers nothing, since it is content', () => {
    const request = dock({ placement: { ...placement({ snap: 'home', displace: true }), home: 'sidebar' } });

    expect(contentInset([request], desktop)).toEqual(NO_INSET);
    expect(coveredInset([request], desktop)).toEqual(NO_INSET);
  });

  it('is not in any edge lane', () => {
    const panels = [{ placement: { ...placement({ snap: 'home', displace: true }), home: 'sidebar' } }];

    expect(edgeGroups(panels, 'left', desktop)).toEqual([]);
    expect(edgeGroups(panels, 'right', desktop)).toEqual([]);
  });
});

describe('the sections in a home lane', () => {
  const section = (home: string, order?: number, snap: SnapPoint | null = 'home') => ({
    placement: { ...placement({ snap, displace: false, order }), home },
  });

  it('are the panels whose snap is home and whose home names the lane, in order', () => {
    const members = homeLaneMembers(
      [section('right', 1), section('left', 0), section('right', 0), section('right', 0, 'left')],
      'right',
    );

    expect(members.map((member) => member.placement.order)).toEqual([0, 1]);
  });

  it('close up around a drop, and the newcomer takes the position it was dropped at', () => {
    const arranged = arrangeHomeDrop([section('right', 0), section('right', 1), section('left', 0)], 2, 'right', 1);

    expect(arranged).toEqual([
      { index: 0, order: 0 },
      { index: 2, order: 1 },
      { index: 1, order: 2 },
    ]);
  });

  it('leaves the panel being moved out of the lane it is dropped into', () => {
    // Moving the first section to the end: the lane is renumbered without a gap where it was.
    const arranged = arrangeHomeDrop([section('right', 0), section('right', 1)], 0, 'right', 9);

    expect(arranged).toEqual([
      { index: 1, order: 0 },
      { index: 0, order: 1 },
    ]);
  });

  it('starts a lane that was empty', () => {
    expect(arrangeHomeDrop([section('left', 0)], 0, 'right', 0)).toEqual([{ index: 0, order: 0 }]);
  });
});

/**
 * One target family at a time.
 *
 * A drag used to offer every seam on every edge at once. An edge's targets now appear only while the
 * dragged panel has reached that edge's band — its lanes, plus a reach past them.
 */
describe('reaching an edge', () => {
  it('counts a panel carried to within reach of an empty edge', () => {
    const box = { x: desktop.width - EDGE_REACH_PX - 100, y: 300, w: 200, h: 150 };

    expect(nearEdge(box, 'right', desktop, 0)).toBe(true);
    expect(nearEdge(box, 'left', desktop, 0)).toBe(false);
  });

  it('does not count a panel in the middle of the screen', () => {
    const box = { x: desktop.width / 2 - 100, y: desktop.height / 2 - 75, w: 200, h: 150 };

    expect(nearEdge(box, 'right', desktop, 0)).toBe(false);
    expect(nearEdge(box, 'top', desktop, 0)).toBe(false);
  });

  it('reaches further in past the lanes an edge already holds', () => {
    // Two 300px lanes on the right: their innermost seams are 600px in, and a panel over them is
    // at that edge, whatever the screen's middle is.
    const overInnerLane = { x: desktop.width - 650, y: 300, w: 100, h: 100 };

    expect(nearEdge(overInnerLane, 'right', desktop, 0)).toBe(false);
    expect(nearEdge(overInnerLane, 'right', desktop, 600)).toBe(true);
  });

  it('starts the left band at the content, not the sidebar', () => {
    expect(edgeZone('left', desktop, 0).x).toBe(SIDEBAR_PX);
  });

  it('grows a box the same amount on every side', () => {
    expect(grown({ x: 100, y: 100, w: 50, h: 50 }, 10)).toEqual({ x: 90, y: 90, w: 70, h: 70 });
  });
});

/**
 * The two things that made a populated edge hard to drop into.
 *
 * A displacing lane spans its whole edge and has no gaps, so the seams that would divide it landed
 * outside the screen; and a seat's target is half a panel, so ranked by area it beat every line it
 * overlapped. Between them, a panel could be stacked *against* a sidebar but never *into* one, and
 * the boundary between two sidebars was reachable only in the sliver a seat's target does not cover.
 */
describe('the seams of a full-height lane', () => {
  const full = { x: SIDEBAR_PX, y: 0, w: 300, h: desktop.height };

  const screen = { x: 0, y: 0, w: desktop.width, h: desktop.height };

  it('are reachable, rather than half a gap off each end of the screen', () => {
    const [first, last] = columnSlots('left', [full], screen);

    expect(first.line.y).toBeGreaterThanOrEqual(0);
    expect(last.line.y + last.line.h).toBeLessThanOrEqual(desktop.height);
  });

  it('still sit on the boundary between two members, where there is one', () => {
    const top = { x: SIDEBAR_PX, y: 0, w: 300, h: 450 };
    const bottom = { x: SIDEBAR_PX, y: 450, w: 300, h: 450 };
    const middle = columnSlots('left', [top, bottom], screen)[1];

    // The midpoint of the two, which for a flush lane *is* the shared edge.
    expect(middle.line.y + middle.line.h / 2).toBeCloseTo(450, 0);
  });

  it('span the lane rather than the screen', () => {
    expect(columnSlots('left', [full], screen)[0].line.w).toBe(300);
  });
});

describe('which drop target wins', () => {
  it('puts a boundary ahead of the seat behind it, whatever their sizes', () => {
    // A seam is twenty pixels and a seat's target is half a panel; by area the seat won every time.
    expect(targetRank('band')).toBeLessThan(targetRank('tab'));
    expect(targetRank('lane')).toBeLessThan(targetRank('tab'));
    expect(targetRank('home')).toBeLessThan(targetRank('tab'));
  });

  it('leaves the kinds of boundary to be settled by area, as they always were', () => {
    expect(targetRank('band')).toBe(targetRank('lane'));
  });
});

/**
 * Where the pointer is, before what the panel covers.
 *
 * A dragged panel hangs *downward* from the pointer holding its titlebar, so ranking targets by how
 * much of the panel covers them asked a question nobody was answering with their hand: the seam at
 * the bottom of a lane was reachable from six hundred pixels away and the one at its top only from
 * within twenty, and a seat's target — always overlapped by some seam, and outranked by it — could
 * not be reached at all.
 */
describe('pointing at a drop target', () => {
  const seam = { x: 80, y: 0, w: 300, h: 20 };
  const seat = { x: 80, y: 225, w: 150, h: 450 };

  it('is symmetric, where covering it is not', () => {
    // The same 200px panel, its top at the same distance from each end of a full-height lane. By
    // area the bottom seam wins from far away and the top seam never does; by pointer, neither.
    expect(contains({ x: 200, y: 10 }, seam)).toBe(true);
    expect(contains({ x: 200, y: 300 }, seam)).toBe(false);
  });

  it('reaches a seat, which a rect-sized answer could not', () => {
    expect(contains({ x: 150, y: 400 }, seat)).toBe(true);
  });

  it('takes the edges of a box, so a boundary is not a pixel wide', () => {
    expect(contains({ x: 80, y: 0 }, seam)).toBe(true);
    expect(contains({ x: 380, y: 20 }, seam)).toBe(true);
    expect(contains({ x: 381, y: 10 }, seam)).toBe(false);
  });
});

/**
 * Which of the overlapping offers a drop is actually being made.
 *
 * Targets overlap by design, and the two rules that came before this each made one of them
 * unreachable. Ranked by how much of the dragged *panel* covered them: a panel hangs downward from
 * the pointer, so a lane's bottom seam was reachable from six hundred pixels away and its top seam
 * only from within twenty. Ranked by kind: a seam always beat the "make a tab of this" region, which
 * was drawn and could never be taken.
 */
describe('choosing among overlapping drop targets', () => {
  const screen = { x: 0, y: 0, w: desktop.width, h: desktop.height };
  const lane = { x: SIDEBAR_PX, y: 0, w: 300, h: desktop.height };
  const dragged = { x: 120, y: 0, w: 320, h: 200 };

  /** The offers a left-hand sidebar and an empty top edge make between them. */
  const offers = [
    ...columnSlots('left', [lane], screen).map((slot) => ({ mode: 'lane' as const, index: slot.index, hit: slot.hit })),
    ...insertionSlots('left', [lane], desktop).map((slot) => ({
      mode: 'band' as const,
      index: slot.index,
      hit: slot.hit,
    })),
    ...insertionSlots('top', [], desktop).map((slot) => ({ mode: 'band' as const, index: 99, hit: slot.hit })),
  ];

  it('offers the seam above a docked sidebar, not the whole top edge behind it', () => {
    /*
      The bug this rule exists for. Both contain a pointer at the top-left: the lane's seam is 300×20
      and the edge's "start a lane here" band runs 1520×24 across the screen. By covered area the
      band won every time, so dropping above the top panel of a left-hand stack silently docked to
      the top of the window instead — and the seam at the *bottom* of the same lane, with no band
      over it, worked. One lane, two ends, two different answers.
    */
    const chosen = chooseTarget(offers, { x: 200, y: 5 }, dragged);

    expect(chosen?.mode).toBe('lane');
    expect(chosen?.index).toBe(0);
  });

  it('offers the same seam at the other end, which is what made the asymmetry visible', () => {
    const chosen = chooseTarget(offers, { x: 200, y: 890 }, { ...dragged, y: 700 });

    expect(chosen?.mode).toBe('lane');
    expect(chosen?.index).toBe(1);
  });

  it('offers a seat when the pointer is in the middle of a panel, whatever the panel covers', () => {
    const seat = { mode: 'tab' as const, index: 0, hit: { x: SIDEBAR_PX + 75, y: 225, w: 150, h: 450 } };
    const chosen = chooseTarget([...offers, seat], { x: 200, y: 450 }, { ...dragged, y: 350 });

    expect(chosen?.mode).toBe('tab');
  });

  it('falls back to what the panel covers where the pointer is over nothing', () => {
    // The rule this replaced, kept for the case it was written for — and a boundary still beats a
    // region there, since a panel large enough to lie over two things is not pointing at either.
    const chosen = chooseTarget(offers, { x: 900, y: 450 }, { x: 60, y: 400, w: 340, h: 100 });

    expect(chosen?.mode).toBe('band');
  });
});

/**
 * When folding to the titlebar is worth offering.
 *
 * The question underneath is whether there is anywhere for the room to go. A float hands its room
 * back to the screen; a displacing panel hands it to a lane-mate, and with nobody to take it the
 * fold leaves the content still inset by the full width and a bar stranded at the top of an empty
 * column — hiding the contents of a sidebar that is still there.
 */
describe('offering to fold a panel', () => {
  const float = { floating: true };
  const docked = { floating: false };

  it('is always on for a floating card, which gives its room back to the screen', () => {
    expect(canFold(float, false, false)).toBe(true);
  });

  it('is off for a sidebar alone on its edge, where the fold would empty the column', () => {
    expect(canFold(docked, false, false)).toBe(false);
  });

  it('is on for a sidebar with an open lane-mate to take the room', () => {
    expect(canFold(docked, false, true)).toBe(true);
  });

  it('is off for the last open member of a lane, which is the same emptiness one step later', () => {
    // Fold one of a pair and the other may not follow: two bars over a column keeping its full
    // width is what refusing the lone sidebar was avoiding in the first place.
    expect(canFold(docked, false, false)).toBe(false);
  });

  it('is on for a panel that is already folded, whatever the lane looks like around it', () => {
    // Or folding the second-to-last member would disable the control that undoes it.
    expect(canFold(docked, true, false)).toBe(true);
  });

  it('is off for a maximised panel, which has nothing to fold into', () => {
    expect(canFold({ floating: true, maximised: true }, false, true)).toBe(false);
  });

  it('is off for a section at home, which has no titlebar to fold to', () => {
    expect(canFold({ floating: true, home: true }, false, true)).toBe(false);
  });
});
