/**
 * When a press becomes a drag — and, for a finger, when it deliberately does not.
 *
 * The touch cases are the ones worth having: a list that reads a scroll as a drag cannot be
 * scrolled, and that is not a bug anybody notices on a desktop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { watchPointerDrag } from './pointerDrag';

function press(el: Element, init: Partial<PointerEventInit> & { pointerType?: string } = {}) {
  const e = new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, ...init });
  el.dispatchEvent(e);
  return e;
}

function move(el: Element, x: number, y: number, pointerType = 'mouse') {
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, pointerType }));
}

function watch(el: Element, down: PointerEvent) {
  const events: string[] = [];
  watchPointerDrag(down, {
    capture: el,
    onStart: () => events.push('start'),
    onMove: () => events.push('move'),
    onEnd: () => events.push('end'),
    onCancel: () => events.push('cancel'),
  });
  return events;
}

let el: HTMLElement;

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  el = document.createElement('div');
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  document.body.appendChild(el);
});

describe('a mouse', () => {
  it('does not drag on a press that barely drifts', () => {
    const events = watch(el, press(el, { pointerType: 'mouse' }));
    move(el, 2, 2);
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    expect(events).toEqual([]);
  });

  it('drags once it moves past the threshold', () => {
    const events = watch(el, press(el, { pointerType: 'mouse' }));
    move(el, 20, 20);
    move(el, 40, 40);
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    expect(events).toEqual(['start', 'move', 'move', 'end']);
  });

  it('ignores a second pointer', () => {
    const events = watch(el, press(el, { pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 90, clientY: 90 }));
    expect(events).toEqual([]);
  });
});

describe('a finger', () => {
  it('does not drag on movement — that is a scroll', () => {
    vi.useFakeTimers();
    const events = watch(el, press(el, { pointerType: 'touch' }));
    move(el, 0, 60, 'touch');
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([]);
  });

  it('drags after a long press that stays still', () => {
    vi.useFakeTimers();
    const events = watch(el, press(el, { pointerType: 'touch' }));
    vi.advanceTimersByTime(400);
    move(el, 0, 60, 'touch');
    expect(events).toEqual(['start', 'move']);
  });
});

describe('abandoning', () => {
  it('cancels a running drag when the caller lets go of the watch', () => {
    const events: string[] = [];
    const stop = watchPointerDrag(press(el, { pointerType: 'mouse' }), {
      capture: el,
      onStart: () => events.push('start'),
      onMove: () => events.push('move'),
      onEnd: () => events.push('end'),
      onCancel: () => events.push('cancel'),
    });
    move(el, 40, 40);
    stop();
    expect(events).toEqual(['start', 'move', 'cancel']);
  });

  it('reports a cancelled pointer', () => {
    const events = watch(el, press(el, { pointerType: 'mouse' }));
    move(el, 40, 40);
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    expect(events).toEqual(['start', 'move', 'cancel']);
  });
});
