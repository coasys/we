/**
 * The flow store, mounted.
 *
 * Its logic lives in pure modules with their own tests, but the provider wires those together with
 * memos, and a memo runs the moment it is made. One that read a signal declared further down the
 * file crashed the whole app at boot ("Cannot read properties of undefined (reading 'filter')"),
 * and nothing caught it, because nothing mounted the provider. This does.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryFlowPort } from '@we/backend-inmemory';
import type { FlowDefinition } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

const dataset = { id: 'space-1' };
const flowPort = createInMemoryFlowPort(() => 'did:test:me');

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:test:me' }), backendPorts: () => ({ flows: flowPort }) }),
}));
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({ isWeSpace: () => true, currentDataset: () => ({ id: dataset.id, handle: dataset }) }),
}));
vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({
    taskStates: () => [],
    involvementTypes: () => [],
    archivedFlows: () => [],
    canAdministerCurrentSpace: () => true,
  }),
}));

import { type FlowStore, FlowStoreProvider, useFlowStore } from '../src/frameworks/solid/stores/FlowStore';

function mount(): FlowStore {
  let store!: FlowStore;
  function Capture() {
    store = useFlowStore();
    return null;
  }
  render(() => (
    <FlowStoreProvider>
      <Capture />
    </FlowStoreProvider>
  ));
  return store;
}

const REVIEW: FlowDefinition = {
  name: 'review',
  subjects: [],
  states: [{ name: 'draft' }, { name: 'published' }],
  transitions: [{ from: 'draft', to: 'published' }],
};

describe('the flow store, mounted', () => {
  it('mounts, and lists a flow with its steps and moves', async () => {
    await flowPort.install(dataset, REVIEW);
    const store = mount();

    await vi.waitFor(() => expect(store.flows().map((f) => f.name)).toEqual(['review']));
    await vi.waitFor(() =>
      expect(store.flows()[0]).toMatchObject({
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
  // On a shared node the list takes seconds, and an empty list before it answers read as "no flows".
  it('says it has not answered until it has', async () => {
    const store = mount();
    expect(store.flowsLoaded()).toBe(false);
    await vi.waitFor(() => expect(store.flowsLoaded()).toBe(true));
  });
});

describe('edits a form submits', () => {
  // A form closes in its action's `onSuccess`, which only fires for a promise, so an edit that
  // returned nothing left every one of the flow editor's dialogs open after it had done its work.
  it('resolves when the edit applies, so the form closes', async () => {
    const store = mount();
    await expect(store.newFlow('blank', 'Checks')).resolves.toBeUndefined();
    expect(store.draft()?.label).toBe('Checks');
    await expect(store.addStep(0, 'Review', 'start')).resolves.toBeUndefined();
  });

  it('rejects when the edit is refused, so the form stays open with what was typed', async () => {
    const store = mount();
    await store.newFlow('blank', 'Checks');
    await store.addStep(0, 'Review', 'start');
    await expect(store.addStep(0, 'Review', 'start')).rejects.toThrow();
  });
});
