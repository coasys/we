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

describe('asking for a time as well', () => {
  /*
    A calendar day and an instant are different facts. Without this the picker captured the day and
    silently dropped the rest, so a shift start or a session time could not be expressed at all.
  */
  type TimedEl = PickerEl & { showTime: boolean };

  async function makeTimed(value = ''): Promise<TimedEl> {
    const el = document.createElement('we-date-picker') as TimedEl;
    el.showTime = true;
    el.value = value;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const open = async (el: TimedEl) => {
    (el.shadowRoot?.querySelector('[part="input-wrapper"]') as HTMLElement).click();
    await el.updateComplete;
  };
  const timeField = (el: TimedEl) => el.shadowRoot?.querySelector('input[part="time"]') as HTMLInputElement | null;
  const firstDay = (el: TimedEl) =>
    [...el.shadowRoot!.querySelectorAll('[part="day"]')].find((d) => !d.hasAttribute('data-other-month')) as HTMLElement;

  it('offers no time field unless asked', async () => {
    const el = (await makePicker()) as TimedEl;
    await open(el);
    expect(timeField(el)).toBeNull();
  });

  it('offers one when asked', async () => {
    const el = await makeTimed();
    await open(el);
    expect(timeField(el)).toBeTruthy();
  });

  it('leaves a chosen day without a time until one is given', async () => {
    // The time is optional, which is what lets one field hold both a birthday and a shift start.
    const el = await makeTimed();
    await open(el);
    firstDay(el).click();
    expect(el.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows no time in the field until the value has one', async () => {
    const el = await makeTimed('2026-08-19');
    const shown = () => (el.shadowRoot?.querySelector('input[part="display"]') as HTMLInputElement).value;
    expect(shown()).not.toMatch(/00:00/);
    el.value = '2026-08-19T14:30';
    await el.updateComplete;
    expect(shown()).toMatch(/14:30/);
  });

  it('stays open on the day, so the time is still reachable', async () => {
    const el = await makeTimed();
    await open(el);
    firstDay(el).click();
    await el.updateComplete;
    expect(timeField(el)).toBeTruthy();
  });

  it('keeps the time when the day changes', async () => {
    const el = await makeTimed('2026-08-19T14:30');
    await open(el);
    firstDay(el).click();
    expect(el.value.slice(11)).toBe('14:30');
  });

  it('takes a time before a day, and dates it today', async () => {
    const el = await makeTimed();
    await open(el);
    const field = timeField(el)!;
    field.value = '09:15';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.value).toBe(`${new Date().toISOString().slice(0, 10)}T09:15`);
  });

  it('closes on the day when there is no time to set', async () => {
    const el = (await makePicker()) as TimedEl;
    await open(el);
    firstDay(el).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[part="calendar"]')).toBeNull();
  });
});
