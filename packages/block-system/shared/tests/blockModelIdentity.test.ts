/**
 * Block models must be the backend's real classes, not the entity stand-ins.
 *
 * Serialization reads decorator metadata (`getPropertiesMetadata`) to decide which node fields map
 * onto which model properties. That metadata is keyed by class *identity*, so a stand-in — which
 * forwards calls perfectly — resolves to no metadata at all: blocks then persist with empty data
 * and posts come back blank. Nothing about that failure is visible to TypeScript, and every call
 * in the path still "succeeds", which is why it is pinned here.
 */
import { getPropertiesMetadata } from '@coasys/ad4m';
import { describe, expect, it } from 'vitest';

import { registerCoreBlocks } from '../src/core-blocks';
import { getBlockModel } from '../src/registry';

registerCoreBlocks();

describe('registered block models', () => {
  it.each(['image', 'paragraph', 'root', 'file', 'event'])('exposes decorator metadata for %s', (nodeType) => {
    const model = getBlockModel(nodeType);
    expect(model, `no block model registered for "${nodeType}"`).toBeDefined();

    const meta = getPropertiesMetadata(model!);
    expect(
      Object.keys(meta).length,
      `"${nodeType}" resolved to a model with no property metadata — this is what an entity ` +
        `stand-in looks like here; import block models from @we/models/classes`,
    ).toBeGreaterThan(0);
  });

  it('carries the property a serialized node actually maps onto', () => {
    // Spot-check one binding end to end rather than trusting the count alone.
    expect(Object.keys(getPropertiesMetadata(getBlockModel('image')!))).toContain('src');
  });
});
