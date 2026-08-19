/**
 * A number field that can hold no number.
 *
 * Empty is not zero, and optional numeric fields need the difference: a default nobody set, a
 * filter left blank. Stepping an empty field used to do arithmetic on '', so one button produced a
 * number and the other silently did nothing.
 */
import './number-input';

import { describe, expect, it } from 'vitest';

type NumberEl = HTMLElement & {
  value: number | '';
  min: number;
  step: number;
  updateComplete: Promise<unknown>;
};

async function makeInput(props: Partial<Pick<NumberEl, 'value' | 'min' | 'step'>> = {}): Promise<NumberEl> {
  const el = document.createElement('we-number-input') as NumberEl;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const stepper = (el: NumberEl, label: 'Increase' | 'Decrease') =>
  el.shadowRoot?.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

describe('an empty value', () => {
  it('renders as empty rather than as zero', async () => {
    const el = await makeInput({ value: '' });
    expect(el.shadowRoot?.querySelector('input')?.value).toBe('');
  });

  it('steps up from a floor of zero when unbounded', async () => {
    const el = await makeInput({ value: '' });
    stepper(el, 'Increase')?.click();
    expect(el.value).toBe(0);
  });

  it('steps up from its own minimum when it has one', async () => {
    const el = await makeInput({ value: '', min: 5 });
    stepper(el, 'Increase')?.click();
    expect(el.value).toBe(5);
  });

  it('answers both buttons, not just one', async () => {
    // The reported symptom: plus appeared dead until minus had been pressed once.
    const up = await makeInput({ value: '' });
    stepper(up, 'Increase')?.click();
    const down = await makeInput({ value: '' });
    stepper(down, 'Decrease')?.click();
    expect(typeof up.value).toBe('number');
    expect(typeof down.value).toBe('number');
  });

  it('lets a value be taken back by clearing the field', async () => {
    const el = await makeInput({ value: 7 });
    const changes: (number | '')[] = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent).detail));

    const input = el.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(el.value).toBe('');
    expect(changes).toEqual(['']);
  });
});
