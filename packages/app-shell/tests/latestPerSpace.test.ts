/**
 * A template choose for one space is superseded by a newer choose for that space, and by nothing
 * a different space does — a choose still reading for the space just left must not stale the one
 * the user arrived to.
 */
import { describe, expect, it } from 'vitest';

import { latestPerSpace } from '../src/frameworks/solid/stores/latestPerSpace';

describe('a tracker for each space', () => {
  it('lets a newer call for the same space supersede an older one', () => {
    const forSpace = latestPerSpace();
    const older = forSpace('a').begin();
    const newer = forSpace('a').begin();
    expect(older()).toBe(false);
    expect(newer()).toBe(true);
  });

  it('does not let a call for another space supersede a pending one', () => {
    const forSpace = latestPerSpace();
    const pendingForA = forSpace('a').begin();
    const forB = forSpace('b').begin();
    expect(pendingForA()).toBe(true);
    expect(forB()).toBe(true);
  });
});
