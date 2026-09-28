/**
 * A manifest naming a parent it does not declare — every space shape, which arrives as a manifest
 * holding only itself and extends `WeNode` from the core vocabulary.
 */
import type { EntityManifest } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { compileEntities } from '../src/entities';

const SHAPE: EntityManifest = {
  version: '1',
  entities: {
    Sighting: { extends: 'WeNode', properties: { species: { type: 'string' } }, relations: {} },
  },
};

describe('a shape extending the core vocabulary', () => {
  it('compiles, and carries the parent’s relations', async () => {
    const { Sighting } = compileEntities(SHAPE, { selfId: () => 'did:test:me' });
    const dataset = { id: 'ds-inherited', tables: {} };
    const made = (await Sighting.create(dataset, { species: 'Wren' })) as unknown as { id: string };

    await Sighting.setRelation(dataset, made.id, 'mentions', ['did:test:someone']);
    const found = (await Sighting.findOne(dataset, { where: { id: made.id } })) as unknown as { mentions?: string[] };
    expect(found.mentions).toEqual(['did:test:someone']);
  });
});
