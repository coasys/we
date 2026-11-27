/**
 * A schema reading real records, with declared operations invoked the way the host invokes them.
 *
 * Every other scenario reads a table a scenario seeds and stubs the writes. This one runs the whole
 * path a press takes: the template's `ops.*` handler, the host's `invokeOperation` (a speculative
 * run, then the real one), the entities of the in-memory backend, and the renderer's data bindings
 * with the predicted writes laid over them. The real run waits until the case says it may land, so
 * a case can look at the screen while the write is still on its way — which is the only moment
 * drawing it before it lands is visible at all.
 */
import { invokeOperation } from '@shared/invokeOperation';
import { withPredictedReads } from '@shared/predictedBindings';
import { buildTemplateBag, SPACE_TIER } from '@shared/registries/templateSurface';
import { hostSourceBag } from '@shared/sources';
import { componentRegistry } from '@solid/registries/componentRegistry';
import { createInMemoryBackendPorts, runInMemoryTransaction } from '@we/backend-inmemory';
import { clearPredictions, getEntity, registerTransactionRunner } from '@we/entities';
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { giveSignal } from '@we/template-kit';
import { render } from 'solid-js/web';

const ME = 'did:me';

type Row = Record<string, unknown> & { id: string };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(dataset: unknown, fields: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
  };

/** Real runs waiting to land, released by `land`. */
let waiting: (() => void)[] = [];
let held = true;
let dispose: (() => void) | undefined;
let invoke: ((name: string, params: Record<string, unknown>) => Promise<unknown>) | undefined;

/** The records a case addresses, by name. */
export type ProbeIds = Record<string, string>;

async function seed(kind: 'reaction' | 'board', dataset: unknown): Promise<{ node: SchemaNode; ids: ProbeIds }> {
  if (kind === 'reaction') {
    const post = await model('CollectionBlock').create(dataset, { kind: 'post', title: 'A post' });
    const like = await model('SignalType').create(dataset, { name: 'Like', slug: 'like', mode: 'toggle' });
    const mine = `count(filter(row.signals, { signalTypeId: '${like.id}', author: me.did }))`;
    const node: SchemaNode = {
      type: 'Column',
      $queries: {
        posts: { entity: 'CollectionBlock', where: { kind: 'post' }, include: { signals: true } },
      },
      children: [
        {
          type: '$each',
          props: { items: { $: 'local.posts' }, as: 'row' },
          children: [
            {
              type: 'we-button',
              // A toggle's press, as the kit's reaction mark writes it: give it, or take it back.
              props: { onClick: giveSignal('row.id', `'${like.id}'`, `(${mine} ? null : 1)`) },
              children: [{ $: `'likes ' + count(row.signals) + ' mine ' + ${mine}` }],
            },
          ],
        },
      ],
    };
    return { node, ids: { post: post.id, like: like.id } };
  }

  const one = await model('TaskBlock').create(dataset, { title: 'Task one' });
  const todo = await model('CollectionBlock').create(dataset, { kind: 'column', title: 'A todo', arranges: [one.id] });
  const doing = await model('CollectionBlock').create(dataset, { kind: 'column', title: 'B doing' });
  const board = await model('CollectionBlock').create(dataset, {
    kind: 'board',
    title: 'Board',
    children: [todo.id, doing.id],
  });
  const node: SchemaNode = {
    type: 'Column',
    $queries: {
      columns: {
        entity: 'CollectionBlock',
        where: { kind: 'column' },
        include: { arranges: true },
        order: { title: 'asc' },
      },
      board: { entity: 'CollectionBlock', where: { kind: 'board' }, include: { children: true } },
    },
    children: [
      { type: 'we-text', children: [{ $: "'order ' + join(first(local.board).children.map(c, c.title), ',')" }] },
      {
        type: '$each',
        props: { items: { $: 'local.columns' }, as: 'col' },
        children: [
          { type: 'we-text', children: [{ $: "col.title + ': ' + join(col.arranges.map(c, c.title), ',')" }] },
        ],
      },
    ],
  };
  return { node, ids: { card: one.id, todo: todo.id, doing: doing.id, board: board.id } };
}

/** Mount the probe's schema over a fresh in-memory dataset, real runs held. Resolves with the ids it seeded. */
export async function operationsProbe(kind: 'reaction' | 'board'): Promise<ProbeIds> {
  dispose?.();
  clearPredictions();
  waiting = [];
  held = true;
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-probe', name: 'Probe' }] },
  );
  const dataset = (await ports.lifecycle.get('ds-probe'))!.handle;
  const { node, ids } = await seed(kind, dataset);

  // Seeded first, then every later write group waits its turn to land.
  registerTransactionRunner((ds, fn) =>
    held
      ? new Promise<void>((resolve) => waiting.push(resolve)).then(() => runInMemoryTransaction(ds, fn))
      : runInMemoryTransaction(ds, fn),
  );

  const bindings = withPredictedReads(
    ports.dataBindings({
      currentDataset: () => dataset,
      currentDatasetEntities: () => [],
      profiles: () => [],
      profileFor: () => undefined,
      fetchProfile: async () => undefined,
      ephemeral: ports.ephemeral,
    } as never),
  );
  invoke = (name, params) => invokeOperation(name, params, { dataset, invoker: ME });
  const stores = {
    ...bindings,
    $me: { did: ME },
    $sources: hostSourceBag(),
    ops: { run: (name: string, params?: Record<string, unknown>) => invoke!(name, params ?? {}) },
  };

  const host = document.getElementById('mount') as HTMLElement;
  host.innerHTML = '';
  host.style.width = '420px';
  // The bag a space template is handed, which is what turns `ops.core.<name>` into a call of `ops.run`.
  const bag = buildTemplateBag(stores, { grants: SPACE_TIER, gesture: 'enforce' });
  dispose = render(() => RenderSchema({ node, stores: bag, registry: componentRegistry } as never) as never, host);
  return ids;
}

/** Invoke an operation as a template does, without waiting for it — it lands when `operationsLand` says. */
export function operationsInvoke(name: string, params: Record<string, unknown>): void {
  void invoke?.(name, params).catch(() => undefined);
}

/** Let every held real run land, and every later one land at once. */
export function operationsLand(): void {
  held = false;
  for (const go of waiting.splice(0)) go();
}

/** Hold the real runs again, for the next press. */
export function operationsHold(): void {
  held = true;
}
