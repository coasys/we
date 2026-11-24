/**
 * Declared operations on the template surface: classified from what they write, never by hand, and
 * reached by a template exactly as far as their writes would be one at a time.
 */
import type { OperationDefinition } from '@we/backend-shared';
import { listOperations, registerOperations, unregisterOperations } from '@we/entities';
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
    expect(entries['demo.post']).toEqual({ group: 'content', destructive: false, ambient: false });
    expect(entries['demo.prune']).toEqual({ group: 'content', destructive: true, ambient: false });
    expect(entries['demo.rename']?.group).toBe('space-settings');
    expect(entries['demo.remember']?.group).toBe('agent');
    expect(entries['demo.peek']).toEqual({ group: 'content', destructive: false, ambient: true });
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
    expect(calls).toEqual([['demo.post', { title: 'Hi' }, { dataset: 'datasetStore.rootDataset' }]]);
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
