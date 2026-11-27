/**
 * ProfileStore: a local write always beats a fetch that was already in flight.
 *
 * The ordering matters most on a first run, and that is exactly where it broke. The unlock handler
 * fires `fetchProfile` for an agent whose profile has not been published yet, so it reads an empty
 * one; setup writes the name a moment later. If the stale response is allowed to land, the name
 * disappears until the app is reloaded — which is what happened, because the two events shared a
 * millisecond and the guard compared timestamps with a strict `>`.
 *
 * Plain store tests, run once under each reactivity port: Solid's, and the test port that runs a new
 * effect at once where Solid defers it.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCredential, type Credential } from '../src/shared/credential';
import { createFirstScreen, type FirstScreen } from '../src/shared/firstScreen';
import { createProfileStore, type ProfileStore } from '../src/shared/stores/ProfileStore';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const DID = 'did:key:z6MkTest';

const setup = { bootState: 'ready', created: 0, finished: 0, asking: false };

const sessionStub = {
  me: () => ({ did: DID }),
  backendPorts: () => ({ profiles: profilePort }),
  // Read by `needsName`, which gates the name prompt on the app being up.
  bootState: () => setup.bootState,
  // A first run: the agent is made and the session loaded, so setup lands on `finishing`.
  createAgent: async () => {
    setup.created += 1;
    setup.bootState = 'finishing';
  },
  finishSetup: () => {
    setup.finished += 1;
    setup.bootState = 'ready';
  },
};
const accountsStub = { syncDisplay: async () => {} };
// Whether the node has an AI question for a new account: the runtime store's to decide.
const runtimeStub = { openAiStep: async () => setup.asking };

let profilePort: {
  get: (did: string) => Promise<unknown>;
  publish: (fields: unknown) => Promise<void>;
  uploadFile: (data: string) => Promise<string>;
};

const emptyProfile = { did: DID, firstName: '', lastName: '', handle: '', bio: '' };

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  let credential: Credential;
  const toasts: string[] = [];
  const disposers: (() => void)[] = [];

  function mount(options: { firstScreen?: FirstScreen; session?: object } = {}): ProfileStore {
    let store!: ProfileStore;
    disposers.push(
      reactivity.root(() => {
        store = createProfileStore({
          reactivity,
          firstScreen: options.firstScreen ?? { open: () => true, whenOpen: () => Promise.resolve() },
          credential,
          toasts: {
            info: (message) => toasts.push(message),
            success: (message) => toasts.push(message),
            warning: (message) => toasts.push(message),
            error: (message) => toasts.push(message),
          },
          sessionStore: (options.session ?? sessionStub) as never,
          accountStore: accountsStub,
          runtimeStore: runtimeStub,
        });
      }),
    );
    return store;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    reactivity = makePort();
    credential = createCredential(reactivity);
    toasts.length = 0;
    Object.assign(setup, { bootState: 'ready', created: 0, finished: 0, asking: false });
    profilePort = {
      get: async () => emptyProfile,
      publish: async () => {},
      uploadFile: async () => 'expression://x',
    };
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
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

  /**
   * Asking somebody who arrived without a name what they are called.
   *
   * The whole risk here is asking the wrong person. An identity created outside WE — the ADAM
   * Launcher, Flux, a hosted node reached through ad4m-connect — already exists when WE boots, so the
   * setup screen that collects a name is skipped and nobody is ever asked. But an empty profile and an
   * unfetched one look identical, so a prompt gated on emptiness alone appears in front of *everybody*
   * on every launch and vanishes a moment later. That flash is what `ownProfileLoaded` exists for.
   */
  describe('the name prompt', () => {
    it('stays down until the fetch has answered, however empty the cache looks', async () => {
      let land!: (summary: unknown) => void;
      profilePort.get = () => new Promise((resolve) => (land = resolve));

      const store = mount();
      void store.fetchProfile(DID);

      expect(store.ownProfileLoaded()).toBe(false);
      expect(store.needsName()).toBe(false);

      land(emptyProfile);
      await vi.waitFor(() => expect(store.ownProfileLoaded()).toBe(true));
      expect(store.needsName()).toBe(true);
    });

    it('does not ask somebody who has a name', async () => {
      profilePort.get = async () => ({ ...emptyProfile, firstName: 'James' });

      const store = mount();
      await store.fetchProfile(DID);

      expect(store.needsName()).toBe(false);
    });

    it('does not ask somebody who has only a handle', async () => {
      profilePort.get = async () => ({ ...emptyProfile, handle: 'james' });

      const store = mount();
      await store.fetchProfile(DID);

      expect(store.needsName()).toBe(false);
    });

    // `name` is assembled for display and falls back to "Anonymous", so it is never empty. Anything
    // deciding whether somebody HAS a name has to read the stored fields instead.
    it('is not fooled by the placeholder name the cache decorates every profile with', async () => {
      const store = mount();
      await store.fetchProfile(DID);

      expect(store.ownProfile()?.name).toBe('Anonymous');
      expect(store.needsName()).toBe(true);
    });

    it('stops asking once it is dismissed', async () => {
      const store = mount();
      await store.fetchProfile(DID);
      expect(store.needsName()).toBe(true);

      store.dismissNamePrompt();

      expect(store.needsName()).toBe(false);
    });

    it('publishes the answer and stops asking', async () => {
      const published: unknown[] = [];
      profilePort.publish = async (fields) => void published.push(fields);

      const store = mount();
      await store.fetchProfile(DID);
      await store.saveNameFromPrompt('  James  ');

      expect(published).toEqual([{ firstName: 'James' }]);
      expect(store.ownProfile()?.firstName).toBe('James');
      expect(store.needsName()).toBe(false);
    });

    // The reason this is a store action rather than `updateOwnProfile` wired straight from the schema:
    // `needsName` reads the profile, so a failed publish would re-raise the modal on top of the toast
    // explaining the failure, with the same button leading to the same place.
    it('stops asking even when the publish fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      profilePort.publish = async () => {
        throw new Error('offline');
      };

      const store = mount();
      await store.fetchProfile(DID);
      await store.saveNameFromPrompt('James');

      expect(store.needsName()).toBe(false);
      expect(toasts).toEqual(['Your name did not save. You can set it in your profile.']);
    });

    it('ignores a blank answer rather than publishing one', async () => {
      const published: unknown[] = [];
      profilePort.publish = async (fields) => void published.push(fields);

      const store = mount();
      await store.fetchProfile(DID);
      await store.saveNameFromPrompt('   ');

      expect(published).toEqual([]);
      expect(store.needsName()).toBe(true);
    });
  });

  describe('finishing a first run', () => {
    function typePassword() {
      credential.set('a-test-password');
      credential.setConfirmation('a-test-password');
    }

    it('goes to the app once the profile is published, where there is no AI question', async () => {
      typePassword();
      const store = mount();
      await store.completeAccountSetup('Test Person');
      expect(setup.created).toBe(1);
      expect(setup.finished).toBe(1);
      expect(setup.bootState).toBe('ready');
    });

    it('stays on the sign-in screen for the AI step, which finishes setting up itself', async () => {
      typePassword();
      setup.asking = true;
      const store = mount();
      await store.completeAccountSetup('Test Person');
      expect(setup.finished).toBe(0);
      expect(setup.bootState).toBe('finishing');
    });

    it('goes to the app when the AI question cannot be decided', async () => {
      typePassword();
      const decide = vi.spyOn(runtimeStub, 'openAiStep').mockRejectedValue(new Error('the node did not answer'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const store = mount();
      await store.completeAccountSetup('Test Person');
      expect(decide).toHaveBeenCalled();
      expect(setup.finished).toBe(1);
    });
  });

  /*
    What waits for the first screen: somebody else's profile is read once it is up, this agent's at
    once. Each case holds a gate of its own, so nothing leaks between them.
  */
  describe('while the first screen is coming up', () => {
    const OTHER = 'did:key:z6MkOther';
    let gate: FirstScreen;
    let asked: string[];
    let meDid: string | undefined;
    const session = {
      me: () => (meDid ? { did: meDid } : undefined),
      backendPorts: () => ({ profiles: profilePort }),
      bootState: () => 'ready',
    };

    beforeEach(() => {
      gate = createFirstScreen({ signal: reactivity.signal });
      gate.hold();
      gate.waiting();
      asked = [];
      meDid = DID;
      profilePort.get = async (did: string) => {
        asked.push(did);
        return { did, firstName: did === DID ? 'Me' : 'Them', lastName: '', handle: '', bio: '' };
      };
    });
    afterEach(() => gate.answered());

    it('reads this agent’s own at once, and somebody else’s once the first page is drawn', async () => {
      const store = mount({ firstScreen: gate, session });
      void store.fetchProfile(DID);
      const other = store.fetchProfile(OTHER);
      expect(asked).toEqual([DID]);
      // Asked twice while held, read once when it opens.
      void store.fetchProfile(OTHER);
      gate.answered();
      await other;
      expect(asked).toEqual([DID, OTHER]);
      expect(store.profiles().find((p) => p.did === OTHER)?.firstName).toBe('Them');
    });

    it('reads its own at once when the boot asks, even if it was asked for before me() answered', async () => {
      const store = mount({ firstScreen: gate, session });
      // Somebody names this agent before the session knows it is this agent: behind the first screen.
      meDid = undefined;
      const early = store.fetchProfile(DID);
      await Promise.resolve();
      expect(asked).toEqual([]);
      // `me()` answers and the boot asks for its own, as the composition root does.
      meDid = DID;
      void store.fetchProfile(DID);
      await early;
      expect(gate.open()).toBe(false);
      expect(asked).toEqual([DID]);
      expect(store.profiles().find((p) => p.did === DID)?.firstName).toBe('Me');
    });
  });
});
