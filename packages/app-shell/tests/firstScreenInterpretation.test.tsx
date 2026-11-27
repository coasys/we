/**
 * The interpretation store starts its reads once the first screen is up — and that start is not a
 * change to the space's staged suggestions.
 *
 * `proposalsRevision` tells a module "the suggestions may have moved, ask again", and the Feed reads
 * a move as a change to its window. Bumped when the store merely started later, it made the Feed read
 * its whole window a second time the moment the first page was drawn.
 *
 * A file of its own because the gate is the app's one, and holds once.
 */
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { ModuleHostServices } from '../src/shared/registries/moduleHostServices';

const interpretation = {
  checkAvailability: vi.fn(async () => true),
  observe: vi.fn(async () => () => {}),
  onProposalsChanged: vi.fn(async () => () => {}),
};
const ports = { interpretation };

const deps = {
  sessionStore: { backendPorts: () => ports, me: () => ({ did: 'did:key:z6MkOwn' }) },
  datasetStore: { currentDataset: () => ({ handle: 'space-handle' }) },
  profileStore: { fetchProfile: async () => undefined, profiles: () => [] },
  spaceStore: { autoInterpret: () => false, autoInterpretFor: () => false },
};

let published: ModuleHostServices = {};
vi.mock('../src/shared/registries/moduleHostServices', () => ({
  provideModuleHostServices: (slice: ModuleHostServices) => {
    published = { ...published, ...slice };
    return () => {};
  },
}));

import { firstScreen } from '../src/frameworks/solid/firstScreen';
import { createInterpretationStore } from '../src/frameworks/solid/stores/InterpretationStore';

describe('interpretation while the first screen is coming up', () => {
  it('starts once the first page is drawn, without telling modules the suggestions moved', async () => {
    firstScreen.hold();
    firstScreen.waiting();
    render(() => {
      createInterpretationStore(deps as never);
      return null;
    });

    expect(interpretation.checkAvailability).not.toHaveBeenCalled();
    const revision = published.interpretationProposalsRevision?.();

    firstScreen.answered();
    await vi.waitFor(() => expect(interpretation.checkAvailability).toHaveBeenCalledTimes(1));
    expect(interpretation.onProposalsChanged).toHaveBeenCalledTimes(1);
    expect(published.interpretationProposalsRevision?.()).toBe(revision);
  });
});
