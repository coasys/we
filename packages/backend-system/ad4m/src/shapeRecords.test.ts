/**
 * A space's own model definitions, read without the executor resolving them: the records without
 * the file, the addresses as links, the files through the client's cache — and the same definition
 * at the end as the ORM would have handed back.
 */
import type { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';
import { decodeFileAsJson, encodeJsonFileData } from '@we/entities';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Shape } from './entities';
import { asDataUrl, readShapeRecords } from './shapeRecords';

const species = { version: '1', entities: { Species: { properties: { name: { type: 'string' } } } } };

afterEach(() => vi.restoreAllMocks());

describe('asDataUrl', () => {
  it('turns a stored file back into what decodes to the same definition', () => {
    const file = encodeJsonFileData(species, 'shape-definition.json');
    expect(decodeFileAsJson(asDataUrl({ data: file }))).toEqual(species);
    expect(decodeFileAsJson(asDataUrl({ data: JSON.stringify(file) }))).toEqual(species);
  });

  it('answers null for something that is not a stored file', () => {
    expect(asDataUrl(null)).toBeNull();
    expect(asDataUrl({ data: 'not json' })).toBeNull();
    expect(asDataUrl({ data: { name: 'x' } })).toBeNull();
  });
});

describe('readShapeRecords', () => {
  it('reads definitions through the client cache, never asking the query to resolve them', async () => {
    const findAll = vi.spyOn(Shape, 'findAll').mockResolvedValue([
      { id: 'shape-a', name: 'Species', shapeId: 'we://shapes/bundle/field-guide/Species', version: 2 },
      { id: 'shape-b', name: 'Sighting' },
    ] as never);
    const perspective = {
      get: vi.fn(async () => [
        { data: { source: 'shape-a', target: 'file://old' }, timestamp: '2026-10-01T00:00:00Z' },
        { data: { source: 'shape-a', target: 'file://new' }, timestamp: '2026-10-02T00:00:00Z' },
      ]),
    } as unknown as PerspectiveProxy;
    const getMany = vi.fn(async (urls: string[]) =>
      urls.map((url) => (url === 'file://new' ? { data: encodeJsonFileData(species, 'shape-definition.json') } : null)),
    );
    const client = { expression: { getMany } } as unknown as Ad4mClient;

    const records = await readShapeRecords(client, perspective);

    const asked = findAll.mock.calls[0][1] as unknown as { properties: string[] };
    expect(asked.properties).not.toContain('definition');
    expect(getMany).toHaveBeenCalledOnce();
    expect(getMany).toHaveBeenCalledWith(['file://new']);
    expect(records[0]).toMatchObject({ name: 'Species', version: 2, forkedFrom: '' });
    expect(decodeFileAsJson(records[0].definition)).toEqual(species);
    expect(records[1]).toMatchObject({ name: 'Sighting', version: 1, definition: null });
  });
});
