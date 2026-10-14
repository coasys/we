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
