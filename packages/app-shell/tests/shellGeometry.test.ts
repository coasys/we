/**
 * The arithmetic the shell store used to hold: which tab of a seat shows, how lanes are seated and
 * resolved, where a resize leaves a box, and what a drag is offered. Pure, so asked directly — the
 * store tests ask the same questions through the store.
 */
import { describe, expect, it } from 'vitest';

import {
  arrangedPanel,
  type DockRequest,
  edgeDropSlots,
  edgeSeatOrder,
  type FloatPlacement,
  frontOf,
  laneSectionsOf,
  liftedCard,
  movedBoundary,
  resizedBox,
  resolveDocks,
  seatLanes,
  stackCandidates,
  TITLE_BAR_PX,
} from '../src/shared/dockGeometry';

const viewport = { width: 1440, height: 900 };
const chrome = { left: 0, right: 56, top: 0, bottom: 0 };
const card = (over: Partial<FloatPlacement> = {}): FloatPlacement => ({
  snap: 'right',
  x: 0,
  y: 0,
  w: 320,
  h: 400,
  displace: false,
  ...over,
});
const dock = (id: string, placement: FloatPlacement): DockRequest => ({
  id,
  edge: 'right',
  size: 'md',
  float: false,
  placement,
});

describe('frontOf', () => {
  it('is the one touched last, and the first when none has been', () => {
    expect(frontOf(['a', 'b', 'c'], (id) => id, { b: 3, c: 2 })).toBe('b');
    expect(frontOf(['a', 'b'], (id) => id, {})).toBe('a');
  });
});

describe('seatLanes', () => {
  it('shows one tab of a seat, hides the rest, and hands the front the strip', () => {
    const requests = [
      dock('a', card({ snap: 'right', displace: true, band: 0, order: 0 })),
      dock('b', card({ snap: 'right', displace: true, band: 0, order: 0, tab: 1 })),
    ];
    const seating = seatLanes({ requests, viewport, chrome, touched: { b: 5 }, titles: { a: 'Notes' } });
    expect(seating.hidden).toMatchObject({ a: true, b: false });
    expect(seating.tabs.b).toEqual([
      { id: 'b', title: 'b', active: true },
      { id: 'a', title: 'Notes', active: false },
    ]);
    expect(seating.follows).toEqual({ a: 'b' });
    expect(seating.canStow.b).toBe(true);
  });

  it('puts a stowed lane on its strip and offers no fold to a lone sidebar', () => {
    const requests = [dock('a', card({ snap: 'right', displace: true, stowed: true }))];
    const stowed = seatLanes({ requests, viewport, chrome, touched: {}, titles: {} });
    expect(stowed.stowed.a).toBeDefined();
    const open = seatLanes({
      requests: [dock('a', card({ snap: 'right', displace: true }))],
      viewport,
      chrome,
      touched: {},
      titles: {},
    });
    expect(open.laneRoom.a).toBe(false);
  });
});

describe('resolveDocks', () => {
  const resolve = (requests: DockRequest[], over: Partial<Parameters<typeof resolveDocks>[0]> = {}) =>
    resolveDocks({
      requests,
      seating: seatLanes({ requests, viewport, chrome, touched: {}, titles: {} }),
      viewport,
      chrome,
      fullScreenChrome: { left: 0, right: 0, top: 0, bottom: 0 },
      touched: {},
      titles: {},
      settling: '',
      landedTab: '',
      laneMove: null,
      stowPending: null,
      away: 'shown',
      sections: {},
      fixed: {},
      framed: {},
      ...over,
    });

  it('makes a maximised panel the only one', () => {
    const geometry = resolve([dock('a', card({ maximised: true })), dock('b', card({ snap: 'left' }))]);
    expect(geometry.a.hidden).toBe(false);
    expect(geometry.b.hidden).toBe(true);
  });

  it('fades every panel on the way out and hides them once away', () => {
    const requests = [dock('a', card())];
    expect(resolve(requests, { away: 'leaving' }).a).toMatchObject({ hidden: false, awayFaded: true });
    expect(resolve(requests, { away: 'away' }).a).toMatchObject({ hidden: true, awayFaded: true });
  });
});

describe('laneSectionsOf', () => {
  it('orders a lane along it, then as declared, and keeps a place for a section that is away', () => {
    const home = (id: string, order?: number): DockRequest =>
      dock(id, card({ snap: 'home', home: 'side', ...(order !== undefined ? { order } : {}) }));
    const sections = laneSectionsOf({
      requests: [home('b'), home('a'), dock('c', card())],
      homes: { c: 'side' },
      declared: ['a', 'b'],
      instances: {},
    });
    expect(sections.side.map((section) => section.id)).toEqual(['a', 'b', 'c']);
    expect(sections.side[2]).toEqual({ id: 'c', open: true, away: true });
  });
});

describe('resizedBox', () => {
  it('moves the pulled edge and pins the other, stopping at the floor', () => {
    const start = { x: 100, y: 100, w: 300, h: 200 };
    expect(resizedBox(start, 'left', -50, 0, { w: 120, h: 120 }).box).toEqual({ x: 50, y: 100, w: 350, h: 200 });
    const squashed = resizedBox(start, 'top-left', 250, 0, { w: 120, h: 120 });
    expect(squashed.box).toEqual({ x: 280, y: 100, w: 120, h: 200 });
    expect(squashed.asked.w).toBe(50);
  });
});

describe('movedBoundary', () => {
  it('gives one side what the other loses, and stops at either floor', () => {
    expect(movedBoundary({ top: 300, bottom: 300 }, 50, { top: 100, bottom: 100 })).toEqual({ top: 350, bottom: 250 });
    expect(movedBoundary({ top: 300, bottom: 300 }, 400, { top: 100, bottom: 100 })).toEqual({ top: 500, bottom: 100 });
    expect(movedBoundary({ top: 300, bottom: 300 }, -400, { top: 100, bottom: 100 })).toEqual({
      top: 100,
      bottom: 500,
    });
  });
});

describe('liftedCard', () => {
  it('keeps the pointer the same fraction along the titlebar', () => {
    const lifted = liftedCard(card({ maximised: true }), { x: 0, y: 0, w: 1000, h: 800 }, { x: 250, y: 10 });
    expect(lifted).toMatchObject({
      snap: null,
      maximised: false,
      displace: false,
      x: 250 - 80,
      y: 10 - TITLE_BAR_PX / 2,
    });
  });
});

describe('stackCandidates and edgeSeatOrder', () => {
  it('offers only cards in open space, and never the one moving', () => {
    const requests = [dock('a', card({ snap: null })), dock('b', card({ snap: null })), dock('c', card())];
    expect(stackCandidates(requests, {}, 'a')).toEqual([1]);
    expect(stackCandidates(requests, { b: true }, null)).toEqual([0]);
  });

  it('seats a snap after the cards already there, not counting the ones moving', () => {
    const requests = [dock('a', card({ order: 0 })), dock('b', card({ order: 1 }))];
    expect(edgeSeatOrder(requests, ['c'], 'right', undefined)).toBe(2);
    expect(edgeSeatOrder(requests, ['b'], 'right', 1)).toBe(1);
  });
});

describe('edgeDropSlots', () => {
  it('offers a seat to stack onto anywhere, and an edge’s lines only once it is reached', () => {
    const requests = [dock('a', card({ snap: 'right', displace: true })), dock('m', card({ snap: null }))];
    const boxes = { a: { x: 1120, y: 0, w: 320, h: 900 }, m: { x: 400, y: 300, w: 320, h: 400 } };
    const input = {
      requests,
      moving: 'm',
      boxes,
      hidden: {},
      viewport,
      inset: { left: 0, right: 320, top: 0, bottom: 0 },
      occupied: { left: 0, right: 320, top: 0, bottom: 0 },
    };
    const far = edgeDropSlots({ ...input, carried: boxes.m });
    expect(far.map((slot) => slot.key)).toEqual(['tab:right:0:0']);
    const near = edgeDropSlots({ ...input, carried: { x: 1000, y: 300, w: 320, h: 400 } });
    expect(near.some((slot) => slot.mode === 'band' && slot.edge === 'right')).toBe(true);
  });
});

describe('arrangedPanel', () => {
  it('writes the reader’s coordinates over the author’s and keeps everything else', () => {
    const panel = { id: 'notes', title: 'Notes', snap: 'left' as const, order: 2, size: 'md' as const };
    expect(arrangedPanel(panel, card({ snap: 'home', home: 'side', order: 0, grow: 2 }))).toEqual({
      id: 'notes',
      title: 'Notes',
      size: 'md',
      home: 'side',
      order: 0,
      grow: 2,
    });
  });
});
