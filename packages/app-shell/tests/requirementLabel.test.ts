/** A requirement a form has not saved yet, said in the words a saved one is said in. */
import { describe, expect, it } from 'vitest';

import { requirementLabel } from '../src/shared/sources/requirementLabel';

describe('requirementLabel', () => {
  it('says a picked requirement as the store says a stored one', () => {
    expect(requirementLabel({ entity: 'comment', via: 'responses', min: 1 })).toBe(
      'at least 1 comment in response to it',
    );
    expect(requirementLabel({ entity: 'file', via: '', min: 2 })).toBe('at least 2 files');
  });

  it('says nothing for nothing picked', () => {
    expect(requirementLabel({})).toBe('');
  });
});
