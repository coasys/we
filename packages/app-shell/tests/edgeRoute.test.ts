/**
 * Pinning and clearing one end of a connection, and what becomes of the bends.
 *
 * The bends are why this is tested at all. One `EdgeRoute` holds both the sides a connection is
 * pinned to and the points it is bent through, and a cleared anchor has to be a delete-and-recreate
 * rather than an update — so every path that stops holding an anchor is a path that can silently
 * drop the shape somebody drew. It did: dropping a line's end on another card cleared that anchor,
 * which deleted the record, which took every waypoint with it.
 */
import { describe, expect, it } from 'vitest';

import { routeWrite } from '../src/shared/edgeRoute';

const BENT = '[{"along":0.5,"across":0.2}]';

describe('pinning a side', () => {
  it('creates a route when there is none', () => {
    expect(routeWrite(undefined, 'source', 'n')).toEqual({ action: 'create', fields: { sourceAnchor: 'n' } });
  });

  it('writes nothing for a clear against a route that does not exist', () => {
    // A record saying "no anchors" changes nothing and would have to be swept up later.
    expect(routeWrite(undefined, 'source', '')).toEqual({ action: 'none' });
  });

  it('updates in place when a side is being set', () => {
    expect(routeWrite({ sourceAnchor: 'n', points: BENT }, 'target', 'w')).toEqual({
      action: 'update',
      fields: { targetAnchor: 'w' },
    });
  });
});

describe('clearing a side', () => {
  it('deletes the route once nothing is pinned and nothing is drawn', () => {
    expect(routeWrite({ sourceAnchor: 'n' }, 'source', '')).toEqual({ action: 'delete' });
  });

  it('treats an empty point list as nothing drawn', () => {
    // `rerouteOnCanvas` writes `[]` to straighten a line, because an update skips `''` — so the
    // absence of bends reaches here spelled two different ways.
    expect(routeWrite({ sourceAnchor: 'n', points: '[]' }, 'source', '')).toEqual({ action: 'delete' });
  });

  it('keeps the other end when only one is cleared', () => {
    expect(routeWrite({ sourceAnchor: 'n', targetAnchor: 'w' }, 'source', '')).toEqual({
      action: 'replace',
      fields: { targetAnchor: 'w' },
    });
  });

  /*
    The reported bug, both halves of it.

    Re-attaching an end clears that end's anchor, so a route that was pinned at one end and bent in
    the middle went through the delete branch and lost the bends on the way. A waypoint is stored in
    the connection's own frame precisely so it survives an end moving — that is what the frame is
    for — so a re-attachment must no more discard it than dragging a card does.
  */
  it('keeps the bends when the last anchor is cleared', () => {
    expect(routeWrite({ sourceAnchor: 'n', points: BENT }, 'source', '')).toEqual({
      action: 'replace',
      fields: { points: BENT },
    });
  });

  it('keeps the bends and the other anchor together', () => {
    expect(routeWrite({ sourceAnchor: 'n', targetAnchor: 'e', points: BENT }, 'source', '')).toEqual({
      action: 'replace',
      fields: { targetAnchor: 'e', points: BENT },
    });
  });

  it('never restates the anchor being cleared', () => {
    // The whole reason this is a replace: an update would skip the empty string and leave the old
    // side stored, so the line would not move.
    const write = routeWrite({ sourceAnchor: 'n', targetAnchor: 'e', points: BENT }, 'source', '');

    expect(write.action).toBe('replace');
    expect(write).not.toHaveProperty('fields.sourceAnchor');
  });
});
