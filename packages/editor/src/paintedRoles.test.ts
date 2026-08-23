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
    expect(out).toEqual([
      { what: 'Background', value: 'surface', from: 'Card' },
      { what: 'Text', value: 'text', fromDocument: true },
    ]);
  });

  /*
    A background genuinely may be absent — nothing above paints, and claiming `page` would be a guess
    about a root the fragment cannot see. A text colour never is: `index.scss` sets
    `body { color: var(--we-role-text) }`, so text with no prop anywhere in its chain is painted by
    the document. Reporting nothing there was the readout's worst answer — selecting a `we-text`
    showed a background and no foreground, which is the one thing you were looking for.
  */
  it('falls back to the document’s role for text, and still guesses no background', () => {
    expect(paintedRoles(node('we-text'), [node('Row'), node('Column')])).toEqual([
      { what: 'Text', value: 'text', fromDocument: true },
    ]);
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
    expect(out).toEqual([
      { what: 'Text', value: 'text', fromDocument: true },
      { what: 'Border', value: 'border-strong' },
    ]);
  });

  it('reports a scale position too — knowing a colour is pinned is the point', () => {
    expect(paintedRoles(node('Column', { bg: 'neutral-100' }), [])).toEqual([
      { what: 'Background', value: 'neutral-100', from: undefined },
      { what: 'Text', value: 'text', fromDocument: true },
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
