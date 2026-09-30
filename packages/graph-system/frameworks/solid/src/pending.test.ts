/**
 * Optimistic fields, and when the graph stops needing them.
 *
 * The bug this pins is a *timing* one, and it looked like a rendering bug: an edit flashed to its
 * new value, snapped back to the old one, and arrived again a second later. The cause was confirming
 * where the data was read rather than where it was drawn — everything between the two still had the
 * old value, and dropping the patch there put it back on screen.
 */
import type { GraphNode } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { isSettled, patched } from './pending';

const card = (data: Record<string, string | number>): GraphNode => ({
  id: 'we-graph://entity/d/CollectionBlock/c1',
  kind: 'entity',
  type: 'CollectionBlock',
  data,
});

describe('isSettled', () => {
  it('is settled once the node carries what the patch was standing in for', () => {
    expect(isSettled(card({ canvasWidth: 320 }), { canvasWidth: 320 })).toBe(true);
  });

  it('is not settled while the node still has the old value', () => {
    expect(isSettled(card({ canvasWidth: 180 }), { canvasWidth: 320 })).toBe(false);
  });

  it('needs every field, not any of them', () => {
    // A node that has caught up on the colour but not the size is still a node the optimistic size
    // is needed for — this is the assertion that keeps the card from flicking back mid-way.
    const node = card({ canvasWidth: 180, canvasColor: 'warning-100' });

    expect(isSettled(node, { canvasWidth: 320, canvasColor: 'warning-100' })).toBe(false);
  });

  it('is not settled when the node has no data at all', () => {
    expect(isSettled({ id: 'x', kind: 'entity', type: 'T' }, { canvasWidth: 320 })).toBe(false);
  });
});

describe('patched', () => {
  it('lays the patch over the node data', () => {
    const node = card({ canvasWidth: 180, title: 'One' });

    expect(patched(node, { canvasWidth: 320 }).data).toEqual({ canvasWidth: 320, title: 'One' });
  });

  it('hands back the same node when there is nothing to apply', () => {
    // Runs per node on every graph change; a fresh object each time would defeat every identity
    // check downstream for the sake of a patch that does not exist.
    const node = card({ canvasWidth: 180 });

    expect(patched(node, undefined)).toBe(node);
    expect(patched(node, {})).toBe(node);
  });

  it('leaves the original node alone', () => {
    const node = card({ canvasWidth: 180 });
    patched(node, { canvasWidth: 320 });

    // The raw node is what `isSettled` is asked about, so patching in place would make every patch
    // look settled the instant it was applied.
    expect(node.data?.canvasWidth).toBe(180);
  });
});
