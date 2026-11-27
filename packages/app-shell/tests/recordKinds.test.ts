/**
 * The record store's kinds part: what can be made and shown follows the space's shapes and the
 * dataset's classes, and the space's own layer over how a type is laid out is read live and written
 * through its operations.
 *
 * Run once under each reactivity port, against the in-memory backend holding the space and its key.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import type { EntityManifestEntry } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import type { ReactivityPort, Setter } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SpaceShapeView } from '../src/shared/shapes/spaceShapes';
import { operationRunner } from '../src/shared/stores/records/context';
import { createRecordKinds, type RecordKinds } from '../src/shared/stores/records/kinds';
import { reactivityPorts } from './support/engines';
import { testOperations } from './support/operations';

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  };

const SPACE = 'space-1';
const shape = (name: string): SpaceShapeView =>
  ({
    id: `shape-${name}`,
    name,
    description: '',
    icon: 'binoculars',
    problems: [],
    manifest: { entities: { [name]: { properties: { title: { type: 'string' } }, relations: {} } } },
  }) as unknown as SpaceShapeView;

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let handle: unknown;
  let errors: string[];
  let setShapes: Setter<SpaceShapeView[]>;
  let setEntities: Setter<EntityManifestEntry[]>;
  let setOnScreen: Setter<boolean>;

  function build(): RecordKinds {
    const [shapes, writeShapes] = reactivity.signal<SpaceShapeView[]>([]);
    const [entities, writeEntities] = reactivity.signal<EntityManifestEntry[]>([]);
    const [onScreen, writeOnScreen] = reactivity.signal(true);
    setShapes = writeShapes;
    setEntities = writeEntities;
    setOnScreen = writeOnScreen;
    const sessionStore = { me: () => ({ did: 'did:key:z6Mk' }) } as never;
    let kinds!: RecordKinds;
    disposers.push(
      reactivity.root(() => {
        kinds = createRecordKinds({
          reactivity,
          toasts: { info: () => 0, success: () => 0, warning: () => 0, error: (m: string) => errors.push(m) },
          sessionStore,
          datasetStore: {
            currentDataset: () => (onScreen() ? { id: 'ds', handle, name: 'Space' } : null),
            currentDatasetEntities: entities,
            datasets: () => [],
          } as never,
          shapeStore: { spaceShapes: shapes },
          operations: testOperations,
          runOp: operationRunner(sessionStore, testOperations),
        });
      }),
    );
    return kinds;
  }

  beforeEach(async () => {
    reactivity = makePort();
    errors = [];
    const ports = createInMemoryBackendPorts(
      { selfId: () => 'did:key:z6Mk' },
      { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-kinds', name: 'Kinds' }] },
    );
    handle = (await ports.lifecycle.get('ds-kinds'))!.handle;
    await model('Space').create(handle, { name: 'A space' }, { id: SPACE });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('offers the space’s own models first, and follows them as they are defined', () => {
    const kinds = build();
    expect(kinds.creatableEntities()[0].group).toBe('Built in');
    setShapes([shape('Sighting')]);
    expect(kinds.creatableEntities()[0]).toMatchObject({ value: 'Sighting', group: 'This space' });
    expect(kinds.displays().Sighting).toMatchObject({ entity: 'Sighting', icon: 'binoculars' });
    expect(kinds.schemaFor('Sighting')?.authorable).toBe(true);
  });

  it('shows a class the dataset already had, and never WE’s own bookkeeping', () => {
    const kinds = build();
    setEntities([
      { name: 'Channel', properties: [{ name: 'name', type: 'string' }] },
      { name: 'Placement', properties: [{ name: 'x', type: 'number' }] },
    ] as never);
    expect(kinds.displays().Channel.fields.map((field) => field.name)).toEqual(['name']);
    expect(kinds.kinds().some((kind) => kind.value === 'Channel')).toBe(false);
    expect(kinds.plumbingClasses()).toContain('Placement');
  });

  it('lays a type out as the space says, and puts it back when the space lets go', async () => {
    const kinds = build();
    await flush();
    await kinds.setSpaceTypePresentation(SPACE, 'TaskBlock', { display: { title: 'description' } });
    await flush();
    expect(kinds.displays().TaskBlock.title).toBe('description');

    await kinds.setSpaceTypePresentation(SPACE, 'TaskBlock', null);
    await flush();
    expect(kinds.displays().TaskBlock.title).toBe('title');
  });

  it('keeps a type’s colour when its layout changes, and deletes a row left saying nothing', async () => {
    const kinds = build();
    const rows = () =>
      model('TypeStyle').findAll(handle, { parent: { id: SPACE, relation: 'typeStyles', entity: 'Space' } });
    await kinds.setSpaceTypeColor(SPACE, 'TaskBlock', { detail: '#ff0000' });
    await kinds.setSpaceTypePresentation(SPACE, 'TaskBlock', { authoring: ['title'] });
    expect((await rows()).map((row) => row.color)).toEqual(['#ff0000']);

    await kinds.setSpaceTypePresentation(SPACE, 'TaskBlock', null);
    await kinds.setSpaceTypeColor(SPACE, 'TaskBlock', '');
    expect(await rows()).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('forgets the space’s layer when the space goes off screen', async () => {
    const kinds = build();
    await flush();
    await kinds.setSpaceTypePresentation(SPACE, 'TaskBlock', { display: { title: 'description' } });
    await flush();
    setOnScreen(false);
    expect(kinds.displays().TaskBlock.title).toBe('title');
  });
});
