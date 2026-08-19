/**
 * Where `we-form-field` puts its two kinds of message, and that they are two kinds.
 *
 * They shared one slot once, rendered as `error ? error : description`, so a field carrying both
 * lost its instructions at exactly the moment the reader had got it wrong. They now sit on opposite
 * sides of the control — a description tells you how to fill the field in and must be read before
 * you do; an error is a reaction to what you already did.
 */
import './form-field';

import { describe, expect, it } from 'vitest';

type FieldEl = HTMLElement & {
  label: string;
  description: string;
  error: string;
  updateComplete: Promise<unknown>;
};

async function makeField(props: Partial<Pick<FieldEl, 'label' | 'description' | 'error'>>): Promise<FieldEl> {
  const el = document.createElement('we-form-field') as FieldEl;
  Object.assign(el, props);
  el.appendChild(document.createElement('input'));
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** The rendered parts, in document order — what a reader meets top to bottom. */
const partsOf = (el: FieldEl) =>
  [...(el.shadowRoot?.querySelectorAll('[part]') ?? [])].map((n) => n.getAttribute('part')).filter((p) => p !== 'base');

describe('message placement', () => {
  it('reads label, description, control — the order the field is filled in', async () => {
    const el = await makeField({ label: 'Icon', description: 'Shown to people browsing.' });
    expect(partsOf(el)).toEqual(['label', 'description', 'control']);
  });

  it('puts an error after the control, where a reaction belongs', async () => {
    const el = await makeField({ label: 'Name', error: 'Required' });
    expect(partsOf(el)).toEqual(['label', 'control', 'error']);
  });

  it('keeps showing the instructions when the value is wrong', async () => {
    // The regression this file exists for: an error used to replace the description outright.
    const el = await makeField({ label: 'Name', description: 'Letters and digits only.', error: 'Required' });
    expect(partsOf(el)).toEqual(['label', 'description', 'control', 'error']);
  });

  it('names both messages as the control description', async () => {
    const el = await makeField({ label: 'Name', description: 'Letters and digits only.', error: 'Required' });
    const control = el.shadowRoot?.querySelector('[part="control"]');
    const described = control?.getAttribute('aria-describedby') ?? '';
    const ids = [
      el.shadowRoot?.querySelector('[part="description"]')?.id,
      el.shadowRoot?.querySelector('[part="error"]')?.id,
    ];
    for (const id of ids) expect(described.split(' ')).toContain(id);
  });

  it('renders nothing it was not given', async () => {
    const el = await makeField({});
    expect(partsOf(el)).toEqual(['control']);
  });
});
