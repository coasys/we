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
import { describe, expect, it, vi } from 'vitest';

const dataset = { id: 'space-1' };
const workflowPort = createInMemoryWorkflowPort(() => 'did:test:me');

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:test:me' }), backendPorts: () => ({ workflows: workflowPort }) }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({ isWeSpace: () => true, currentDataset: () => ({ id: dataset.id, handle: dataset }) }),
}));
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
