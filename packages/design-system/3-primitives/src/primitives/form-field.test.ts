/**
 * Where `we-form-field` puts its two kinds of message, and that they are two kinds.
 *
 * They shared one slot once, rendered as `error ? error : description`, so a field carrying both
 * lost its instructions at exactly the moment the reader had got it wrong. They now sit on opposite
 * sides of the control — a description tells you how to fill the field in and must be read before
 * you do; an error is a reaction to what you already did.
 */
import { describe, expect, it } from 'vitest';

import FormField from './form-field';

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

/**
 * The declarations of one part's rule, read off the component's own stylesheet.
 *
 * Asserted against the CSS text rather than a computed style because jsdom resolves neither the
 * cascade nor custom properties, so `getComputedStyle` here would only report that a var is a var.
 */
const ruleFor = (part: string): string => {
  const sheet = (FormField.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');
  return new RegExp(`\\[part='${part}'\\]\\s*\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';
};

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

describe('type ramp', () => {
  /*
    Pinned because these three were all `body` (300) once: a label sat at the same size as its own
    help text, leaving colour to carry the hierarchy, and a form-field label sat a step larger than
    the `we-text variant="label"` beside it. The values below are we-text's own semantics, and
    drifting off them is the regression.
  */
  it('labels a field the way we-text labels anything — 200, medium', () => {
    expect(ruleFor('label')).toContain('--we-font-size-200');
    expect(ruleFor('label')).toContain('font-weight: 500');
  });

  it('drops both messages to footnote size, a clear step below the label', () => {
    expect(ruleFor('description')).toContain('--we-font-size-100');
    expect(ruleFor('error')).toContain('--we-font-size-100');
  });

  it('weights the error so it still carries at that size', () => {
    expect(ruleFor('error')).toContain('font-weight: 500');
    expect(ruleFor('description')).not.toContain('font-weight');
  });
});
