/**
 * The session's decisions: which zone a drop lands in, what a zone is allowed to refuse, and what
 * cancels a drag.
 *
 * jsdom reports every rect as zero, so geometry is stubbed per element — honest here, because the
 * arithmetic over rectangles is trivial and everything interesting is around it: acceptance,
 * nesting, cycles, and what happens when the pointer is over nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAGGING_ATTR, dragSession, DROP_TARGET_ATTR } from './session';
import type { DragPayload, DragZone } from './types';

function payload(entity = 'CollectionBlock', label = 'A post'): DragPayload {
  return { items: [{ ref: { entity, id: 'id-1' }, label }], effect: 'copy' };
}

function box(el: Element, rect: { top: number; bottom: number; left: number; right: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

/** A registered zone over a rectangle, recording what it was told. */
function zoneAt(
  rect: { top: number; bottom: number; left: number; right: number },
  extra: Partial<DragZone> = {},
): { zone: DragZone; drops: DragPayload[]; enters: number; off: () => void } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  box(el, rect);
  const drops: DragPayload[] = [];
  const record = { enters: 0 };
  const zone: DragZone = {
    el,
    onEnter: () => void record.enters++,
    onDrop: ({ payload: p }) => void drops.push(p),
    ...extra,
  };
  const off = dragSession.registerZone(zone);
  return {
    zone,
    drops,
    get enters() {
      return record.enters;
    },
    off,
  };
}

beforeEach(() => {
  dragSession.cancel();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(DRAGGING_ATTR);
  vi.restoreAllMocks();
});

describe('what a drop lands in', () => {
  it('drops into the zone under the pointer', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 } });
    dragSession.drop({ x: 50, y: 50 });

    expect(target.drops).toHaveLength(1);
    expect(target.drops[0].items[0].ref.id).toBe('id-1');
  });

  it('drops into nothing when the pointer is over nothing', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    dragSession.begin({ payload: payload(), pointer: { x: 500, y: 500 } });
    dragSession.drop({ x: 500, y: 500 });

    expect(target.drops).toHaveLength(0);
  });

  it('picks the innermost zone when two overlap', () => {
    // A nested zone sits inside its parent's rectangle, so both contain the pointer.
    const outer = zoneAt({ top: 0, bottom: 400, left: 0, right: 200 });
    const inner = zoneAt({ top: 100, bottom: 200, left: 0, right: 200 });
    outer.zone.el.appendChild(inner.zone.el);

    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 150 } });
    dragSession.drop({ x: 50, y: 150 });

    expect(inner.drops).toHaveLength(1);
    expect(outer.drops).toHaveLength(0);
  });

  it('refuses a zone inside the thing being dragged', () => {
    // Cycle prevention, and it needs no knowledge of anybody's data: nesting is DOM containment.
    const source = document.createElement('div');
    document.body.appendChild(source);
    const inside = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    source.appendChild(inside.zone.el);

    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 }, from: source });
    dragSession.drop({ x: 50, y: 50 });

    expect(inside.drops).toHaveLength(0);
  });
});

describe('what a zone refuses', () => {
  it('asks accepts on every move, so a zone may change its mind mid-drag', () => {
    let open = false;
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 }, { accepts: () => open });

    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 } });
    expect(dragSession.targetZone()).toBeNull();

    open = true;
    dragSession.move({ x: 50, y: 51 });
    expect(dragSession.targetZone()).toBe(target.zone);
  });

  it('lets a zone filter on the entity being carried', () => {
    const posts = zoneAt(
      { top: 0, bottom: 100, left: 0, right: 100 },
      {
        accepts: (p) => p.items.every((i) => i.ref.entity === 'CollectionBlock'),
      },
    );

    dragSession.begin({ payload: payload('Space'), pointer: { x: 50, y: 50 } });
    dragSession.drop({ x: 50, y: 50 });
    expect(posts.drops).toHaveLength(0);

    dragSession.begin({ payload: payload('CollectionBlock'), pointer: { x: 50, y: 50 } });
    dragSession.drop({ x: 50, y: 50 });
    expect(posts.drops).toHaveLength(1);
  });

  it('stops being a candidate once unregistered mid-drag', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 } });
    target.off();
    dragSession.drop({ x: 50, y: 50 });
    expect(target.drops).toHaveLength(0);
  });
});

describe('feedback and flags', () => {
  it('marks the target zone and the document while a drag is in flight', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });

    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 } });
    expect(document.documentElement.hasAttribute(DRAGGING_ATTR)).toBe(true);
    expect(target.zone.el.hasAttribute(DROP_TARGET_ATTR)).toBe(true);

    dragSession.drop({ x: 50, y: 50 });
    expect(document.documentElement.hasAttribute(DRAGGING_ATTR)).toBe(false);
    expect(target.zone.el.hasAttribute(DROP_TARGET_ATTR)).toBe(false);
  });

  it('puts exactly one ghost on the page, and takes it away again', () => {
    dragSession.begin({ payload: payload(), pointer: { x: 10, y: 10 } });
    expect(document.querySelectorAll('[data-we-drag-ghost]')).toHaveLength(1);
    dragSession.cancel();
    expect(document.querySelectorAll('[data-we-drag-ghost]')).toHaveLength(0);
  });

  it('leaves the old zone before entering the new one', () => {
    const left = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    const right = zoneAt({ top: 0, bottom: 100, left: 200, right: 300 });

    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 } });
    dragSession.move({ x: 250, y: 50 });

    expect(left.zone.el.hasAttribute(DROP_TARGET_ATTR)).toBe(false);
    expect(right.zone.el.hasAttribute(DROP_TARGET_ATTR)).toBe(true);
  });
});

describe('cancelling', () => {
  it('drops nothing on Escape', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    dragSession.begin({ payload: payload(), pointer: { x: 50, y: 50 } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(dragSession.active()).toBeNull();
    dragSession.drop({ x: 50, y: 50 });
    expect(target.drops).toHaveLength(0);
  });

  it('replaces a drag rather than stacking a second one', () => {
    dragSession.begin({ payload: payload(), pointer: { x: 10, y: 10 } });
    dragSession.begin({ payload: payload('Space'), pointer: { x: 10, y: 10 } });

    expect(document.querySelectorAll('[data-we-drag-ghost]')).toHaveLength(1);
    expect(dragSession.active()?.items[0].ref.entity).toBe('Space');
  });
});

describe('the keyboard path', () => {
  it('produces the same drop as a pointer, so a zone cannot tell them apart', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });

    dragSession.beginKeyboard(payload());
    expect(target.zone.el.hasAttribute(DROP_TARGET_ATTR)).toBe(true);
    dragSession.dropKeyboard();

    expect(target.drops).toHaveLength(1);
  });

  it('cycles only through zones that accept', () => {
    const yes = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    zoneAt({ top: 0, bottom: 100, left: 200, right: 300 }, { accepts: () => false });

    dragSession.beginKeyboard(payload());
    dragSession.cycleKeyboard(1);
    dragSession.dropKeyboard();

    expect(yes.drops).toHaveLength(1);
  });

  it('cancels on Escape, writing nothing', () => {
    const target = zoneAt({ top: 0, bottom: 100, left: 0, right: 100 });
    dragSession.beginKeyboard(payload());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    dragSession.dropKeyboard();

    expect(target.drops).toHaveLength(0);
    expect(dragSession.keyboardActive()).toBe(false);
  });
});

describe('claiming a press', () => {
  it('lets one mechanism tell another the gesture is taken', () => {
    const press = new PointerEvent('pointerdown');
    expect(dragSession.isClaimed(press)).toBe(false);
    dragSession.claimPress(press);
    expect(dragSession.isClaimed(press)).toBe(true);
  });
});
