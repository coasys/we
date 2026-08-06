/**
 * ProfileStore: a local write always beats a fetch that was already in flight.
 *
 * The ordering matters most on a first run, and that is exactly where it broke. The unlock handler
 * fires `fetchProfile` for an agent whose profile has not been published yet, so it reads an empty
 * one; setup writes the name a moment later. If the stale response is allowed to land, the name
 * disappears until the app is reloaded — which is what happened, because the two events shared a
 * millisecond and the guard compared timestamps with a strict `>`.
 */
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DID = 'did:key:z6MkTest';

const sessionStub = {
  me: () => ({ did: DID }),
  backendPorts: () => ({ profiles: profilePort }),
};
const accountsStub = { syncDisplay: async () => {} };

let profilePort: {
  get: (did: string) => Promise<unknown>;
  publish: (fields: unknown) => Promise<void>;
  uploadFile: (data: string) => Promise<string>;
};

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({ useSessionStore: () => sessionStub }));
vi.mock('../src/frameworks/solid/stores/AccountStore', () => ({ useAccountStore: () => accountsStub }));

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

const emptyProfile = { did: DID, firstName: '', lastName: '', handle: '', bio: '' };

beforeEach(() => {
  vi.restoreAllMocks();
  profilePort = {
    get: async () => emptyProfile,
    publish: async () => {},
    uploadFile: async () => 'expression://x',
  };
});

describe('a fetch that started before a local write', () => {
  it('does not overwrite the write, however close together they land', async () => {
    // The clock is frozen to force the case that actually broke: the fetch is fired at the tail of
    // the unlock handler and the name is written as soon as that handler returns, so in practice
    // both fall in one millisecond. Left to run, this test passes or fails on whether the two calls
    // happen to straddle a tick — it passed against the broken implementation for that reason.
    // Nothing in the fix reads a clock; this only pins the scenario.
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    let land!: (summary: unknown) => void;
    profilePort.get = () => new Promise((resolve) => (land = resolve));

    const store = mount();
    void store.fetchProfile(DID); // in flight, reading a profile that does not exist yet
    await store.updateOwnProfile({ firstName: 'James' });

    // The fetch now answers with what it read before the name was written.
    land(emptyProfile);
    await vi.waitFor(() => expect(store.ownProfile()).toBeDefined());

    expect(store.ownProfile()?.firstName).toBe('James');
  });

  it('still accepts a fetch that finishes with no local write in between', async () => {
    // The guard has to be narrow: dropping every response would leave a profile that never loads.
    profilePort.get = async () => ({ ...emptyProfile, firstName: 'Fetched' });

    const store = mount();
    await store.fetchProfile(DID);

    expect(store.ownProfile()?.firstName).toBe('Fetched');
  });
});
