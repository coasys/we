/**
 * What to call somebody, from whatever their profile holds.
 *
 * One rule in one place is the whole point of the function, so these are the cases where a caller
 * writing it out by hand would get a different answer: a handle and nothing else (the templates that
 * concatenated first and last inline rendered a single space), whitespace-only fields, and an agent
 * with no name at all — which is not hypothetical, since an identity created outside WE arrives that
 * way and WE never asks it for one.
 */
import { describe, expect, it } from 'vitest';

import { ANONYMOUS_AGENT_NAME, displayName } from '../src/profileTypes';

const parts = (firstName = '', lastName = '', handle = '') => ({ firstName, lastName, handle });

describe('displayName', () => {
  it('joins first and last', () => {
    expect(displayName(parts('James', 'Brechin'))).toBe('James Brechin');
  });

  it.each([
    ['first name only', parts('James'), 'James'],
    ['last name only', parts('', 'Brechin'), 'Brechin'],
    // The case every inline concatenation got wrong — they produced ' ' for this.
    ['handle only', parts('', '', 'james'), 'james'],
  ])('%s', (_label, profile, expected) => {
    expect(displayName(profile)).toBe(expected);
  });

  it('prefers a real name over a handle', () => {
    expect(displayName(parts('James', '', 'jb'))).toBe('James');
  });

  it('trims, so a padded field does not become a padded name', () => {
    expect(displayName(parts(' James ', ' Brechin '))).toBe('James Brechin');
    expect(displayName(parts('', '', '  james  '))).toBe('james');
  });

  it('treats a whitespace-only handle as absent rather than as a name of spaces', () => {
    expect(displayName(parts('', '', '   '))).toBe(ANONYMOUS_AGENT_NAME);
  });

  it('falls back for an agent with nothing published', () => {
    expect(displayName(parts())).toBe(ANONYMOUS_AGENT_NAME);
  });

  it('takes an explicit fallback, for a label beside a face that already identifies the person', () => {
    expect(displayName(parts(), '')).toBe('');
  });
});
