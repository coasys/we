/**
 * Colour is `tone`, and the validator says so where the old spelling turns up.
 *
 * `variant` held colours once — `primary`, `danger`, `success` beside `ghost` and `outline` — and
 * colour moved to `tone`, a prop every element takes. These run against the real generated context,
 * so they also prove the primitives' enums reached it.
 */
import { describe, expect, it } from 'vitest';

import { contextData } from './generated/contextData';
import { buildValidationContext, validateSemantic } from './semanticValidation';

const ctx = buildValidationContext(contextData);
const messages = (node: object) => validateSemantic(node as never, ctx).errors.map((e) => e.message);

describe('tone', () => {
  it('is accepted on any element, in every family', () => {
    for (const tone of ['neutral', 'accent', 'danger', 'teal']) {
      expect(messages({ type: 'we-button', props: { variant: 'solid', tone } })).toEqual([]);
      expect(messages({ type: 'Column', props: { tone } })).toEqual([]);
    }
  });

  it('names the family a misspelt tone probably meant', () => {
    expect(messages({ type: 'we-badge', props: { tone: 'primary' } }).join()).toContain('did you mean "accent"');
    expect(messages({ type: 'we-badge', props: { tone: 'error' } }).join()).toContain('did you mean "danger"');
  });
});

describe('a colour written as a variant', () => {
  it('points at tone rather than only listing the styles', () => {
    expect(messages({ type: 'we-button', props: { variant: 'danger' } }).join()).toContain("tone: 'danger'");
    expect(messages({ type: 'we-badge', props: { variant: 'warning' } }).join()).toContain("tone: 'warning'");
  });

  it('names the style the old emphasis words became', () => {
    expect(messages({ type: 'we-button', props: { variant: 'primary' } }).join()).toContain("'solid'");
    expect(messages({ type: 'we-button', props: { variant: 'secondary' } }).join()).toContain("'soft'");
  });

  it('sends appearance to variant', () => {
    expect(messages({ type: 'we-badge', props: { appearance: 'solid' } }).join()).toContain('did you mean "variant"');
  });
});
