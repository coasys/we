/**
 * Declared operations on the template surface: classified from what they write, never by hand, and
 * reached by a template exactly as far as their writes would be one at a time.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import type { OperationDefinition } from '@we/backend-shared';
import {
  getEntity,
  isOperationError,
  listOperations,
  registerOperations,
  runOperation,
  unregisterOperations,
} from '@we/entities';
import { runWithGesture } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { judgeBundle } from '../src/shared/bundles/judgeBundle';
import { describeDestructive } from '../src/shared/destructiveWording';
import { operationSurfaceEntries } from '../src/shared/registries/operationGroups';
import {
  buildTemplateBag,
  CHROME_TIER,
  inspectTemplateSurface,
  type OperationHost,
  SPACE_TIER,
} from '../src/shared/registries/templateSurface';

const op = (steps: unknown[], extra: Partial<OperationDefinition> = {}): OperationDefinition =>
  ({ description: 'A test.', steps, ...extra }) as OperationDefinition;

const DEMO: Record<string, OperationDefinition> = {
  // Content: a community's own records.
  post: op([{ create: { entity: 'CollectionBlock', fields: { kind: 'post' } } }], {
    params: { title: { type: 'string', required: true } },
  }),
  // Destructive content.
  prune: op([{ delete: { entity: 'CollectionBlock', id: { $: 'id' } } }], {
    description: 'Prune a post.',
    params: { id: { type: 'string', required: true } },
  }),
  // A space's settings, which the space tier holds.
  rename: op([{ update: { entity: 'Space', id: { $: 'id' }, fields: { name: { $: 'name' } } } }]),
  // The agent's own settings, which only chrome holds.
  remember: op([{ update: { entity: 'AgentSettings', id: { $: 'id' }, fields: {} } }]),
  // Writes nothing at all.
  peek: op([{ find: { as: 'all', entity: 'CollectionBlock' } }], { returns: { $: 'all' } }),
};

beforeEach(() => registerOperations('demo', DEMO));
afterEach(() => unregisterOperations('demo'));

const asked = <T>(fn: () => T): T => runWithGesture({ at: {} as Event }, fn);

function host() {
  const calls: [string, unknown, unknown][] = [];
  const ops: OperationHost = {
    run: (name, params, options) => {
      calls.push([name, params, options]);
      return Promise.resolve(`ran ${name}`);
    },
  };
  return { ops, calls };
}

type Bag = { ops: Record<string, Record<string, (...args: unknown[]) => unknown>> };

describe('the surface entry of an operation', () => {
  it('exists for every registered operation, derived from its effects', () => {
    const entries = operationSurfaceEntries();
    expect(Object.keys(entries).sort()).toEqual(listOperations());
    expect(entries['demo.post']).toEqual({ group: 'content', chosen: [], destructive: false, ambient: false });
    expect(entries['demo.prune']).toEqual({ group: 'content', chosen: [], destructive: true, ambient: false });
    expect(entries['demo.rename']?.group).toBe('space-settings');
    expect(entries['demo.remember']?.group).toBe('agent');
    expect(entries['demo.peek']).toEqual({ group: 'content', chosen: [], destructive: false, ambient: true });
  });

  it('follows the registry: a namespace gone is an entry gone', () => {
    unregisterOperations('demo');
    expect(Object.keys(operationSurfaceEntries()).filter((name) => name.startsWith('demo.'))).toEqual([]);
  });
});

describe('a bag', () => {
  it('holds only the operations its grants cover, as the group says', () => {
    const { ops } = host();
    const space = buildTemplateBag({ ops }, { grants: SPACE_TIER }) as unknown as Bag;
    const chrome = buildTemplateBag({ ops }, { grants: CHROME_TIER }) as unknown as Bag;
    expect(Object.keys(space.ops.demo).sort()).toEqual(['peek', 'post', 'prune', 'rename']);
    expect(Object.keys(chrome.ops.demo).sort()).toEqual(['peek', 'post', 'prune', 'remember', 'rename']);
  });

  it('runs one by its own name with the params and only the dataset option', async () => {
    const { ops, calls } = host();
    const bag = buildTemplateBag({ ops }, { grants: SPACE_TIER }) as unknown as Bag;
    await expect(
      bag.ops.demo.post({ title: 'Hi' }, { dataset: 'datasetStore.rootDataset', other: 1 }, 'extra'),
    ).resolves.toBe('ran demo.post');
    expect(calls).toEqual([
      ['demo.post', { title: 'Hi' }, { dataset: 'datasetStore.rootDataset', admitChosen: expect.any(Function) }],
    ]);
  });

  it('refuses a writing operation nobody asked for, and lets one that writes nothing run', async () => {
    const { ops, calls } = host();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bag = buildTemplateBag({ ops }, { grants: SPACE_TIER, gesture: 'enforce' }) as unknown as Bag;
    expect(bag.ops.demo.post({ title: 'x' })).toBeUndefined();
    await bag.ops.demo.peek();
    expect(calls.map(([name]) => name)).toEqual(['demo.peek']);
    await asked(() => bag.ops.demo.post({ title: 'x' }));
    expect(calls.map(([name]) => name)).toEqual(['demo.peek', 'demo.post']);
  });

  it('asks the host before a destructive one, and runs nothing on a no', async () => {
    const { ops, calls } = host();
    const asks: string[] = [];
    const bag = buildTemplateBag(
      { ops },
      {
        grants: SPACE_TIER,
        onDestructive: (path) => {
          asks.push(path);
          return false;
        },
      },
    ) as unknown as Bag;
    await expect(bag.ops.demo.prune({ id: 'p1' })).resolves.toBeUndefined();
    expect(asks).toEqual(['ops.demo.prune']);
    expect(calls).toEqual([]);
  });

  it('sees an operation registered after it was built', () => {
    const { ops } = host();
    const bag = buildTemplateBag({ ops }, { grants: SPACE_TIER }) as unknown as Bag;
    registerOperations('later', { go: DEMO.post });
    try {
      expect(typeof bag.ops.later.go).toBe('function');
    } finally {
      unregisterOperations('later');
    }
  });
});

/*
  A generic write — `core.deleteRecords`, a form over whatever record is in front of it — names no
  entity of its own, so what it needs is decided per call, from the record it is handed: content for a
  post, space settings for a task state, as the two deletes made one at a time would need.
*/
describe('an entity chosen at call time', () => {
  const ME = 'did:test:me';
  let dataset: unknown;
  const model = (name: string) =>
    getEntity(name) as unknown as {
      create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string }>;
      findAll(p: unknown): Promise<{ id: string }[]>;
    };

  beforeEach(async () => {
    const ports = createInMemoryBackendPorts(
      { selfId: () => ME },
      { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-chosen', name: 'Chosen' }] },
    );
    dataset = (await ports.lifecycle.get('ds-chosen'))!.handle;
    await model('CollectionBlock').create(dataset, { kind: 'post', title: 'Hello' }, { id: 'post' });
    await model('TaskState').create(dataset, { name: 'Blocked', slug: 'blocked' }, { id: 'state' });
  });

  /** The host as the app lends it: the real runner, with the bag's judgement of a chosen entity. */
  const realHost: OperationHost = {
    run: (name, params, options) =>
      runOperation(name, params, {
        dataset: dataset as never,
        invoker: ME,
        ...(options?.admitChosen ? { admitChosen: options.admitChosen } : {}),
      }),
  };
  const remove = (bag: Bag, entity: string, id: string) =>
    asked(() => bag.ops.core.deleteRecords({ records: [{ entity, id }] }) as Promise<unknown>);

  it('is recorded in the summary as a category, and holding the operation needs only its named writes', () => {
    const entry = operationSurfaceEntries()['core.deleteRecords'];
    expect(entry).toMatchObject({ group: 'content', chosen: ['any'], destructive: true });
  });

  it('takes its group from the entity passed: a content bag deletes a post and is refused a task state', async () => {
    const bag = buildTemplateBag({ ops: realHost }, { grants: ['content'] }) as unknown as Bag;
    await remove(bag, 'CollectionBlock', 'post');
    expect(await model('CollectionBlock').findAll(dataset)).toEqual([]);

    const refused = await remove(bag, 'TaskState', 'state').catch((error: unknown) => error);
    expect(isOperationError(refused) && [refused.class, refused.code]).toEqual(['static', 'notGranted']);
    expect((await model('TaskState').findAll(dataset)).map((row) => row.id)).toEqual(['state']);
  });

  it('is allowed the settings entity where the bag holds the group', async () => {
    const bag = buildTemplateBag({ ops: realHost }, { grants: SPACE_TIER }) as unknown as Bag;
    await remove(bag, 'TaskState', 'state');
    expect(await model('TaskState').findAll(dataset)).toEqual([]);
  });

  it('never reaches a chrome entity from a space template, whatever the operation names', async () => {
    await model('AgentSettings').create(dataset, {}, { id: 'mine' });
    const bag = buildTemplateBag({ ops: realHost }, { grants: SPACE_TIER }) as unknown as Bag;
    const refused = await remove(bag, 'AgentSettings', 'mine').catch((error: unknown) => error);
    expect(isOperationError(refused) && refused.code).toBe('notGranted');
  });
});

const press = (invoke: string) => ({
  type: 'we-button',
  props: { onClick: { $invoke: invoke, args: [{}] } },
});

describe('inspecting a template', () => {
  it('classifies an operation by its derived group, and blocks one past the tier', () => {
    const inspected = inspectTemplateSurface(
      { type: 'Column', children: [press('ops.demo.post'), press('ops.demo.remember'), press('ops.demo.nope')] },
      SPACE_TIER,
    );
    expect(inspected.allowed.map((r) => r.path)).toEqual(['ops.demo.post']);
    expect(inspected.blocked).toEqual([
      { path: 'ops.demo.remember', via: 'action', group: 'agent' },
      { path: 'ops.demo.nope', via: 'action', group: null },
    ]);
  });
});

describe('a bundle invoking its own operations', () => {
  it('is judged with them, before they are registered', () => {
    const judged = judgeBundle(
      {
        format: 2,
        id: 'birding',
        version: '1.0.0',
        name: 'Birding',
        templates: [
          {
            id: 'shell',
            type: 'Column',
            meta: { name: 'Birding', description: '', icon: 'bird' },
            children: [press('ops.birding.log')],
          },
        ],
        operations: { log: DEMO.post },
      } as never,
      {
        requiredBy: () => [],
        hasModule: () => true,
        moduleInstalled: () => true,
        moduleName: (id) => id,
        vocabulary: {
          CollectionBlock: { properties: { kind: { type: 'string' } }, relations: {} },
        } as never,
      },
    );
    expect(judged.blocked).toEqual([]);
    expect(judged.adds.operations).toEqual(['birding.log']);
  });
});

describe('the host’s question before a destructive operation', () => {
  it('is worded from the definition and its effects', () => {
    expect(describeDestructive('ops.demo.prune', [{ id: 'p1' }])).toEqual({
      title: 'Prune a post?',
      body: 'It deletes a CollectionBlock (destructive). This cannot be undone.',
    });
  });
});
