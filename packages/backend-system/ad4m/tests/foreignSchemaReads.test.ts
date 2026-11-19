/**
 * `foreignEntries` is the read half of `foreignSchemas`: the same answer with nothing registered.
 *
 * `registerDynamicEntities` *replaces* a dataset's synthesised-class registry — correct for the
 * foreign-schema sweep that owns it, which the switch runs and the shape load re-adopts after.
 * A candidacy ask is not that: a watch for a call in a space nobody is looking at, or an export's
 * settings read, would otherwise leave the dataset's adopted shapes rebuilt from SHACL — the same
 * names, short of the compiled behaviour their classes carried (a manifest's `readAs` transform,
 * say). The sweep keeps its semantics; the ask gets a read of its own.
 */
import type { SHACLShape } from '@coasys/ad4m';
import type { EntityManifest } from '@we/backend-shared';
import { getEntityForDataset } from '@we/entities';
import { describe, expect, it } from 'vitest';

import { createAd4mSchemaPort } from '../src/backendPortsAdapter';

const MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Sighting: {
      properties: { note: { type: 'string' } },
      relations: {},
    },
  },
};

const foreignShape = {
  nodeShapeUri: 'x://ForeignShape',
  targetClass: 'x://Foreign',
  properties: [],
  parentShapes: [],
} as unknown as SHACLShape;

/** A perspective holding one foreign shape, answered the way `getForeignShacl` asks. */
function mockPerspective(uuid: string) {
  return {
    uuid,
    getShaclNames: async () => ['Foreign'],
    querySparql: async (query: string) =>
      query.includes('<ad4m://shacl_shape_uri>') && query.includes('<sh://targetClass>')
        ? [{ name: 'literal:string:shacl://Foreign', shape: 'x://ForeignShape', targetClass: 'x://Foreign' }]
        : [],
    getShacl: async (name: string) => (name === 'Foreign' ? foreignShape : null),
  };
}

describe('the two halves of the foreign-schema read', () => {
  it('answers the foreign classes a dataset holds without touching its registry', async () => {
    const port = createAd4mSchemaPort({});
    const dataset = mockPerspective('persp-foreign-entries');
    const classes = port.declareInDataset(dataset as never, MANIFEST, { moduleId: 'shape/test' });
    expect(getEntityForDataset('Sighting', dataset)).toBe(classes.Sighting);

    const entries = await port.foreignEntries(dataset as never);

    expect(entries.map((e) => e.name)).toEqual(['Foreign']);
    // Nothing registered: the adopted shape's class is still the compiled one, and the foreign
    // name did not become resolvable as the price of asking.
    expect(getEntityForDataset('Sighting', dataset)).toBe(classes.Sighting);
    expect(getEntityForDataset('Foreign', dataset)).toBeUndefined();
  });

  it('leaves the sweep a sweep: foreignSchemas still registers, replacing the registry', async () => {
    const port = createAd4mSchemaPort({});
    const dataset = mockPerspective('persp-foreign-schemas');
    port.declareInDataset(dataset as never, MANIFEST, { moduleId: 'shape/test' });

    const entries = await port.foreignSchemas(dataset as never);

    expect(entries.map((e) => e.name)).toEqual(['Foreign']);
    expect(getEntityForDataset('Foreign', dataset)).toBeDefined();
    // The sweep owns the synthesised registry — adopted classes are re-adopted after it, on the
    // switch's own order, not kept through it.
    expect(getEntityForDataset('Sighting', dataset)).toBeUndefined();
  });
});
