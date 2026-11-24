/**
 * The Pocket's declared operations against the in-memory backend — the module's entities declared
 * the way the host declares them, its operations registered under its id, and the store's own
 * calls through the agent-data kernel the host builds.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, registerOperations, runOperation, unregisterOperations } from '@we/entities';
import { POCKET_MANIFEST, pocketModule } from '@we/module-pocket';
import type { ModuleStoreDeps } from '@we/module-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentDataKernel } from '../src/shared/agentData';

const ME = 'did:test:me';
type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Row[]>;
    findOne(p: unknown, query: Record<string, unknown>): Promise<Row | null>;
  };

let dataset: unknown;
const run = (name: string, args: Record<string, unknown> = {}) => runOperation(name, args, { dataset, invoker: ME });
const itemsIn = (folder: string) =>
  model('PocketItem').findAll(dataset, { parent: { id: folder, relation: 'items', entity: 'PocketFolder' } });

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-personal', name: 'Personal' }] },
  );
  dataset = (await ports.lifecycle.get('ds-personal'))!.handle;
  ports.schemas.declare(POCKET_MANIFEST, { moduleId: 'pocket' });
  registerOperations('pocket', POCKET_MANIFEST.operations, { version: POCKET_MANIFEST.version });
});

afterEach(() => unregisterOperations('pocket'));

describe('pocket.rootFolder', () => {
  it('makes the root once, and answers with it after', async () => {
    const first = (await run('pocket.rootFolder')) as Row;
    const again = (await run('pocket.rootFolder')) as Row;
    expect(again.id).toBe(first.id);
    expect(await model('PocketFolder').findAll(dataset)).toHaveLength(1);
    expect(first).toMatchObject({ name: 'Pocket', root: true });
  });
});

describe('pocket.gather', () => {
  const ref = 'we:n:QmSpace/CollectionBlock/post-1';

  it('keeps a reference at the root, stamped with when it was kept, and keeps it once', async () => {
    const id = await run('pocket.gather', { ref, entity: 'CollectionBlock', label: 'A post' });
    expect(await run('pocket.gather', { ref })).toBe(id);

    const root = (await run('pocket.rootFolder')) as Row;
    const [item] = await itemsIn(root.id);
    expect(item).toMatchObject({ id, ref, entity: 'CollectionBlock', label: 'A post' });
    expect(typeof item.gatheredAt).toBe('string');
  });

  it('moves a held item to the folder it is dropped on, keeping its id and its snapshot', async () => {
    const root = (await run('pocket.rootFolder')) as Row;
    const id = (await run('pocket.gather', { ref, label: 'A post' })) as string;
    const kept = await model('PocketItem').findOne(dataset, { where: { id } });

    // A second folder, under the root.
    const PocketFolder = getEntity('PocketFolder') as unknown as {
      create(p: unknown, d: Record<string, unknown>, o: Record<string, unknown>): Promise<Row>;
    };
    const other = await PocketFolder.create(
      dataset,
      { name: 'Reading' },
      { parent: { id: root.id, relation: 'folders', entity: 'PocketFolder' } },
    );

    expect(await run('pocket.gather', { ref, into: other.id, origin: { id, folder: root.id } })).toBe(id);
    expect((await itemsIn(other.id)).map((row) => row.id)).toEqual([id]);
    expect(await itemsIn(root.id)).toEqual([]);
    expect((await model('PocketItem').findOne(dataset, { where: { id } }))?.gatheredAt).toBe(kept?.gatheredAt);
  });
});

describe('deleting a folder through the store', () => {
  it('takes the folder, its folders and everything kept in them, and nothing else', async () => {
    const kernel = agentDataKernel(
      {
        personalDataset: () => ({ id: 'ds-personal', handle: dataset }),
        whenPersonalDataset: () => Promise.resolve({ id: 'ds-personal', handle: dataset }),
      },
      {
        create: async () => undefined,
        find: (handle, entity, query) => model(entity).findAll(handle, query as Record<string, unknown>),
        update: async () => undefined,
        remove: async () => undefined,
        run: (handle, name, args) => runOperation(name, args, { dataset: handle, invoker: ME }),
      },
    );
    const store = pocketModule.createStore!({
      signal: <T>(initial: T): [() => T, (next: T) => void] => {
        let value = initial;
        return [() => value, (next: T) => void (value = next)];
      },
      state: (accessor: unknown) => accessor,
      action: (fn: unknown) => fn,
      kernels: { agentData: kernel },
      datasetRefKey: () => 'n:QmSpace',
    } as unknown as ModuleStoreDeps) as { deleteFolder(id: string): Promise<void> };

    const root = (await run('pocket.rootFolder')) as Row;
    const PocketFolder = getEntity('PocketFolder') as unknown as {
      create(p: unknown, d: Record<string, unknown>, o: Record<string, unknown>): Promise<Row>;
    };
    const under = (id: string) => ({ parent: { id, relation: 'folders', entity: 'PocketFolder' } });
    const doomed = await PocketFolder.create(dataset, { name: 'Old' }, under(root.id));
    const inner = await PocketFolder.create(dataset, { name: 'Older' }, under(doomed.id));
    const spared = await PocketFolder.create(dataset, { name: 'Keep' }, under(root.id));
    await run('pocket.gather', { ref: 'we:n:Qm/CollectionBlock/a', into: inner.id });
    await run('pocket.gather', { ref: 'we:n:Qm/CollectionBlock/b', into: spared.id });

    await store.deleteFolder(doomed.id);

    expect((await model('PocketFolder').findAll(dataset)).map((row) => row.id).sort()).toEqual(
      [root.id, spared.id].sort(),
    );
    expect((await model('PocketItem').findAll(dataset)).map((row) => row.ref)).toEqual(['we:n:Qm/CollectionBlock/b']);
  });
});
