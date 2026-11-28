/**
 * sessionStore: the boot state machine over a backend's agent session — which screen a boot lands
 * on, what signing in and creating an account report when they fail, and the run from a first run's
 * `finishing` to the app.
 *
 * Plain store tests, run once under each engine (Solid, the test port, Vue).
 */
import type { AgentCredentials, AgentSessionPort, AgentSessionStatus } from '@we/backend-shared';
import { NO_IDENTITY_CAPABILITIES, SessionTimeoutError } from '@we/backend-shared';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCredential, type Credential } from '../src/shared/credential';
import { createFirstScreen } from '../src/shared/firstScreen';
import { createTestPlatform } from '../src/shared/platform/testPlatform';
import { createSessionStore, type SessionStore } from '../src/shared/stores/SessionStore';
import { reactivityPorts } from './support/engines';

const DID = 'did:key:z6MkSession';
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** An agent session whose state the test sets, recording what it was asked. */
function agentSession(initial: AgentSessionStatus) {
  const state = { ...initial, refuse: null as Error | null, signedOutByPort: true };
  const asked: string[] = [];
  const port: AgentSessionPort = {
    status: async () => ({ hasAgent: state.hasAgent, unlocked: state.unlocked }),
    async signUp(credentials: AgentCredentials) {
      asked.push(`signUp:${credentials.password}`);
      if (state.refuse) throw state.refuse;
      state.hasAgent = true;
      state.unlocked = true;
    },
    async signIn(credentials: AgentCredentials) {
      asked.push(`signIn:${credentials.password}`);
      if (state.refuse) throw state.refuse;
      state.unlocked = true;
    },
    async signOut() {
      asked.push('signOut');
      state.unlocked = false;
      return state.signedOutByPort;
    },
    me: async () => ({ id: DID, did: DID }) as never,
  };
  return { port, state, asked };
}

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  let credential: Credential;
  const disposers: (() => void)[] = [];

  function mount(session: AgentSessionPort, options: { onUnlock?: (store: SessionStore) => Promise<void> } = {}) {
    let store!: SessionStore;
    const agentDids: (() => string | undefined)[] = [];
    const firstScreen = createFirstScreen({ signal: reactivity.signal });
    const ports = {
      agentSession: session,
      lifecycle: {},
      identity: { capabilities: async () => ({ ...NO_IDENTITY_CAPABILITIES, keyLog: true }) },
      ephemeral: () => null,
    };
    disposers.push(
      reactivity.root(() => {
        store = createSessionStore({
          reactivity,
          platform: { ...createTestPlatform(), isDesktop: false, isDevelopment: true } as never,
          backend: { initialize: () => Promise.resolve({ client: {}, ports }) } as never,
          credential,
          firstScreen,
          shellStore: { provideAgentDid: (did) => agentDids.push(did) },
          chatStore: { provideAgentDid: (did) => agentDids.push(did) },
          accountStore: { switchingTo: () => null, creating: () => false },
        });
        // As the boot controller does: the load after unlocking, which reports back with markReady.
        store.onSessionUnlocked(async () => {
          await store.refreshMe();
          await options.onUnlock?.(store);
          store.markReady();
        });
      }),
    );
    return { store, agentDids, firstScreen };
  }

  beforeEach(() => {
    reactivity = makePort();
    credential = createCredential(reactivity);
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('lands on the create screen when the backend has no agent, and holds the first screen meanwhile', async () => {
    const { store, firstScreen } = mount(agentSession({ hasAgent: false, unlocked: false }).port);
    await flush();
    expect(store.bootState()).toBe('createAgent');
    expect(store.signInStep()).toBe('create');
    expect(firstScreen.open()).toBe(false);
  });

  it('lands on the sign-in screen when the agent is locked', async () => {
    const { store } = mount(agentSession({ hasAgent: true, unlocked: false }).port);
    await flush();
    expect(store.bootState()).toBe('login');
    expect(store.backendPorts()).not.toBeNull();
  });

  it('runs the post-unlock load at once when the agent is already unlocked, and reads who it is', async () => {
    const { store, agentDids } = mount(agentSession({ hasAgent: true, unlocked: true }).port);
    await flush();
    expect(store.bootState()).toBe('ready');
    expect(store.me()?.did).toBe(DID);
    // The shell and the chat both follow the signed-in agent.
    expect(agentDids.map((did) => did())).toEqual([DID, DID]);
    expect(store.identityCapabilities().keyLog).toBe(true);
  });

  it('signs in with what was typed into the host field, then forgets it', async () => {
    const session = agentSession({ hasAgent: true, unlocked: false });
    const { store } = mount(session.port);
    await flush();
    await store.unlock();
    expect(session.asked).toEqual([]);
    credential.set('hunter2');
    expect(store.credentialEntered()).toBe(true);
    await store.unlock();
    await flush();
    expect(session.asked).toEqual(['signIn:hunter2']);
    expect(store.bootState()).toBe('ready');
    expect(credential.read()).toBe('');
    expect(store.credentialEntered()).toBe(false);
  });

  it('says a refused password is wrong, and stops saying so once the field is edited', async () => {
    const session = agentSession({ hasAgent: true, unlocked: false });
    const { store } = mount(session.port);
    await flush();
    session.state.refuse = new Error('Incorrect password');
    await expect(store.login('nope')).rejects.toThrow('Incorrect password');
    expect(store.passwordError()).toBe(true);
    expect(store.loginError()).toBe('');
    expect(store.loginLoading()).toBe(false);
    store.clearPasswordError();
    expect(store.passwordError()).toBe(false);
  });

  it('says a sign-in that timed out is the backend being slow, not the password', async () => {
    const session = agentSession({ hasAgent: true, unlocked: false });
    const { store } = mount(session.port);
    await flush();
    session.state.refuse = new SessionTimeoutError();
    await expect(store.login('right')).rejects.toThrow();
    expect(store.passwordError()).toBe(false);
    expect(store.loginError()).toContain('taking longer than usual');
  });

  it('ends a first run on finishing, holds it on the AI step when asked, and finishes to the app', async () => {
    const session = agentSession({ hasAgent: false, unlocked: false });
    const { store } = mount(session.port);
    await flush();
    await store.createAgent('new-password');
    expect(store.bootState()).toBe('finishing');
    store.holdForAiSetup();
    expect(store.signInStep()).toBe('setUpAi');
    store.finishSetup();
    expect(store.bootState()).toBe('ready');
  });

  it('leaves a refused account creation on the create screen with the reason', async () => {
    const session = agentSession({ hasAgent: false, unlocked: false });
    const { store } = mount(session.port);
    await flush();
    session.state.refuse = new Error('Disk full');
    await expect(store.createAgent('pw')).rejects.toThrow('Disk full');
    expect(store.bootState()).toBe('createAgent');
    expect(store.createAgentError()).toBe('Disk full');
    expect(store.createAgentLoading()).toBe(false);
  });

  it('a load that fails after the account was made is a boot failure, with a screen', async () => {
    const session = agentSession({ hasAgent: false, unlocked: false });
    const { store } = mount(session.port, {
      onUnlock: () => Promise.reject(new Error('The root would not load')),
    });
    await flush();
    await expect(store.createAgent('pw')).rejects.toThrow('The root would not load');
    expect(store.bootState()).toBe('error');
    expect(store.bootError()).toBe('The root would not load');
  });

  it('signs out through the port and returns to the sign-in screen with nobody signed in', async () => {
    const session = agentSession({ hasAgent: true, unlocked: true });
    const { store } = mount(session.port);
    await flush();
    await store.logout();
    expect(session.asked).toContain('signOut');
    expect(store.bootState()).toBe('login');
    expect(store.me()).toBeUndefined();
    expect(store.identityCapabilities()).toEqual(NO_IDENTITY_CAPABILITIES);
  });

  it('a backend that cannot connect is kept as a boot error', async () => {
    let store!: SessionStore;
    disposers.push(
      reactivity.root(() => {
        store = createSessionStore({
          reactivity,
          platform: { ...createTestPlatform(), isDesktop: false, isDevelopment: true } as never,
          backend: { initialize: () => Promise.reject(new Error('No backend here')) } as never,
          credential,
          firstScreen: createFirstScreen({ signal: reactivity.signal }),
          shellStore: { provideAgentDid: () => {} },
          chatStore: { provideAgentDid: () => {} },
          accountStore: { switchingTo: () => null, creating: () => false },
        });
      }),
    );
    await flush();
    expect(store.bootState()).toBe('error');
    expect(store.bootError()).toBe('No backend here');
  });

  it('connects once, however often what it read on the way changes', async () => {
    let connects = 0;
    const [selfSeen, setSelfSeen] = reactivity.signal(0);
    disposers.push(
      reactivity.root(() => {
        createSessionStore({
          reactivity,
          platform: { ...createTestPlatform(), isDesktop: false, isDevelopment: true } as never,
          backend: {
            initialize: () => {
              connects++;
              selfSeen();
              return new Promise(() => {});
            },
          } as never,
          credential,
          firstScreen: createFirstScreen({ signal: reactivity.signal }),
          shellStore: { provideAgentDid: () => {} },
          chatStore: { provideAgentDid: () => {} },
          accountStore: { switchingTo: () => null, creating: () => false },
        });
      }),
    );
    await flush();
    setSelfSeen(1);
    await flush();
    expect(connects).toBe(1);
  });
});
