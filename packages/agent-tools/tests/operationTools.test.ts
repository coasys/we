/**
 * Declared operations as an agent's tools, against a real backend: listed from the registry, run
 * through the one runner as the person the conversation acts for.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import type { OperationDefinition } from '@we/backend-shared';
import { getEntity, registerOperations, unregisterOperations } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDataToolset } from '../src/data/dataToolset';

type Row = Record<string, unknown> & { id: string };
type Model = {
  create(dataset: unknown, data: Record<string, unknown>): Promise<Row>;
  findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Row[]>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

const OPERATIONS: Record<string, OperationDefinition> = {
  addTask: {
    description: 'Add a task to a collection.',
    params: {
      collection: { type: 'string', required: true, description: 'where it goes' },
      title: { type: 'string', required: true },
    },
    steps: [
      {
        create: {
          as: 'task',
          entity: 'TaskBlock',
          fields: { title: { $: 'title' } },
          parent: { id: { $: 'collection' }, relation: 'children', entity: 'CollectionBlock' },
        },
      },
    ],
    returns: { $: 'task.id' },
  },
  dropTask: {
    description: 'Delete a task.',
    params: { id: { type: 'string', required: true } },
    steps: [{ delete: { entity: 'TaskBlock', id: { $: 'id' } } }],
  },
};

let dataset: unknown;
let rootId: string;

beforeEach(async () => {
  registerOperations('demo', OPERATIONS);
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'space', name: 'Allotment' }] },
  );
  dataset = (await ports.lifecycle.get('space'))!.handle;
  rootId = (await model('CollectionBlock').create(dataset, { kind: 'space', mode: 'feed' })).id;
});

afterEach(() => unregisterOperations('demo'));

const tools = () => createDataToolset({ dataset, invoker: 'did:test:me' });

describe('the operation tools', () => {
  it('are offered beside the record tools', () => {
    expect(tools().tools.map((t) => t.name)).toEqual(expect.arrayContaining(['list_operations', 'run_operation']));
  });

  it('list every registered operation with its params and what it writes', async () => {
    const { text } = await tools().call('list_operations', {});
    expect(text).toContain('- demo.addTask — Add a task to a collection.');
    expect(text).toContain('params: collection (string, required) where it goes; title (string, required)');
    expect(text).toContain('writes: adds to CollectionBlock.children; creates a TaskBlock; answers with a value');
    expect(text).toContain('- demo.dropTask — Delete a task.');
  });

  it('run one as the person, and answer with what it returns', async () => {
    const { text } = await tools().call('run_operation', {
      name: 'demo.addTask',
      args: { collection: rootId, title: 'Buy paint' },
    });
    const [task] = await model('TaskBlock').findAll(dataset);
    expect(task?.title).toBe('Buy paint');
    expect(text).toBe(`Ran demo.addTask. It answered: ${JSON.stringify(task?.id)}`);
  });

  it('say what went wrong in words the model can act on', async () => {
    expect((await tools().call('run_operation', { name: 'demo.nope' })).text).toMatch(
      /^Error: There is no operation called "demo.nope"/,
    );
    const missing = await tools().call('run_operation', { name: 'demo.addTask', args: { title: 'x' } });
    expect(missing.text).toMatch(/^Error: demo.addTask did not run \(static badArgs\)/);
  });

  it('ask the person before one that deletes, in the host’s words', () => {
    const run = tools().tools.find((t) => t.name === 'run_operation')!;
    expect(run.confirm?.({ name: 'demo.dropTask' })).toBe('Delete a task? It deletes a TaskBlock (destructive).');
    expect(run.confirm?.({ name: 'demo.addTask' })).toBeUndefined();
  });
});

describe('a record whose creation has rules', () => {
  it('is made by the operation holding them: one reaction per person per type, replaced', async () => {
    const post = await model('CollectionBlock').create(dataset, { kind: 'post' });
    const react = (value: number) =>
      tools().call('create_record', { entity: 'Signal', fields: { signalTypeId: 'like', value }, on: post.id });
    const first = await react(1);
    const second = await react(2);
    const signals = await model('Signal').findAll(dataset);
    expect(signals.map((s) => s.value)).toEqual([2]);
    expect(first.text).toBe(`Made a Signal: ${signals[0]!.id}.`);
    expect(second.wrote).toEqual([{ entity: 'Signal', id: signals[0]!.id, change: 'created' }]);
  });

  it('says what it needs, and what the rules refused', async () => {
    const missing = await tools().call('create_record', {
      entity: 'Signal',
      fields: { signalTypeId: 'like', value: 1 },
    });
    expect(missing.text).toMatch(/^Error: A Signal needs `on`/);
    const refused = await tools().call('create_record', {
      entity: 'Involvement',
      fields: { agent: 'did:test:ana', kind: 'shepherd' },
      on: rootId,
    });
    expect(refused.text).toBe('Error: The Involvement was not made: That is not a kind of involvement this space has.');
  });
});
