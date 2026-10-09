import { describe, expect, it } from 'vitest';

import { type PartFacts, whyMissing } from '../src/shared/partAvailability';

const here: PartFacts = {
  registered: true,
  published: true,
  inSpace: true,
  active: true,
  installed: true,
  enabled: true,
};

describe('why a placed part cannot draw', () => {
  it('draws when its module is here', () => {
    expect(whyMissing(here)).toBeNull();
  });

  it('says the build lacks the module before anything else', () => {
    expect(whyMissing({ ...here, registered: false, published: false, active: false })).toBe('not-in-build');
  });

  it('says the module no longer offers the piece', () => {
    expect(whyMissing({ ...here, published: false })).toBe('no-such-part');
  });

  it('blames the person’s own switch before the space’s', () => {
    // Turning it on in the space would not help somebody who has it off everywhere.
    expect(whyMissing({ ...here, active: false, installed: false, enabled: false })).toBe('off-for-you');
  });

  it('says the space has it off', () => {
    expect(whyMissing({ ...here, active: false, enabled: false })).toBe('off-in-space');
  });

  it('says it is hidden here when everything else allows it', () => {
    expect(whyMissing({ ...here, active: false })).toBe('hidden-here');
  });

  it('asks only about the build outside a space', () => {
    expect(whyMissing({ ...here, inSpace: false, active: false, enabled: false })).toBeNull();
  });
});
