/**
 * `we-sortable`'s move contract — across zones, into nests, and from the keyboard.
 *
 * Driven through the element's own handlers rather than a real browser, for the same reason
 * `we-select`'s tests are: what is under test is the decision — which zone a drop lands in, what
 * index, whether it is a move at all — and jsdom gives that faithfully. The parts a browser would
 * add (that the ghost follows the pointer, that the indicator is where the eye expects) are not
 * decisions and would only make the suite slower.
 *
 * jsdom reports every rect as zero, so geometry is stubbed per element. That is honest for these
 * tests: the arithmetic over rectangles is simple and the interesting behaviour is everything
 * around it — acceptance, nesting, cycles, and what counts as a no-op.
 */
import './sortable';

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface SortableEl extends HTMLElement {
  zone: string;
  group: string;
  locked: boolean;
  direction: 'vertical' | 'horizontal';
  updateComplete: Promise<unknown>;
}

/** A zone with `count` items, laid out as a vertical stack at a given y offset. */
async function makeZone(options: {
  zone: string;
  group?: string;
  items: string[];
  top?: number;
  locked?: boolean;
}): Promise<SortableEl> {
  const el = document.createElement('we-sortable') as SortableEl;
  el.zone = options.zone;
  if (options.group) el.group = options.group;
  if (options.locked) el.locked = true;

  for (const id of options.items) {
    const item = document.createElement('div');
    item.setAttribute('data-we-id', id);
    el.appendChild(item);
  }
  document.body.appendChild(el);
  await el.updateComplete;

  // Geometry: the zone spans 100px per item from `top`, each item 100px tall.
  const top = options.top ?? 0;
  const height = Math.max(options.items.length, 1) * 100;
  stubRect(el, { top, bottom: top + height, left: 0, right: 200 });
  el.querySelectorAll('[data-we-id]').forEach((item, index) => {
    stubRect(item as HTMLElement, {
      top: top + index * 100,
      bottom: top + index * 100 + 100,
      left: 0,
      right: 200,
    });
  });
  return el;
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

const itemsOf = (el: SortableEl) => [...el.querySelectorAll('[data-we-id]')] as HTMLElement[];

/** Drive a full pointer drag from an item to a point, and return the `moved` detail if any. */
function drag(origin: SortableEl, item: HTMLElement, to: { x: number; y: number }) {
  const moves: CustomEvent[] = [];
  const reorders: CustomEvent[] = [];
  origin.addEventListener('moved', (e) => moves.push(e as CustomEvent));
  origin.addEventListener('reorder', (e) => reorders.push(e as CustomEvent));

  origin.setPointerCapture = () => {};
  const base = { bubbles: true, composed: true, button: 0, pointerId: 1 };
  item.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 10, clientY: 10 }));
  // Past the 4px threshold, then to the destination.
  origin.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 20, clientY: 20 }));
  origin.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: to.x, clientY: to.y }));
  origin.dispatchEvent(new PointerEvent('pointerup', { ...base }));

  return { move: moves[0]?.detail, reorder: reorders[0]?.detail, moves, reorders };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('moving within one zone', () => {
  it('reports the new order, and fires the single-list event too', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b', 'c'] });
    // Drop the first item past the centre of the third.
    const { move, reorder } = drag(zone, itemsOf(zone)[0], { x: 100, y: 260 });

    expect(move.id).toBe('a');
    expect(move.from).toBe('todo');
    expect(move.to).toBe('todo');
    expect(move.ids).toEqual(['b', 'c', 'a']);
    expect(reorder).toEqual(['b', 'c', 'a']);
  });

  it('treats a drop back in place as no move at all', async () => {
    // A click that drifts a few pixels would otherwise write to the backend.
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b', 'c'] });
    const { moves, reorders } = drag(zone, itemsOf(zone)[0], { x: 100, y: 20 });
    expect(moves).toHaveLength(0);
    expect(reorders).toHaveLength(0);
  });
});

describe('moving between zones', () => {
  it('carries the item across when the groups match', async () => {
    const todo = await makeZone({ zone: 'todo', group: 'board', items: ['a', 'b'], top: 0 });
    await makeZone({ zone: 'done', group: 'board', items: ['c'], top: 500 });

    const { move, reorders } = drag(todo, itemsOf(todo)[0], { x: 100, y: 520 });

    expect(move.from).toBe('todo');
    expect(move.to).toBe('done');
    expect(move.id).toBe('a');
    expect(move.ids).toEqual(['a', 'c']);
    // Not a reorder — that event is the single-list specialisation.
    expect(reorders).toHaveLength(0);
  });

  it('refuses a zone in another group', async () => {
    const todo = await makeZone({ zone: 'todo', group: 'board', items: ['a', 'b'], top: 0 });
    await makeZone({ zone: 'elsewhere', group: 'other', items: ['c'], top: 500 });

    const { move } = drag(todo, itemsOf(todo)[0], { x: 100, y: 520 });
    // Falls back to the origin rather than dropping into an unrelated list.
    expect(move?.to ?? 'todo').toBe('todo');
  });

  it('refuses a locked zone while still letting its own items out', async () => {
    const todo = await makeZone({ zone: 'todo', group: 'board', items: ['a'], top: 0 });
    const locked = await makeZone({ zone: 'locked', group: 'board', items: ['c'], top: 500, locked: true });

    expect(drag(todo, itemsOf(todo)[0], { x: 100, y: 520 }).move?.to ?? 'todo').toBe('todo');

    const out = drag(locked, itemsOf(locked)[0], { x: 100, y: 20 });
    expect(out.move.to).toBe('todo');
  });

  it('does not exchange items between two zones with no group', async () => {
    // An empty group is a closed list — otherwise an unrelated sortable elsewhere on the page
    // silently becomes a drop target.
    const one = await makeZone({ zone: 'one', items: ['a'], top: 0 });
    await makeZone({ zone: 'two', items: ['b'], top: 500 });

    const { move } = drag(one, itemsOf(one)[0], { x: 100, y: 520 });
    expect(move?.to ?? 'one').toBe('one');
  });
});

describe('nesting', () => {
  it('drops into the innermost zone under the pointer', async () => {
    const outer = await makeZone({ zone: 'outer', group: 'nest', items: ['a'], top: 0 });
    const inner = await makeZone({ zone: 'inner', group: 'nest', items: ['b'], top: 0 });
    // The nested zone lives inside an item of the outer one, and overlaps it exactly.
    itemsOf(outer)[0].appendChild(inner);
    stubRect(outer, { top: 0, bottom: 400, left: 0, right: 200 });
    stubRect(inner, { top: 100, bottom: 200, left: 0, right: 200 });

    const loose = await makeZone({ zone: 'loose', group: 'nest', items: ['c'], top: 600 });
    const { move } = drag(loose, itemsOf(loose)[0], { x: 100, y: 150 });

    expect(move.to).toBe('inner');
  });

  it('refuses to drop a container into its own descendant', async () => {
    // The whole of cycle prevention, and it needs no knowledge of the consumer's data: nesting is
    // DOM containment, so "is the target inside the thing I am dragging" is a DOM question.
    const outer = await makeZone({ zone: 'outer', group: 'nest', items: ['a'], top: 0 });
    const inner = await makeZone({ zone: 'inner', group: 'nest', items: ['b'], top: 0 });
    itemsOf(outer)[0].appendChild(inner);
    stubRect(outer, { top: 0, bottom: 400, left: 0, right: 200 });
    stubRect(inner, { top: 100, bottom: 200, left: 0, right: 200 });

    // Drag the outer item — which contains `inner` — over `inner`.
    const { move } = drag(outer, itemsOf(outer)[0], { x: 100, y: 150 });
    expect(move?.to ?? 'outer').toBe('outer');
  });
});

describe('keyboard', () => {
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }));

  it('picks up, moves along the list, and drops', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b', 'c'] });
    const moved: CustomEvent[] = [];
    zone.addEventListener('moved', (e) => moved.push(e as CustomEvent));

    const first = itemsOf(zone)[0];
    key(first, ' ');
    key(first, 'ArrowDown');
    key(first, 'ArrowDown');
    key(first, ' ');

    expect(moved[0].detail.ids).toEqual(['b', 'c', 'a']);
  });

  it('cancels on Escape, writing nothing', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b'] });
    const moved: CustomEvent[] = [];
    zone.addEventListener('moved', (e) => moved.push(e as CustomEvent));

    const first = itemsOf(zone)[0];
    key(first, ' ');
    key(first, 'ArrowDown');
    key(first, 'Escape');
    key(first, ' ');

    // The trailing Space picks up again rather than dropping the abandoned hold.
    expect(moved).toHaveLength(0);
  });

  it('moves across zones with the cross-axis arrows', async () => {
    const todo = await makeZone({ zone: 'todo', group: 'board', items: ['a'], top: 0 });
    await makeZone({ zone: 'done', group: 'board', items: ['c'], top: 500 });
    const moved: CustomEvent[] = [];
    todo.addEventListener('moved', (e) => moved.push(e as CustomEvent));

    const first = itemsOf(todo)[0];
    key(first, ' ');
    key(first, 'ArrowRight');
    key(first, ' ');

    expect(moved[0].detail.to).toBe('done');
  });

  it('produces the same event as a drag, so a consumer cannot tell them apart', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b'] });
    const moved: CustomEvent[] = [];
    zone.addEventListener('moved', (e) => moved.push(e as CustomEvent));

    const first = itemsOf(zone)[0];
    key(first, ' ');
    key(first, 'ArrowDown');
    key(first, ' ');

    expect(Object.keys(moved[0].detail).sort()).toEqual(['from', 'id', 'ids', 'index', 'to']);
  });

  it('makes items focusable, so there is something to pick up from', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b'] });
    expect(itemsOf(zone).every((item) => item.getAttribute('tabindex') === '0')).toBe(true);
  });
});

describe('drag feedback inside a modal', () => {
  /*
    The ghost and the drop line are appended to document.body and stacked with a z-index, which no
    modal can be beaten with: `we-modal` promotes itself into the browser's top layer via
    `popover="manual"`, and the top layer is above every z-index there is. Dragging inside a dialog
    therefore showed neither, which read as "reordering gives no feedback".

    jsdom has no Popover API, so the stub below is what makes the promotion path reachable at all —
    which is also the fallback being asserted in the last case.
  */
  const withPopoverSupport = (fn: () => void) => {
    // `lib.dom` declares showPopover whether or not the runtime has it, so this is a plain property
    // write and removal rather than anything typed — hence Reflect over `delete`.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const shown: HTMLElement[] = [];
    proto.showPopover = function showPopover(this: HTMLElement) {
      shown.push(this);
    };
    try {
      fn();
    } finally {
      Reflect.deleteProperty(proto, 'showPopover');
    }
    return shown;
  };

  it('promotes both the ghost and the drop line to the top layer', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b', 'c'] });
    const shown = withPopoverSupport(() => drag(zone, itemsOf(zone)[0], { x: 100, y: 260 }));

    expect(shown).toHaveLength(2);
    for (const el of shown) expect(el.getAttribute('popover')).toBe('manual');
  });

  it('still drags where the Popover API is missing', async () => {
    const zone = await makeZone({ zone: 'todo', items: ['a', 'b', 'c'] });
    const { reorder } = drag(zone, itemsOf(zone)[0], { x: 100, y: 260 });
    expect(reorder).toEqual(['b', 'c', 'a']);
  });
});

describe('items containing form controls', () => {
  /*
    Both cases here are what made a form row unusable inside a sortable: a drag begun in a text
    field, and — the worse one — a space typed into a field being read as "pick this up", which
    stopped the field accepting spaces at all.
  */
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }));

  /** A zone whose items each hold a text input, and optionally a declared drag handle. */
  async function makeFormZone(withHandle: boolean): Promise<{ zone: SortableEl; inputs: HTMLInputElement[] }> {
    const zone = await makeZone({ zone: 'rows', items: ['a', 'b', 'c'] });
    const inputs: HTMLInputElement[] = [];
    itemsOf(zone).forEach((item) => {
      if (withHandle) {
        const handle = document.createElement('button');
        handle.setAttribute('data-we-handle', '');
        item.appendChild(handle);
      }
      const input = document.createElement('input');
      item.appendChild(input);
      inputs.push(input);
    });
    return { zone, inputs };
  }

  it('drags from anywhere when the item declares no handle', async () => {
    const { zone } = await makeFormZone(false);
    const { reorder } = drag(zone, itemsOf(zone)[0], { x: 100, y: 260 });
    expect(reorder).toEqual(['b', 'c', 'a']);
  });

  it('refuses a drag begun in a text field once a handle is declared', async () => {
    const { zone, inputs } = await makeFormZone(true);
    // The press starts on the input rather than the handle: this is text selection, not a drag.
    const { moves } = drag(zone, inputs[0], { x: 100, y: 260 });
    expect(moves).toHaveLength(0);
  });

  it('still drags when the press begins on the handle', async () => {
    const { zone } = await makeFormZone(true);
    const handle = itemsOf(zone)[0].querySelector('[data-we-handle]') as HTMLElement;
    const { reorder } = drag(zone, handle, { x: 100, y: 260 });
    expect(reorder).toEqual(['b', 'c', 'a']);
  });

  it('never reads a space typed into a field as a pickup', async () => {
    const { zone, inputs } = await makeFormZone(false);
    const moved: CustomEvent[] = [];
    zone.addEventListener('moved', (e) => moved.push(e as CustomEvent));

    key(inputs[0], ' ');
    key(inputs[0], 'ArrowDown');
    key(inputs[0], ' ');

    expect(moved).toHaveLength(0);
  });

  it('keeps the keyboard path open through the handle', async () => {
    const { zone } = await makeFormZone(true);
    const moved: CustomEvent[] = [];
    zone.addEventListener('moved', (e) => moved.push(e as CustomEvent));
    const handle = itemsOf(zone)[0].querySelector('[data-we-handle]') as HTMLElement;

    key(handle, ' ');
    key(handle, 'ArrowDown');
    key(handle, ' ');

    expect(moved[0].detail.ids).toEqual(['b', 'a', 'c']);
  });
});
