/**
 * What a released connection drag means.
 *
 * The gesture is pointer capture and DOM and needs a browser; this is the rule inside it, which is
 * where the behaviour is. Both cases here are quiet refusals — the kind that stop working without
 * anything failing, so nothing else would notice.
 */
import { describe, expect, it } from 'vitest';

import { connectionTarget } from './connect';

describe('connectionTarget', () => {
  it('connects to the card released on', () => {
    expect(connectionTarget('node-b', 'node-a')).toBe('node-b');
  });

  it('refuses a release on empty canvas', () => {
    // An abandoned gesture, not a connection to nothing: somebody changed their mind mid-drag, and
    // the line going away is the whole of the right response.
    expect(connectionTarget(undefined, 'node-a')).toBeNull();
  });

  it('refuses a release on the card it started from', () => {
    // Dragging out of an edge and back is how a gesture is cancelled by hand — and a self
    // connection is not a thing the graph can draw or the data can hold.
    expect(connectionTarget('node-a', 'node-a')).toBeNull();
  });
});
