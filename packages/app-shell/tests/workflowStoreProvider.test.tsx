/**
 * The workflow store, mounted.
 *
 * Its logic lives in pure modules with their own tests, but the provider wires those together with
 * memos, and a memo runs the moment it is made. One that read a signal declared further down the
 * file crashed the whole app at boot ("Cannot read properties of undefined (reading 'filter')"),
 * and nothing caught it, because nothing mounted the provider. This does.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryWorkflowPort } from '@we/backend-inmemory';
import type { WorkflowDefinition } from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const dataset = { id: 'space-1' };
/** The foreign-schema snapshot the dataset store reads on navigation. */
const [foreignModels, setForeignModels] = createSignal<unknown[]>([]);
/** The models the space has adopted, as the shape store publishes them. */
const [adoptedShapes, setAdoptedShapes] = createSignal<unknown[]>([]);
/** A space's own models, which exist for its dataset only once registered. */
const OWN_MODELS = new Set(['Proposal', 'Sighting', 'Pitch', 'Memo']);
const registered = new Set<string>();
/** How many more `findAll` calls on a model throw, as a dropped connection would. */
const failing = new Map<string, number>();
/** The records each model finds, by entity — what a `findAll` by id answers with. */
const stored: Record<string, Record<string, unknown>[]> = {};
const workflowPort = createInMemoryWorkflowPort(() => 'did:test:me');

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:test:me' }), backendPorts: () => ({ workflows: workflowPort }) }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({
    isWeSpace: () => true,
    currentDataset: () => ({ id: dataset.id, handle: dataset }),
    currentDatasetEntities: foreignModels,
  }),
}));
vi.mock('../src/frameworks/solid/stores/ShapeStore', () => ({
  useShapeStore: () => ({ spaceShapes: adoptedShapes }),
}));
vi.mock('@we/entities', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEntityForDataset: (entity: string) =>
    OWN_MODELS.has(entity) && !registered.has(entity)
      ? undefined
      : {
          findAll: async (_d: unknown, q: { where: { id: string[] } }) => {
            const left = failing.get(entity) ?? 0;
            if (left > 0) {
              failing.set(entity, left - 1);
              throw new Error('connection dropped');
            }
            return (stored[entity] ?? []).filter((row) => q.where.id.includes(row.id as string));
          },
        },
}));

/** A model the space adopted, as `spaceShapes` lists it. */
const shape = (name: string, properties: Record<string, unknown>, display?: Record<string, string>) => ({
  id: `shape-${name}`,
  name,
  manifest: { entities: { [name]: { properties, ...(display ? { display } : {}) } } },
  problems: [],
});

/** Mounts the store with a workflow over `record` started and open. */
async function openOn(workflow: string, record: string, entities: string[] = []): Promise<WorkflowStore> {
  await workflowPort.install(dataset, { ...REVIEW, name: workflow, entities });
  const store = mount();
  await vi.waitFor(() => expect(store.startable().map((f) => f.name)).toContain(workflow));
  await store.startWorkflow(workflow, record);
  await store.openWorkflow(workflow);
  return store;
}
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({
    taskStates: () => [],
    involvementTypes: () => [],
    archivedWorkflows: () => [],
    canAdministerCurrentSpace: () => true,
  }),
}));

import {
  useWorkflowStore,
  type WorkflowStore,
  WorkflowStoreProvider,
} from '../src/frameworks/solid/stores/WorkflowStore';

function mount(): WorkflowStore {
  let store!: WorkflowStore;
  function Capture() {
    store = useWorkflowStore();
    return null;
  }
  render(() => (
    <WorkflowStoreProvider>
      <Capture />
    </WorkflowStoreProvider>
  ));
  return store;
}

const REVIEW: WorkflowDefinition = {
  name: 'review',
  entities: [],
  states: [{ name: 'draft' }, { name: 'published' }],
  transitions: [{ from: 'draft', to: 'published' }],
};

describe('the workflow store, mounted', () => {
  it('mounts, and lists a workflow with its steps and moves', async () => {
    await workflowPort.install(dataset, REVIEW);
    const store = mount();

    await vi.waitFor(() => expect(store.workflows().map((f) => f.name)).toEqual(['review']));
    await vi.waitFor(() =>
      expect(store.workflows()[0]).toMatchObject({
        steps: [
          { name: 'draft', final: false },
          { name: 'published', final: true },
        ],
        moves: [{ from: 'draft', to: 'published' }],
      }),
    );
    expect(store.startable().map((f) => f.name)).toEqual(['review']);
  });
});

describe('the list, loading', () => {
  // On a shared node the list takes seconds, and an empty list before it answers read as "no workflows".
  it('says it has not answered until it has', async () => {
    const store = mount();
    expect(store.workflowsLoaded()).toBe(false);
    await vi.waitFor(() => expect(store.workflowsLoaded()).toBe(true));
  });
});

describe('a record, from its inspector', () => {
  // So a record can be moved where it is, rather than only from the Workflows page.
  it('says where it can be moved next', async () => {
    await workflowPort.install(dataset, REVIEW);
    const store = mount();
    await vi.waitFor(() => expect(store.startable().map((f) => f.name)).toContain('review'));
    await store.startWorkflow('review', 'r1');
    await vi.waitFor(() =>
      expect(store.recordWorkflows()['r1']?.[0]).toMatchObject({ next: [{ name: 'published' }], asks: [] }),
    );
  });
});

describe('edits a form submits', () => {
  // A form closes in its action's `onSuccess`, which only fires for a promise, so an edit that
  // returned nothing left every one of the workflow editor's dialogs open after it had done its work.
  it('resolves when the edit applies, so the form closes', async () => {
    const store = mount();
    await expect(store.newWorkflow('blank', 'Checks')).resolves.toBeUndefined();
    expect(store.draft()?.label).toBe('Checks');
    await expect(store.addStep(0, 'Review', 'start')).resolves.toBeUndefined();
  });

  it('rejects when the edit is refused, so the form stays open with what was typed', async () => {
    const store = mount();
    await store.newWorkflow('blank', 'Checks');
    await store.addStep(0, 'Review', 'start');
    await expect(store.addStep(0, 'Review', 'start')).rejects.toThrow();
  });
});

describe('a requirement the form adds', () => {
  it('stores "a comment" as a reply post, said in words', async () => {
    const store = mount();
    await store.newWorkflow('blank', 'Checks');
    await store.addEvidence('done', 'comment', 'responses');
    const done = store
      .draft()
      ?.lanes.flatMap((lane) => lane.steps)
      .find((step) => step.name === 'done');
    expect(done?.requires).toContain('at least 1 comment in response to it');
    // The key alone would read the same in words; what matters is the record it asks for.
    expect(done?.evidence).toEqual([expect.objectContaining({ entity: 'CollectionBlock', via: 'responses' })]);
  });
});

describe('the records running through a flow', () => {
  const COUNTED: WorkflowDefinition = { ...REVIEW, name: 'counted' };

  // A record at a final step has finished: Flows in the space tree counts what is running, not every
  // record that ever went through.
  it('leaves out records at a final step', async () => {
    await workflowPort.install(dataset, COUNTED);
    await workflowPort.start(dataset, 'counted', 'c1');
    await workflowPort.start(dataset, 'counted', 'c2');
    await workflowPort.move(dataset, 'counted', 'c2', 'published');
    const store = mount();
    await vi.waitFor(() => expect(store.workflows().find((f) => f.name === 'counted')?.running).toBe(1));
  });

  // The list is read once, so a count copied from it never moved: a run started here, or by
  // somebody else, has to show from the watched records.
  it('follows a run started here and one started by somebody else, with no refresh', async () => {
    const LIVE: WorkflowDefinition = { ...REVIEW, name: 'live' };
    await workflowPort.install(dataset, LIVE);
    const store = mount();
    await vi.waitFor(() => expect(store.workflows().find((f) => f.name === 'live')?.running).toBe(0));
    await store.startWorkflow('live', 'l1');
    await vi.waitFor(() => expect(store.workflows().find((f) => f.name === 'live')?.running).toBe(1));
    await workflowPort.start(dataset, 'live', 'l2');
    await vi.waitFor(() => expect(store.workflows().find((f) => f.name === 'live')?.running).toBe(2));
    await store.moveRecord('live', 'l1', 'published');
    await vi.waitFor(() => expect(store.workflows().find((f) => f.name === 'live')?.running).toBe(1));
  });
});

describe('what is going on across the flows', () => {
  const STAGED: WorkflowDefinition = {
    name: 'staged',
    entities: [],
    states: [{ name: 'draft' }, { name: 'review' }, { name: 'published' }],
    transitions: [
      { from: 'draft', to: 'review' },
      { from: 'review', to: 'published' },
    ],
  };

  // The space tree lists every running record, the liveliest first: a run moved since another started
  // comes before it, and one at a final step has finished and is not listed.
  it('lists the records still running, the one with the latest activity first, finished ones left out', async () => {
    await workflowPort.install(dataset, STAGED);
    const store = mount();
    await vi.waitFor(() => expect(store.startable().map((f) => f.name)).toContain('staged'));
    await store.startWorkflow('staged', 'a1');
    await store.startWorkflow('staged', 'a2');
    await store.moveRecord('staged', 'a1', 'review');
    await workflowPort.start(dataset, 'staged', 'a3', { at: 'published' });

    const staged = () => store.active().filter((row) => row.workflow === 'staged');
    await vi.waitFor(() => expect(staged().map((row) => row.record)).toEqual(['a1', 'a2']));
    expect(staged()[0]).toMatchObject({ label: 'Staged', state: 'review', stateLabel: 'Review', waiting: 0 });
    expect(staged()[0]?.lastActivity).toMatch(/^\d{4}-/);
  });

  // Only the open workflow's records were named, so a list across every flow read "Record 3f9a2c".
  it('names a record of a workflow nobody has opened', async () => {
    stored.TaskBlock = [{ id: 'n1', title: 'Fix the roof' }];
    await workflowPort.install(dataset, { ...STAGED, name: 'unopened' });
    const store = mount();
    await vi.waitFor(() => expect(store.startable().map((f) => f.name)).toContain('unopened'));
    await workflowPort.start(dataset, 'unopened', 'n1');
    await vi.waitFor(() =>
      expect(store.active().find((row) => row.record === 'n1')).toMatchObject({ title: 'Fix the roof', kind: 'Task' }),
    );
    expect(store.open()).toBeNull();
  });
});

describe('a record going through the open workflow', () => {
  // Every row read "Untitled": a record of the space's own model was looked for before that model was
  // registered, the miss was kept for good, and its naming field was not one the store knew.
  it("is named by its model's naming field once the space's models are read", async () => {
    stored.Proposal = [{ id: 'r9', headline: 'Fix the roof' }];
    const store = await openOn('proposals', 'r9');
    await vi.waitFor(() => expect(store.open()?.records.map((r) => r.title)).toEqual(['Record r9']));

    registered.add('Proposal');
    setForeignModels([
      {
        name: 'Proposal',
        targetClass: 'Proposal',
        properties: [
          {
            name: 'headline',
            predicate: 'x://headline',
            type: 'string',
            isCollection: false,
            required: true,
            writable: true,
          },
        ],
      },
    ]);
    await vi.waitFor(() =>
      expect(store.open()?.records[0]).toMatchObject({ title: 'Fix the roof', kind: 'Proposal', stateLabel: 'Draft' }),
    );
  });

  // The foreign snapshot is read on navigation; a model made in this session is only in `spaceShapes`.
  it('is found in a model the space adopts after its models were read', async () => {
    stored.Sighting = [{ id: 's1', title: 'Saw a fox' }];
    const store = await openOn('sightings', 's1');
    await vi.waitFor(() => expect(store.open()?.records.map((r) => r.title)).toEqual(['Record s1']));

    registered.add('Sighting');
    setAdoptedShapes([...adoptedShapes(), shape('Sighting', { title: { type: 'string' } })]);
    await vi.waitFor(() => expect(store.open()?.records[0]).toMatchObject({ title: 'Saw a fox', kind: 'Sighting' }));
  });

  // `buildEntityManifest` names no property, so a declared title has to come from the adopted shape.
  it('is named by the field its model declares as its title, not the one called title', async () => {
    stored.Pitch = [{ id: 'p1', title: 'internal ref', headline: 'Fix the roof' }];
    registered.add('Pitch');
    setAdoptedShapes([
      ...adoptedShapes(),
      shape('Pitch', { title: { type: 'string' }, headline: { type: 'string' } }, { title: 'headline' }),
    ]);
    const store = await openOn('pitches', 'p1');
    await vi.waitFor(() => expect(store.open()?.records[0]).toMatchObject({ kind: 'Pitch' }));
    expect(store.open()?.records[0]?.title).toBe('Fix the roof');
  });

  // A failed read is not an answer: the record is looked for again rather than kept as a miss.
  it('is looked for again after a read that failed', async () => {
    stored.Memo = [{ id: 'm1', title: 'Rent is due' }];
    registered.add('Memo');
    // Opening reads the definition again, which runs the lookup twice: both fail.
    failing.set('Memo', 2);
    const store = await openOn('memos', 'm1', ['Memo']);
    await vi.waitFor(() => expect(failing.get('Memo')).toBe(0));
    expect(store.open()?.records[0]?.title).toBe('Record m1');

    // The run moving is the next time the list changes; the record is looked for again then.
    await store.moveRecord('memos', 'm1', 'published');
    await vi.waitFor(() => expect(store.open()?.records[0]?.title).toBe('Rent is due'));
  });
});
