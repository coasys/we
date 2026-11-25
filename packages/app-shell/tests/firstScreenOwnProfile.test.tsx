/**
 * This agent's own profile, asked for before the session knew who this agent is.
 *
 * `fetchProfile` decides "own" from `me()` at the call. A read of the same DID made before `me()`
 * answered is put behind the first screen, and the boot's own call — made the moment `me()` answers —
 * found that read in flight and waited on it, so the name prompt waited for the first screen too.
 *
 * A file of its own because the gate is the app's one and holds once (see `firstScreenDeferral`).
 */
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

const OWN = 'did:key:z6MkOwn';

const profilePort = {
  get: vi.fn(async (did: string) => ({ did, firstName: 'Me', lastName: '', handle: '' })),
  publish: async () => {},
  uploadFile: async () => 'expression://x',
};
let meDid: string | undefined;
const sessionStub = {
  me: () => (meDid ? { did: meDid } : undefined),
  backendPorts: () => ({ profiles: profilePort }),
  bootState: () => 'ready',
};

import { firstScreen } from '../src/frameworks/solid/firstScreen';
import { createProfileStore, type ProfileStore } from '../src/frameworks/solid/stores/ProfileStore';

function mount(): ProfileStore {
  let store!: ProfileStore;
  render(() => {
    store = createProfileStore({
      sessionStore: sessionStub as never,
      accountStore: { syncDisplay: async () => {} } as never,
      runtimeStore: { openAiStep: async () => false } as never,
    });
    return null;
  });
  return store;
}

describe('this agent’s own profile while the first screen is coming up', () => {
  it('is read at once when the boot asks for it, even if it was asked for before `me()` answered', async () => {
    firstScreen.hold();
    firstScreen.waiting();
    const store = mount();

    // Somebody names this agent before the session knows it is this agent: behind the first screen.
    meDid = undefined;
    const early = store.fetchProfile(OWN);
    await Promise.resolve();
    expect(profilePort.get).not.toHaveBeenCalled();

    // `me()` answers and the boot asks for its own, as `BootController` does.
    meDid = OWN;
    void store.fetchProfile(OWN);
    await early;
    expect(firstScreen.open()).toBe(false);
    expect(profilePort.get.mock.calls.map(([did]) => did)).toEqual([OWN]);
    expect(store.profiles().find((p) => p.did === OWN)?.firstName).toBe('Me');
  });
});
