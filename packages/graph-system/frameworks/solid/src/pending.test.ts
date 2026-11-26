/** A node with fields drawn over its own, and the same node when there is nothing to draw. */
import type { GraphNode } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { patched } from './pending';

const card = (data: Record<string, string | number>): GraphNode => ({
  id: 'we-graph://entity/d/CollectionBlock/c1',
  kind: 'entity',
  type: 'CollectionBlock',
  data,
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
