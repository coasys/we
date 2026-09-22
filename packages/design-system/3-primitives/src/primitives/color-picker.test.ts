/**
 * What the picker says while a colour is being chosen, and what it says once one has been.
 *
 * It said one thing: `change`, on every `pointermove` of a drag. Consumers store what `change`
 * carries, so dragging the saturation area wrote a value tens of times a second — and where the
 * thing being recoloured is rendered *from that data*, the write handed back a new row, the list
 * rebuilt it, and the picker was unmounted under the pointer using it. From the outside the popup
 * "closed as soon as you dragged"; what closed it was its own consumer.
 *
 * So the events are asserted by count, not only by their last value: the defect was never a wrong
 * colour, it was the number of times a correct one was announced.
 */
import './color-picker';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type PickerEl = HTMLElement & { value: string; updateComplete: Promise<unknown> };

/** jsdom implements neither pointer capture nor layout; the element needs both to track a drag. */
function stubPointerTracking(el: HTMLElement) {
  const area = el.shadowRoot?.querySelector<HTMLElement>('[part="area"]');
  const slider = el.shadowRoot?.querySelector<HTMLElement>('[part="slider"]');
  for (const box of [area, slider]) {
    if (!box) continue;
    box.setPointerCapture = vi.fn();
    box.releasePointerCapture = vi.fn();
    box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  }
  return { area, slider };
}

const press = (el: HTMLElement, type: string, x: number, y: number) =>
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, composed: true }));

async function makePicker(): Promise<{ el: PickerEl; changes: string[]; previews: string[] }> {
  const el = document.createElement('we-color-picker') as PickerEl;
  el.value = '#336699';
  document.body.appendChild(el);
  await el.updateComplete;

  const changes: string[] = [];
  const previews: string[] = [];
  el.addEventListener('change', (e) => changes.push((e as CustomEvent<string>).detail));
  el.addEventListener('preview', (e) => previews.push((e as CustomEvent<string>).detail));

  // Open the popover, which is where the area and the sliders live.
  el.shadowRoot?.querySelector<HTMLElement>('[part="preview"]')?.click();
  await el.updateComplete;
  return { el, changes, previews };
}

describe('a drag across the colour area', () => {
  let harness: Awaited<ReturnType<typeof makePicker>>;

  beforeEach(async () => {
    harness = await makePicker();
  });

  it('previews while the pointer moves and decides once on release', async () => {
    const { area } = stubPointerTracking(harness.el);
    expect(area).toBeTruthy();

    press(area!, 'pointerdown', 10, 10);
    press(area!, 'pointermove', 40, 40);
    press(area!, 'pointermove', 70, 70);
    expect(harness.changes).toHaveLength(0);
    expect(harness.previews.length).toBeGreaterThanOrEqual(3);

    press(area!, 'pointerup', 70, 70);
    expect(harness.changes).toHaveLength(1);
    // The decision is the colour the drag ended on, not a fresh reading of anything.
    expect(harness.changes[0]).toBe(harness.previews[harness.previews.length - 1]);
  });

  it('keeps the popover open throughout, since nothing outside it was pressed', async () => {
    const { area } = stubPointerTracking(harness.el);
    press(area!, 'pointerdown', 10, 10);
    press(area!, 'pointermove', 60, 20);
    press(area!, 'pointerup', 60, 20);
    await harness.el.updateComplete;
    expect(harness.el.shadowRoot?.querySelector('[part="popover"]')).toBeTruthy();
  });
});

describe('the other ways a colour is chosen', () => {
  it('treats a swatch click as a decision', async () => {
    const { el, changes, previews } = await makePicker();
    el.shadowRoot?.querySelector<HTMLElement>('[part~="swatch"]')?.click();
    expect(changes).toHaveLength(1);
    expect(previews).toHaveLength(0);
  });

  it('previews typed text and commits it when the field is left', async () => {
    const { el, changes, previews } = await makePicker();
    const field = el.shadowRoot?.querySelector<HTMLInputElement>('[part="fields"] input');
    expect(field).toBeTruthy();

    field!.value = '#ff0000';
    field!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(previews).toHaveLength(1);

    field!.dispatchEvent(new Event('blur'));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.toLowerCase()).toContain('ff0000');
  });

  it('says nothing on blur when the text was never touched', async () => {
    const { el, changes } = await makePicker();
    const field = el.shadowRoot?.querySelector<HTMLInputElement>('[part="fields"] input');
    field!.dispatchEvent(new Event('blur'));
    expect(changes).toHaveLength(0);
  });
});
