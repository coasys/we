/**
 * Reading one agent's profile must not depend on every other agent's.
 *
 * `$agent` runs one effect per row, and every one of them asks the identity directory for its own
 * DID. While the only way to ask was a scan of `profiles()` — an array memo that is rebuilt whenever
 * any profile lands — each of those effects depended on the whole cache, so a single peer resolving
 * re-ran all of them. A transcript panel is the case that makes it visible: six hundred utterances
 * are six hundred effects, and a call is a steady drip of peers arriving.
 *
 * The cost is quadratic in the wrong direction and invisible in every small case, so the assertion
 * here is a **count** rather than a duration: one profile landing must wake the rows that are about
 * that agent, and no others. A timing would say the same thing far less reliably.
 *
 * `profiles()` stays coarse on purpose — a list of everyone genuinely does change whenever anyone
 * does, and the first test below pins that so the two readings cannot be confused later.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProfileStore, type ProfileStore } from '../src/shared/stores/ProfileStore';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const ME = 'did:key:z6MkSelf';
const ALICE = 'did:key:z6MkAlice';
const BOB = 'did:key:z6MkBob';

const sessionStub = {
  me: () => ({ did: ME }),
  backendPorts: () => ({ profiles: profilePort }),
  bootState: () => 'ready',
};
const accountsStub = { syncDisplay: async () => {} };

let profilePort: {
  get: (did: string) => Promise<unknown>;
  publish: (fields: unknown) => Promise<void>;
  uploadFile: (data: string) => Promise<string>;
};

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];

  function mount(): ProfileStore {
    let store!: ProfileStore;
    disposers.push(
      reactivity.root(() => {
        store = createProfileStore({
          reactivity,
          firstScreen: { open: () => true, whenOpen: () => Promise.resolve() },
          credential: { confirmed: () => false, touch: () => {}, read: () => '' },
          toasts: { info: () => {}, success: () => {}, warning: () => {}, error: () => {} },
          sessionStore: sessionStub as never,
          accountStore: accountsStub,
          runtimeStore: { openAiStep: async () => false },
        });
      }),
    );
    return store;
  }

  /** An effect owned by a root of its own, as a row reading the store would be. */
  function createEffect(fn: () => void): void {
    disposers.push(reactivity.root(() => reactivity.effect(fn)));
  }

  const profileFor = (did: string, firstName: string) => ({
    did,
    firstName,
    lastName: '',
    handle: '',
    bio: '',
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  beforeEach(() => {
    reactivity = makePort();
    profilePort = {
      get: async (did: string) => profileFor(did, did === ALICE ? 'Alice' : 'Bob'),
      publish: async () => {},
      uploadFile: async () => '',
    };
  });

  describe('profile cache granularity', () => {
    it('profiles() is coarse — every reader wakes when anyone lands', async () => {
      const store = mount();
      let runs = 0;

      // A reader shaped like the old `$identities.get`: a scan over the whole list.
      createEffect(() => {
        store.profiles().find((p) => p.did === ALICE);
        runs += 1;
      });
      await Promise.resolve();
      const before = runs;

      // Somebody entirely unrelated arrives.
      await store.fetchProfile(BOB);
      await Promise.resolve();

      expect(runs).toBeGreaterThan(before);
    });

    it('profileFor(did) is fine-grained — an unrelated profile wakes nobody', async () => {
      const store = mount();
      let aliceRuns = 0;

      createEffect(() => {
        store.profileFor(ALICE);
        aliceRuns += 1;
      });
      await Promise.resolve();
      const before = aliceRuns;

      await store.fetchProfile(BOB);
      await Promise.resolve();

      expect(aliceRuns).toBe(before);
    });

    it('profileFor(did) still wakes the reader it is about', async () => {
      const store = mount();
      let aliceRuns = 0;
      let seen: string | undefined;

      createEffect(() => {
        seen = store.profileFor(ALICE)?.firstName;
        aliceRuns += 1;
      });
      await Promise.resolve();
      const before = aliceRuns;

      await store.fetchProfile(ALICE);
      await Promise.resolve();

      expect(aliceRuns).toBeGreaterThan(before);
      expect(seen).toBe('Alice');
    });

    it('a reader asking about an absent agent wakes when that agent arrives', async () => {
      const store = mount();
      let runs = 0;

      // The case that decides whether the index can be a plain object: a row renders before its
      // profile exists, so the read that finds nothing has to be tracked too.
      createEffect(() => {
        store.profileFor(ALICE);
        runs += 1;
      });
      await Promise.resolve();
      const before = runs;

      await store.fetchProfile(ALICE);
      await Promise.resolve();

      expect(runs).toBeGreaterThan(before);
    });

    it('a profile already held does not wake its readers when somebody else arrives', async () => {
      const store = mount();
      await store.fetchProfile(ALICE);
      await Promise.resolve();
      let aliceRuns = 0;

      // Every arrival rebuilds the list as new objects; Alice's reads the same, so nothing about her moved.
      createEffect(() => {
        store.profileFor(ALICE);
        aliceRuns += 1;
      });
      await Promise.resolve();
      const before = aliceRuns;

      await store.fetchProfile(BOB);
      await Promise.resolve();

      expect(aliceRuns).toBe(before);
    });

    it('carries the assembled display name, like profiles() does', async () => {
      const store = mount();
      await store.fetchProfile(ALICE);
      await Promise.resolve();

      expect(store.profileFor(ALICE)?.name).toBe(store.profiles().find((p) => p.did === ALICE)?.name);
    });
  });
});
