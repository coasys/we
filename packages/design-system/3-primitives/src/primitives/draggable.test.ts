/**
 * The pair a template reaches the drag session through.
 *
 * What is under test is the contract at the boundary: what a press starts, what a zone refuses,
 * what event a drop produces, and that the keyboard produces the same one. The session's own
 * arithmetic is tested in `@we/drag`.
 */
import './draggable';
import './drop-zone';

import { dragSession } from '@we/drag';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface DraggableEl extends HTMLElement {
  entity: string;
  recordId: string;
  label: string;
  disabled: boolean;
  updateComplete: Promise<unknown>;
}

interface DropZoneEl extends HTMLElement {
  accepts: string;
  disabled: boolean;
  updateComplete: Promise<unknown>;
}

function stubRect(el: Element, box: { top: number; bottom: number; left: number; right: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect);
}

async function makeSource(options: { entity?: string; id?: string; label?: string } = {}) {
  const el = document.createElement('we-draggable') as DraggableEl;
  el.entity = options.entity ?? 'CollectionBlock';
  el.recordId = options.id ?? 'post-1';
  el.label = options.label ?? 'A post';
  const card = document.createElement('div');
  card.setAttribute('data-we-id', el.recordId);
  el.appendChild(card);
  document.body.appendChild(el);
  await el.updateComplete;
  el.setPointerCapture = () => {};
  return { el, card };
}

async function makeZone(accepts = '') {
  const el = document.createElement('we-drop-zone') as DropZoneEl;
  el.accepts = accepts;
  document.body.appendChild(el);
  await el.updateComplete;
  stubRect(el, { top: 0, bottom: 200, left: 0, right: 200 });
  const dropped: CustomEvent[] = [];
  el.addEventListener('dropped', (e) => dropped.push(e as CustomEvent));
  return { el, dropped };
}

/** A whole pointer drag from a source to a point. */
function drag(source: DraggableEl, from: Element, to: { x: number; y: number }) {
  const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };
  from.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 500, clientY: 500 }));
  source.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 520, clientY: 520 }));
  source.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: to.x, clientY: to.y }));
  source.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: to.x, clientY: to.y }));
}

beforeEach(() => {
  dragSession.cancel();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('picking something up', () => {
  it('drops a reference into the zone under the pointer', async () => {
    const { el, card } = await makeSource();
    const { dropped } = await makeZone();

    drag(el, card, { x: 100, y: 100 });

    expect(dropped).toHaveLength(1);
    expect(dropped[0].detail.items[0].ref).toEqual({ entity: 'CollectionBlock', id: 'post-1' });
    expect(dropped[0].detail.items[0].label).toBe('A post');
  });

  it('leaves the dataset for the receiver to stamp', async () => {
    // A card fragment cannot name its own dataset without reading a store, and portable fragments
    // name no store. The receiver knows which dataset was current when the drop happened.
    const { el, card } = await makeSource();
    const { dropped } = await makeZone();
    drag(el, card, { x: 100, y: 100 });
    expect(dropped[0].detail.items[0].ref.dataset).toBeUndefined();
  });

  it('does not start on a press that barely drifts', async () => {
    const { el, card } = await makeSource();
    const { dropped } = await makeZone();
    const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };
    card.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 100, clientY: 100 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 102, clientY: 100 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 102, clientY: 100 }));
    expect(dropped).toHaveLength(0);
  });

  it('refuses a press that begins in a control', async () => {
    // Otherwise a card holding a button cannot be clicked without a steady hand.
    const { el, card } = await makeSource();
    const { dropped } = await makeZone();
    const button = document.createElement('button');
    card.appendChild(button);

    drag(el, button, { x: 100, y: 100 });
    expect(dropped).toHaveLength(0);
  });

  it('carries nothing without both halves of the reference', async () => {
    const { el, card } = await makeSource({ id: '' });
    const { dropped } = await makeZone();
    drag(el, card, { x: 100, y: 100 });
    expect(dropped).toHaveLength(0);
  });
});

describe('what a zone takes', () => {
  it('refuses an entity it does not list', async () => {
    const { el, card } = await makeSource({ entity: 'Space' });
    const { dropped } = await makeZone('CollectionBlock,TextBlock');
    drag(el, card, { x: 100, y: 100 });
    expect(dropped).toHaveLength(0);
  });

  it('takes anything when it lists nothing', async () => {
    const { el, card } = await makeSource({ entity: 'Space' });
    const { dropped } = await makeZone();
    drag(el, card, { x: 100, y: 100 });
    expect(dropped).toHaveLength(1);
  });

  it('refuses everything while disabled', async () => {
    const { el, card } = await makeSource();
    const { el: zone, dropped } = await makeZone();
    zone.disabled = true;
    await zone.updateComplete;
    drag(el, card, { x: 100, y: 100 });
    expect(dropped).toHaveLength(0);
  });

  it('arms itself while an acceptable drag is running, and disarms after', async () => {
    const { el, card } = await makeSource();
    const { el: zone } = await makeZone('CollectionBlock');
    const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };

    card.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 500, clientY: 500 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 540, clientY: 540 }));
    expect(zone.hasAttribute('data-we-drop-armed')).toBe(true);

    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 540, clientY: 540 }));
    expect(zone.hasAttribute('data-we-drop-armed')).toBe(false);
  });

  it('stays quiet for a drag it would refuse', async () => {
    const { el, card } = await makeSource({ entity: 'Space' });
    const { el: zone } = await makeZone('CollectionBlock');
    const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };

    card.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 500, clientY: 500 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 540, clientY: 540 }));
    expect(zone.hasAttribute('data-we-drop-armed')).toBe(false);
  });
});

describe('the keyboard path', () => {
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }));

  it('produces the same event as a drag, so a zone cannot tell them apart', async () => {
    const { card } = await makeSource();
    const { dropped } = await makeZone();

    key(card, ' ');
    key(card, ' ');

    expect(dropped).toHaveLength(1);
    expect(dropped[0].detail.items[0].ref.id).toBe('post-1');
  });

  it('makes the card focusable, so there is something to pick up from', async () => {
    const { card } = await makeSource();
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('never reads a space typed into a field as a pickup', async () => {
    const { card } = await makeSource();
    const { dropped } = await makeZone();
    const input = document.createElement('input');
    card.appendChild(input);

    key(input, ' ');
    key(input, ' ');

    expect(dropped).toHaveLength(0);
  });

  it('cancels on Escape, writing nothing', async () => {
    const { card } = await makeSource();
    const { dropped } = await makeZone();

    key(card, ' ');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    key(card, ' ');
    // The trailing Space picks up again rather than dropping the abandoned hold.
    expect(dropped).toHaveLength(0);
  });
});
