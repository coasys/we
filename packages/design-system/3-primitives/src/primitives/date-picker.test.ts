/**
 * Clearing a date.
 *
 * The picker could set a value and never take it back, so any optional date field was a one-way
 * door: choose once by accident and the only way out was to delete the record around it.
 */
import './date-picker';

import { describe, expect, it } from 'vitest';

type PickerEl = HTMLElement & { value: string; updateComplete: Promise<unknown> };

async function makePicker(value = ''): Promise<PickerEl> {
  const el = document.createElement('we-date-picker') as PickerEl;
  el.value = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const clearButton = (el: PickerEl) => el.shadowRoot?.querySelector('[part="clear"]') as HTMLElement | null;

describe('clearing', () => {
  it('offers nothing to clear when there is no date', async () => {
    expect(clearButton(await makePicker())).toBeNull();
  });

  it('offers a clear once a date is set', async () => {
    expect(clearButton(await makePicker('2026-08-19'))).toBeTruthy();
  });

  it('empties the value and says so, in the same event every other path uses', async () => {
    const el = await makePicker('2026-08-19');
    const changes: string[] = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent).detail));

    clearButton(el)?.click();
    await el.updateComplete;

    expect(el.value).toBe('');
    expect(changes).toEqual(['']);
  });

  it('does not open the calendar on the way out', async () => {
    // The wrapper toggles the calendar on click, so clearing has to stop the click reaching it —
    // otherwise dismissing a value leaves you in a date grid you did not ask for.
    const el = await makePicker('2026-08-19');
    clearButton(el)?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[part="calendar"]')).toBeNull();
  });
});
