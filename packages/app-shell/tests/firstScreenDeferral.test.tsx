/**
 * What waits for the first screen, on the host's side: a store's reads that the first page does not
 * draw start once it is up, and start correctly then. The gate itself is in `firstScreen.test.ts`.
 *
 * A file of its own because the gate is the app's one, and holds once: a held gate here would leak
 * into every other case in a shared file.
 */
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

const OWN = 'did:key:z6MkOwn';
const OTHER = 'did:key:z6MkOther';

const profilePort = {
  get: vi.fn(async (did: string) => ({ did, firstName: did === OWN ? 'Me' : 'Them', lastName: '', handle: '' })),
  publish: async () => {},
  uploadFile: async () => 'expression://x',
};
const sessionStub = {
  me: () => ({ did: OWN }),
  backendPorts: () => ({ profiles: profilePort }),
  bootState: () => 'ready',
};

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({ useSessionStore: () => sessionStub }));
vi.mock('../src/frameworks/solid/stores/AccountStore', () => ({
  useAccountStore: () => ({ syncDisplay: async () => {} }),
}));
vi.mock('../src/frameworks/solid/stores/RuntimeStore', () => ({
  useRuntimeStore: () => ({ openAiStep: async () => false }),
}));

import { firstScreen } from '../src/frameworks/solid/firstScreen';
import { type ProfileStore, ProfileStoreProvider, useProfileStore } from '../src/frameworks/solid/stores/ProfileStore';

function mount(): ProfileStore {
  let store!: ProfileStore;
  function Capture() {
    store = useProfileStore();
    return null;
  }
  render(() => (
    <ProfileStoreProvider>
      <Capture />
    </ProfileStoreProvider>
  ));
  return store;
}

describe('profiles while the first screen is coming up', () => {
  it('reads this agent’s own at once, and somebody else’s once the first page is drawn', async () => {
    firstScreen.hold();
    firstScreen.waiting();
    const store = mount();

    void store.fetchProfile(OWN);
    const other = store.fetchProfile(OTHER);
    expect(profilePort.get.mock.calls.map(([did]) => did)).toEqual([OWN]);

    // Asked twice while held, read once when it opens.
    void store.fetchProfile(OTHER);

    firstScreen.answered();
    await other;
    expect(profilePort.get.mock.calls.map(([did]) => did)).toEqual([OWN, OTHER]);
    expect(store.profiles().find((p) => p.did === OTHER)?.firstName).toBe('Them');
  });
});
