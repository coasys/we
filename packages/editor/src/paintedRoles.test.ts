/**
 * Which role paints the selected node.
 *
 * The case worth testing is the one the panel used to get wrong by omission: a `we-text` that sets
 * no colour of its own. Almost all text is like that — it inherits from a Column several levels up —
 * so an inspector that only reads the node's own props answers "—" for exactly the element somebody
 * clicked because its colour looked wrong.
 */
import { describe, expect, it } from 'vitest';

import { borderColorOf, paintedRoles } from './paintedRoles';

const node = (type: string, props?: Record<string, unknown>) => ({ type, props });

describe('paintedRoles', () => {
  it('reads a colour the node sets itself, and does not mark it inherited', () => {
    const out = paintedRoles(node('Column', { bg: 'surface', color: 'text' }), []);
    expect(out).toEqual([
      { what: 'Background', value: 'surface', from: undefined },
      { what: 'Text', value: 'text', from: undefined },
    ]);
  });

  it('finds the ancestor a text colour is inherited from, and names it', () => {
    const out = paintedRoles(node('we-text'), [node('Row'), node('Column', { color: 'text-muted' })]);
    expect(out).toEqual([{ what: 'Text', value: 'text-muted', from: 'Column' }]);
  });

  /*
    Nearest wins, not outermost: a card inside a page both paint, and the answer for something on
    the card is the card. Getting this backwards would send every jump to the template root.
  */
  it('takes the nearest painting ancestor, not the furthest', () => {
    const out = paintedRoles(node('we-text'), [node('Card', { bg: 'surface' }), node('Column', { bg: 'page' })]);
    expect(out).toEqual([{ what: 'Background', value: 'surface', from: 'Card' }]);
  });

  it('reports nothing rather than guessing when no ancestor paints', () => {
    expect(paintedRoles(node('we-text'), [node('Row'), node('Column')])).toEqual([]);
  });

  /*
    A border does not inherit, so an ancestor's is not this element's. Reporting one would send
    somebody to change a line they are not looking at.
  */
  it('does not inherit a border from an ancestor', () => {
    const out = paintedRoles(node('we-text'), [node('Card', { border: '1px solid border' })]);
    expect(out.some((e) => e.what === 'Border')).toBe(false);
  });

  it("reports the node's own border", () => {
    const out = paintedRoles(node('Card', { border: '1px solid border-strong' }), []);
    expect(out).toEqual([{ what: 'Border', value: 'border-strong' }]);
  });

  it('reports a scale position too — knowing a colour is pinned is the point', () => {
    expect(paintedRoles(node('Column', { bg: 'neutral-100' }), [])).toEqual([
      { what: 'Background', value: 'neutral-100', from: undefined },
    ]);
  });
});

describe('borderColorOf', () => {
  it('takes the colour out of a shorthand', () => {
    expect(borderColorOf({ border: '1px solid border' })).toBe('border');
    expect(borderColorOf({ border: '2px dashed accent-muted' })).toBe('accent-muted');
  });

  it('prefers an explicit borderColor over the shorthand', () => {
    expect(borderColorOf({ border: '1px solid border', borderColor: 'danger-text' })).toBe('danger-text');
  });

  it('ignores a raw CSS colour, which has no role to jump to', () => {
    expect(borderColorOf({ border: '1px solid #ccc' })).toBeUndefined();
    expect(borderColorOf({ border: '1px solid var(--we-role-border)' })).toBeUndefined();
  });

  it('is absent when there is no border at all', () => {
    expect(borderColorOf({})).toBeUndefined();
    expect(borderColorOf({ border: {} })).toBeUndefined();
  });
});
