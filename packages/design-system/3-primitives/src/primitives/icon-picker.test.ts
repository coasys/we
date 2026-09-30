/**
 * `we-icon-picker`'s `size` contract.
 *
 * It had one only for the control's height. The trigger's text pinned `--we-font-size-400` in the
 * shadow CSS and its icons hardcoded `size="sm"`, so a picker asked for at `sm` came out the right
 * height holding full-size text — the one visible symptom, and the reason this is tested at all.
 *
 * Asserted at the contract rather than in pixels: `getInstanceProps()` is what carries the type
 * scale onto the host, and the reflected attribute is what the `:host([size=…])` icon rules match.
 * jsdom resolves neither cascade nor custom properties, so testing the computed text size here
 * would assert only that jsdom is jsdom.
 */
import './icon-picker';

import { describe, expect, it } from 'vitest';

type PickerEl = HTMLElement & {
  size: string;
  getInstanceProps: () => { fontSize?: string };
  updateComplete: Promise<unknown>;
};

async function makePicker(size?: string): Promise<PickerEl> {
  const el = document.createElement('we-icon-picker') as PickerEl;
  if (size) el.size = size;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('size', () => {
  it('carries a type scale onto the host, one step per size', async () => {
    const scale = await Promise.all(
      ['xs', 'sm', 'md', 'lg', 'xl'].map(async (size) => (await makePicker(size)).getInstanceProps().fontSize),
    );
    expect(scale).toEqual(['100', '200', '300', '400', '400']);
  });

  it('leaves the default alone', async () => {
    const el = await makePicker();
    expect(el.getInstanceProps().fontSize).toBe('300');
  });

  it('reflects the attribute the icon-sizing rules match on', async () => {
    const el = await makePicker('sm');
    expect(el.getAttribute('size')).toBe('sm');
  });

  it('lets the trigger icons inherit rather than pinning a size of their own', async () => {
    // Pinned `size="sm"` was the other half of the bug: the caret and preview stayed put while the
    // control shrank. They now resolve through `--we-context-icon-size`, which the host sets.
    const el = await makePicker('sm');
    const triggerIcons = el.shadowRoot?.querySelectorAll('[part="caret"] we-icon, [part="preview-icon"] we-icon');
    expect(triggerIcons?.length).toBeGreaterThan(0);
    for (const icon of triggerIcons ?? []) expect(icon.getAttribute('size')).toBeNull();
  });
});
