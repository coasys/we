/**
 * What the hint editor shows, and specifically what an *absent* stored hint means.
 *
 * Storage cannot answer that on its own — an empty hint is stored by removing its link, so "cleared
 * on purpose" and "never touched" read back identically. The customized marker is the tiebreak, and
 * getting it wrong is invisible in exactly one direction: a model saved with a hint on every
 * property opened its editor with every property blank, because the fallback to the declaration was
 * reachable only when nothing at all was stored.
 */
import { describe, expect, it } from 'vitest';

import { hintToDisplay } from '../src/shared/shapes/hintEditor';

const DECLARED = 'The title as spoken, without a subtitle.';
const TUNED = 'Just the title. Skip the author.';

describe('hintToDisplay', () => {
  it('shows the declaration when the space has never customized and stores nothing', () => {
    // The case the editor got wrong: every property of a freshly saved model landed here.
    expect(hintToDisplay({ stored: undefined, declared: DECLARED, customized: false })).toBe(DECLARED);
  });

  it('shows an empty box when a customizing space has cleared the hint', () => {
    // Falling back here would hand back words somebody deleted, and re-saving would reinstate them.
    expect(hintToDisplay({ stored: undefined, declared: DECLARED, customized: true })).toBe('');
  });

  it("shows the space's own words wherever it has them", () => {
    expect(hintToDisplay({ stored: TUNED, declared: DECLARED, customized: true })).toBe(TUNED);
    // Stored but not customized is the ordinary install: the shape carries what the model declared.
    expect(hintToDisplay({ stored: DECLARED, declared: DECLARED, customized: false })).toBe(DECLARED);
  });

  it('never invents a hint for a declaration that has none', () => {
    expect(hintToDisplay({ stored: undefined, declared: '', customized: false })).toBe('');
  });
});
