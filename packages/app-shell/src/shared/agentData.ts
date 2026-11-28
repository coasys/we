/**
 * The agent-data kernel: what a module with `entities: { scope: 'agent' }` reaches, which is the
 * agent's personal space and nothing else — and the document writes the records kernel shares.
 *
 * Out of `TemplateProvider` so the kernel can be built over the real stores and backend in a test,
 * without the template and theme registries a provider mounts.
 */
import { datasetKey, formatRef } from '@we/backend-shared';
import { type ContentInput, copyableContent, deleteBlocks, reconcileBlocks, writePost } from '@we/block-shared';
import { CollectionBlock, type DatasetProxy } from '@we/entities';
import type { AgentDataKernel, CreateEntityOptions, DocumentAccess, RecordQuery } from '@we/module-shared';

/** A dataset a write can go to: its handle, and what a reference to it is made from. */
export interface WriteTarget {
  id: string;
  sharedUri?: string | null;
  handle: DatasetProxy;
}

/**
 * Composed documents in one dataset — what the records kernel and the agent-data kernel lend as
 * `documents`, each pinned to its own dataset.
 *
 * The same writes the composer's own save makes (`SpaceStore.createPost` / `updatePost`), against
 * whichever dataset the accessor names, which is the one thing those two cannot do: they are
 * pinned to the space on screen, and a note lives in the personal space. The accessor may answer
 * with a promise, for a dataset that is still coming up.
 */
export function documentAccess(
  target: (dataset?: string) => WriteTarget | null | Promise<WriteTarget | null>,
  invoker: () => string | undefined,
): DocumentAccess {
  const collection = async (handle: DatasetProxy, id: string) => CollectionBlock.findOne(handle, { where: { id } });
  return {
    // Through `core.createPost`, as the composer's save and an agent's post are: the agent acting
    // is whoever is signed in, as for every write a module makes.
    create: async (document, options) => {
      const { dataset, kind = 'post', ...placed } = options ?? {};
      const ds = await target(dataset);
      if (!ds) return null;
      const by = invoker();
      if (!by) throw new Error('Sign in to write this.');
      const id = await writePost(ds.handle, document as ContentInput, { invoker: by, kind, ...placed });
      if (!id) return null;
      const key = datasetKey({ cid: ds.sharedUri, uuid: ds.id });
      return { id, ref: formatRef({ datasetKey: key, entity: 'CollectionBlock', id }) };
    },
    update: async (id, document, where) => {
      const ds = await target(where?.dataset);
      const existing = ds && (await collection(ds.handle, id));
      if (!ds || !existing) return;
      await reconcileBlocks(ds.handle, existing, document as ContentInput);
    },
    remove: async (id) => {
      const ds = await target();
      if (ds) await deleteBlocks(ds.handle, id);
    },
    read: async (id) => {
      const ds = await target();
      const existing = ds && (await collection(ds.handle, id));
      // Payloads rather than addresses, and no keys: a fresh composition, ready to be written into a
      // dataset whose file storage and records have never seen it. See `copyableContent`.
      return ds && existing ? copyableContent(ds.handle, existing.editorState) : null;
    },
  };
}

/** Record writes against a handle, as the host makes them for any dataset. */
export interface RecordWrites {
  create: (
    handle: DatasetProxy,
    entity: string,
    fields: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<{ id?: string } | undefined>;
  find: (handle: DatasetProxy, entity: string, query?: RecordQuery) => Promise<Record<string, unknown>[]>;
  update: (handle: DatasetProxy, entity: string, id: string, fields: Record<string, unknown>) => Promise<unknown>;
  remove: (handle: DatasetProxy, entity: string, id: string) => Promise<unknown>;
  /** Run a declared operation in the dataset, as the signed-in agent. */
  run: (handle: DatasetProxy, name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** Who is signed in — the agent a document written here is written as. */
  invoker: () => string | undefined;
}

/** Where the personal space is, as the dataset store holds it. */
export interface PersonalSpaceSource {
  /** The personal space, once its schema is in. */
  personalDataset: () => WriteTarget | null;
  /** Its schema install, from the moment the boot has found it; `null` before. */
  whenPersonalDataset: () => Promise<WriteTarget | null> | null;
}

/**
 * The agent-data kernel over the personal space.
 *
 * Ready once the boot has found the personal space, which is before its schema is in: the app
 * appears first and the schema follows (see `DatasetStore.initPersonalDataset`). A call in between
 * waits for the schema and then runs. Answering "not ready" there instead made a gather or a note
 * in the first seconds after the app appeared do nothing, and say nothing. A schema that fails is a
 * thrown error, which the module reports.
 *
 * Every write names the personal space's handle itself rather than a store path: a path that does
 * not resolve falls back to the space on screen, and that fallback is one person's private records
 * written into a community.
 */
export function agentDataKernel(personal: PersonalSpaceSource, writes: RecordWrites): AgentDataKernel {
  const target = async (): Promise<WriteTarget | null> => {
    const install = personal.whenPersonalDataset();
    if (!install) return null;
    const ds = await install;
    if (!ds) throw new Error('Your personal space could not be loaded, so this was not saved.');
    return ds;
  };
  return {
    ready: () => !!personal.whenPersonalDataset(),
    refKey: () => {
      const ds = personal.personalDataset();
      return ds ? datasetKey({ uuid: ds.id }) : '';
    },
    create: async (entity: string, fields: Record<string, unknown>, options?: CreateEntityOptions) => {
      const ds = await target();
      if (!ds) return null;
      const { dataset: _dataset, ...rest } = (options ?? {}) as Record<string, unknown>;
      return (await writes.create(ds.handle, entity, fields, rest))?.id ?? null;
    },
    find: async (entity, query) => {
      const ds = await target();
      if (!ds) return [];
      return (await writes.find(ds.handle, entity, query)) ?? [];
    },
    update: async (entity, id, fields) => {
      const ds = await target();
      if (ds) await writes.update(ds.handle, entity, id, fields);
    },
    remove: async (entity, id) => {
      const ds = await target();
      if (ds) await writes.remove(ds.handle, entity, id);
    },
    run: async (name, args) => {
      const ds = await target();
      if (!ds) throw new Error(`${name}: your personal space is not open yet`);
      return writes.run(ds.handle, name, args);
    },
    // This agent's own space only: a document naming another dataset is not this kernel's to write.
    documents: documentAccess((dataset) => (dataset ? null : target()), writes.invoker),
  };
}
