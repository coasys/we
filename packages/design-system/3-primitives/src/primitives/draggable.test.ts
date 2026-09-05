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
  noArm: boolean;
  noSelf: boolean;
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

/**
 * Zones inside zones — the ordinary case, not an edge one.
 *
 * A folder inside the Pocket's panel, a card inside a board. The reported failure: dropping onto a
 * folder wrote the item into the folder *and* into the folder being looked at, because `dropped`
 * bubbled from the inner zone to the outer one, whose handler is an ordinary listener on its own
 * element. One drop, two records, in two places.
 */
describe('a zone inside a zone', () => {
  /** An outer zone with an inner one occupying its top-left quarter. */
  async function nested() {
    const outer = document.createElement('we-drop-zone') as DropZoneEl;
    const inner = document.createElement('we-drop-zone') as DropZoneEl;
    outer.appendChild(inner);
    document.body.appendChild(outer);
    await outer.updateComplete;
    await inner.updateComplete;
    stubRect(outer, { top: 0, bottom: 200, left: 0, right: 200 });
    stubRect(inner, { top: 0, bottom: 100, left: 0, right: 100 });

    const outerDrops: CustomEvent[] = [];
    const innerDrops: CustomEvent[] = [];
    outer.addEventListener('dropped', (e) => outerDrops.push(e as CustomEvent));
    inner.addEventListener('dropped', (e) => innerDrops.push(e as CustomEvent));
    return { outer, inner, outerDrops, innerDrops };
  }

  it('lands in the innermost one only', async () => {
    const { el, card } = await makeSource();
    const { outerDrops, innerDrops } = await nested();

    drag(el, card, { x: 50, y: 50 });

    expect(innerDrops).toHaveLength(1);
    // The bug. The session picks one zone; an ancestor hearing about it undoes that decision.
    expect(outerDrops).toHaveLength(0);
  });

  it('lands in the outer one when the pointer is outside the inner', async () => {
    const { el, card } = await makeSource();
    const { outerDrops, innerDrops } = await nested();

    drag(el, card, { x: 150, y: 150 });

    expect(outerDrops).toHaveLength(1);
    expect(innerDrops).toHaveLength(0);
  });

  it('marks only the innermost as the target, so the feedback matches where it will land', async () => {
    const { el, card } = await makeSource();
    const { outer, inner } = await nested();
    const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };

    card.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 500, clientY: 500 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 50, clientY: 50 }));

    expect(inner.hasAttribute('data-we-drop-target')).toBe(true);
    expect(outer.hasAttribute('data-we-drop-target')).toBe(false);

    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 50, clientY: 50 }));
  });
});

describe('staying quiet on pickup', () => {
  it('never arms a zone that asked not to', async () => {
    // A panel three folders deep armed nine nested rectangles the moment a card was touched. The
    // container says "things go here"; the rows inside it wait to be hovered.
    const { el, card } = await makeSource();
    const { el: zone } = await makeZone();
    zone.noArm = true;
    await zone.updateComplete;
    const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };

    card.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 500, clientY: 500 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 540, clientY: 540 }));
    expect(zone.hasAttribute('data-we-drop-armed')).toBe(false);

    // …and still takes the drop, and still says so while the pointer is over it.
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 100, clientY: 100 }));
    expect(zone.hasAttribute('data-we-drop-target')).toBe(true);
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 100, clientY: 100 }));
  });
});

/**
 * A container that will not take back what it already holds.
 *
 * Picking up a row inside the Pocket armed the whole panel as though the row were being gathered
 * in — and a release would have written nothing, since the reference is already stored. The rule is
 * containment, so one flag on the panel covers the folders and crumbs nested inside it too.
 */
describe('a zone that refuses its own', () => {
  async function pocketLike() {
    const panel = document.createElement('we-drop-zone') as DropZoneEl;
    const folder = document.createElement('we-drop-zone') as DropZoneEl;
    panel.noSelf = true;
    panel.appendChild(folder);
    document.body.appendChild(panel);
    await panel.updateComplete;
    await folder.updateComplete;
    stubRect(panel, { top: 0, bottom: 300, left: 0, right: 300 });
    stubRect(folder, { top: 0, bottom: 60, left: 0, right: 300 });
    return { panel, folder };
  }

  it('refuses a drag that began inside it', async () => {
    const { panel, folder } = await pocketLike();
    // The source lives in the panel, as a Pocket row does.
    const { el, card } = await makeSource();
    panel.appendChild(el);

    const drops: CustomEvent[] = [];
    panel.addEventListener('dropped', (e) => drops.push(e as CustomEvent));
    folder.addEventListener('dropped', (e) => drops.push(e as CustomEvent));

    // Over the panel's own body, clear of the folder.
    drag(el, card, { x: 150, y: 200 });

    expect(drops).toHaveLength(0);
    expect(panel.hasAttribute('data-we-drop-target')).toBe(false);
  });

  it('does not refuse on behalf of a zone nested inside it', async () => {
    // The flag was transitive at first, which silenced the Pocket's folders and crumbs along with
    // the panel. A sub-zone is a different destination: dropping a row on a folder is a re-file,
    // and the panel refusing for it would make that unreachable.
    const { panel, folder } = await pocketLike();
    const { el, card } = await makeSource();
    panel.appendChild(el);

    const folderDrops: CustomEvent[] = [];
    folder.addEventListener('dropped', (e) => folderDrops.push(e as CustomEvent));

    drag(el, card, { x: 150, y: 30 });

    expect(folderDrops).toHaveLength(1);
  });

  it('stops arming itself once it has refused', async () => {
    // Arming asked this element's own `accepts`, which cannot see the session's rules — so a panel
    // that had just refused a drag still drew a ring advertising itself as a target.
    const { panel } = await pocketLike();
    const { el, card } = await makeSource();
    panel.appendChild(el);
    const base = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: 'mouse' };

    card.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 500, clientY: 500 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 540, clientY: 540 }));

    expect(panel.hasAttribute('data-we-drop-armed')).toBe(false);
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 540, clientY: 540 }));
  });

  it('carries the source handle a move needs, and nothing when there is none', async () => {
    const { el, card } = await makeSource();
    const { dropped } = await makeZone();
    (el as DraggableEl & { origin?: unknown }).origin = { id: 'PocketItem-3', folder: 'PocketFolder-1' };
    await el.updateComplete;

    drag(el, card, { x: 100, y: 100 });

    expect(dropped[0].detail.items[0].origin).toEqual({ id: 'PocketItem-3', folder: 'PocketFolder-1' });
  });

  it('still takes a drag from anywhere else', async () => {
    const { panel } = await pocketLike();
    const { el, card } = await makeSource();

    const drops: CustomEvent[] = [];
    panel.addEventListener('dropped', (e) => drops.push(e as CustomEvent));

    drag(el, card, { x: 150, y: 200 });

    expect(drops).toHaveLength(1);
  });

  it('leaves an ordinary zone taking its own back, which is what a reorder is', async () => {
    const { el, card } = await makeSource();
    const { el: zone, dropped } = await makeZone();
    zone.appendChild(el);

    drag(el, card, { x: 100, y: 100 });

    expect(dropped).toHaveLength(1);
  });
});
