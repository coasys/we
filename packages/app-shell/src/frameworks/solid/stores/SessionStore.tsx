/**
 * SessionStore — the connection to the backend and the authenticated identity.
 *
 * Owns: the client handle, connection details (port/token/url), boot state, login/logout, and
 * `me` (the agent's identity). Everything downstream — datasets, spaces, profiles — depends on
 * this store; it depends on nothing but the host-supplied backend connector.
 *
 * What it deliberately does NOT own: the user-data loading that follows a successful unlock
 * (system datasets, spaces, subscriptions). That spans several stores, so it is injected by the
 * boot controller via `onSessionUnlocked` — this store only knows *when* the session becomes
 * usable, not what the app loads into it.
 */
import type {
  AgentIdentity,
  AgentSessionPort,
  BackendPorts,
  DatasetLifecyclePort,
  EphemeralPort,
} from '@we/backend-shared';
import { devToolsEnabled, setDevToolsMuted } from '@we/module-shared';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import type { BackendAccountInfo, BackendHostInfo } from '../../../shared/backend/types';
import { useBackend, usePlatform } from '../providers/PlatformProvider';
import { startAppBridge } from '../services/appBridge';

/**
 * Where boot has got to.
 *
 * `createAgent` is the setup screen — name, picture, password, asked once. `finishing` is the
 * non-interactive tail of it: the profile can only be published once the session is loaded, so
 * the boot screen holds a spinner over a working app for the moment that takes. It is not a
 * second step to fill in; the user answered everything on the previous screen.
 */
export type BootState = 'initialising' | 'login' | 'createAgent' | 'finishing' | 'ready' | 'error';

/** The authenticated identity as the shell holds it — neutral `id` plus the backend's own fields
 * (`did` is template-facing vocabulary: `$me.did`). */
export type SessionIdentity = AgentIdentity & { did?: string; perspective?: unknown };

export interface SessionStore {
  // State
  bootState: Accessor<BootState>;
  /** Why the boot failed, when it did. Empty otherwise. */
  bootError: Accessor<string>;
  passwordError: Accessor<boolean>;
  loginLoading: Accessor<boolean>;
  /** Set when `createAgent` failed; carries the backend's message for display. */
  createAgentError: Accessor<string>;
  createAgentLoading: Accessor<boolean>;
  /** The backend client, opaque to the shell — handed to adapter helpers, never inspected. */
  client: Accessor<unknown>;
  /** The agent-session port over that client. Null until connected. */
  agentSession: Accessor<AgentSessionPort | null>;
  /** The dataset-lifecycle port over that client. Null until connected. */
  lifecycle: Accessor<DatasetLifecyclePort | null>;
  /** The full port bundle the connector supplied. Null until connected. */
  backendPorts: Accessor<BackendPorts | null>;
  me: Accessor<SessionIdentity | undefined>;
  port: Accessor<number | undefined>;
  token: Accessor<string | undefined>;
  serverUrl: Accessor<string | undefined>;
  /**
   * The node this session runs against, when it is somebody's hosting rather than this machine.
   *
   * Undefined on the desktop hosts and on a local executor — there is no "connected to" to report.
   * Its presence is therefore also the answer to "am I on someone else's node", which is what the
   * settings page gates the whole Host section on.
   */
  host: Accessor<BackendHostInfo | undefined>;
  /** This agent's account with that node — credits, email — when it keeps one. */
  hostAccount: Accessor<BackendAccountInfo | undefined>;
  /** Whether this is a development build. A fact about the build, and only that. */
  isDevelopment: Accessor<boolean>;
  /**
   * Whether developer affordances should be *visible* — which is a different question.
   *
   * A dev build with the switch thrown looks like a shipped one, so a developer can check what a
   * user actually sees without building for production. Settings → Developer holds the switch.
   *
   * Gate developer-only UI on this rather than on `isDevelopment`, which stays honest about the
   * build and so cannot be overridden without lying.
   */
  devTools: Accessor<boolean>;
  /**
   * Throw the switch. Takes the value the control shows, so a `we-switch` can pass `$event.detail`
   * straight through rather than needing an operator around it.
   *
   * Cannot turn developer UI *on* in a production build: the build flag is the ceiling, and this
   * re-asks `devToolsEnabled` rather than storing what it was told.
   */
  setDevTools: (on: boolean) => void;
  /**
   * The ephemeral transport, as a single shared instance. One port for the whole app because it
   * refcounts scopes per dataset — two ports would mean two executor signal handlers on the same
   * space. Both `PresenceStore` and the renderer's ephemeral binding use this one.
   */
  ephemeralPort: EphemeralPort;

  // Actions
  /**
   * Unlock the agent and load the session.
   *
   * **Rejects** when either half fails, so a schema's `onSuccess` means what it says — it used to
   * swallow everything, and a sign-in form chaining a navigation off success navigated on failure
   * too. `passwordError` is set only when the *unlock* was refused; a load failure after a password
   * the executor accepted is a data failure and says so elsewhere.
   */
  login: (password: string) => Promise<void>;
  /**
   * Create the agent under `password` and load the session, exactly as login does. Ends on
   * `finishing` rather than `ready` — see {@link BootState} — so the caller can publish the
   * profile before the app appears. Orchestrated by `profileStore.completeAccountSetup`.
   */
  createAgent: (password: string) => Promise<void>;
  /**
   * Clear the failed-unlock flag. Wired to the password field's input event: the verdict was on
   * the password that was submitted, so it stops being true the moment that password is edited.
   * Leaving it up means a stale "Incorrect password" sits over a field the user is fixing.
   */
  clearPasswordError: () => void;
  /** Leave `finishing` for the running app, once the profile has been published (or failed to). */
  finishSetup: () => void;
  logout: () => Promise<void>;
  /**
   * Start the whole boot again, from the failure screen.
   *
   * A reload rather than a second `initialise()`: a failed boot can have got anywhere before it
   * threw — a client set but no ports, a connect UI already mounted — and re-entering over that
   * would produce a second attempt racing the remains of the first. Reloading is the one way to
   * retry that is the same on every host and leaves nothing behind.
   */
  retryBoot: () => void;

  // Boot wiring (used by the boot controller, not by schemas)
  /** Re-fetch `me` from the backend. */
  refreshMe: () => Promise<void>;
  /**
   * The post-unlock load is done. Resolves to 'ready' normally, or to 'finishing' when this boot
   * created the agent — the boot controller reports completion, this store decides what completion
   * means, so the first-run branch needs no special case there.
   */
  markReady: () => void;
  /** Register the post-unlock loader. Runs on boot when already unlocked, and after login(). */
  onSessionUnlocked: (handler: () => Promise<void>) => void;
}

const SessionContext = createContext<SessionStore>();

export function SessionStoreProvider(props: ParentProps) {
  const platform = usePlatform();
  const backend = useBackend();

  let sessionPassword = '';

  const [bootState, setBootState] = createSignal<BootState>('initialising');
  const [bootError, setBootError] = createSignal('');
  const [passwordError, setPasswordError] = createSignal(false);
  const [loginLoading, setLoginLoading] = createSignal(false);
  const [createAgentError, setCreateAgentError] = createSignal('');
  const [createAgentLoading, setCreateAgentLoading] = createSignal(false);

  // Set for the duration of a first run, so markReady() lands on 'finishing' instead of 'ready'.
  let settingUp = false;
  const [client, setClient] = createSignal<unknown>(undefined);
  const [agentSession, setAgentSession] = createSignal<AgentSessionPort | null>(null);
  const [lifecycle, setLifecycle] = createSignal<DatasetLifecyclePort | null>(null);
  const [me, setMe] = createSignal<SessionIdentity | undefined>(undefined);
  const [port, setPort] = createSignal<number | undefined>(undefined);
  const [token, setToken] = createSignal<string | undefined>(undefined);
  const [serverUrl, setServerUrl] = createSignal<string | undefined>(undefined);
  const [host, setHost] = createSignal<BackendHostInfo | undefined>(undefined);
  const [hostAccount, setHostAccount] = createSignal<BackendAccountInfo | undefined>(undefined);

  const [backendPorts, setBackendPorts] = createSignal<BackendPorts | null>(null);
  // Supplied by connectors whose session is the connection rather than an unlocked keystore.
  let disconnectBackend: (() => Promise<void>) | null = null;

  /*
    Whether developer affordances are visible — seeded from the build and the stored preference,
    then live.

    A signal rather than a value read once, because the whole point of the switch is comparing:
    throw it, look at what a user would see, throw it back. That loop is worth nothing if each
    press costs a reload, and every affordance gated on it is chrome rendered from a schema, which
    is reactive already. `platform.isDevelopment` is still the ceiling — `setDevTools` cannot raise
    it, since `devToolsEnabled` ands with the build flag on the way back in.
  */
  const [devTools, setDevToolsSignal] = createSignal(devToolsEnabled(platform.isDevelopment));
  const setDevTools = (on: boolean) => {
    setDevToolsMuted(!on);
    setDevToolsSignal(devToolsEnabled(platform.isDevelopment));
  };

  // EphemeralPort is a function (dataset → scope | null), so this stable delegate can exist
  // before the connector's ports do — pre-connect it reports the capability as absent, which is
  // the contract's own degradation mode. Consumers hold one reference for the app's lifetime.
  const ephemeralPort: EphemeralPort = (dataset) => backendPorts()?.ephemeral(dataset) ?? null;

  // Start the embed bridge synchronously, BEFORE any async boot work, so REQUEST_AD4M_CONFIG
  // from embedded apps (e.g. Flux) is never dropped — including during the connector's auth
  // flow on first load, where auth can take many seconds and the embedded app's 30-second
  // timeout would otherwise expire.
  // The session is usable from the moment the post-unlock load finishes — which is 'finishing' on
  // a first run and 'ready' on every other boot. Both mean the executor will answer.
  const agentUnlocked = () => bootState() === 'ready' || bootState() === 'finishing';

  startAppBridge({
    isDesktop: platform.isDesktop,
    port,
    token,
    serverUrl,
    agentUnlocked,
  });

  // The post-unlock loader is registered by the boot controller (a child), which mounts during
  // the same synchronous render pass — before initialise()'s first await can resolve. The
  // pending flag covers the theoretical gap anyway: if the session becomes usable before a
  // handler exists, the load runs on registration instead of being dropped.
  let loadUserData: (() => Promise<void>) | null = null;
  let pendingLoad = false;

  function onSessionUnlocked(handler: () => Promise<void>): void {
    loadUserData = handler;
    if (pendingLoad) {
      pendingLoad = false;
      void handler();
    }
  }

  async function runPostUnlockLoad(): Promise<void> {
    if (!loadUserData) {
      pendingLoad = true;
      return;
    }
    await loadUserData();
  }

  async function refreshMe(): Promise<void> {
    const session = agentSession();
    if (!session) return;
    try {
      setMe((await session.me()) as SessionIdentity);
    } catch (error) {
      console.error('SessionStore: refreshMe error', error);
    }
  }

  async function initialise(): Promise<void> {
    try {
      // The connector owns the entire connection choreography (spawn/attach, auth, credential
      // acquisition, settling delays) — the shell receives a ready backend and runs the session
      // state machine over it.
      const {
        client: c,
        ports,
        connection,
        disconnect,
        host: hostInfo,
        account,
      } = await backend.initialize({ selfId: () => me()?.did });
      disconnectBackend = disconnect ?? null;
      setHost(hostInfo);
      setHostAccount(account);
      setClient(c);
      setBackendPorts(ports);
      const session = ports.agentSession;
      setAgentSession(session);
      setLifecycle(ports.lifecycle);

      if (connection) {
        // Set url BEFORE port/token — signal writes fire effects synchronously (the appBridge
        // flush effect reads all three), so url must be in place before port/token trigger it.
        if (connection.url) setServerUrl(connection.url);
        setPort(connection.port);
        setToken(connection.token);
      }

      const status = await session.status();

      // If no agent exists, go to create agent screen
      if (!status.hasAgent) {
        setBootState('createAgent');
        return;
      }

      // If agent is locked, go to login screen
      if (!status.unlocked) {
        setBootState('login');
        return;
      }

      // Agent is ready — the boot controller loads user data (and flips bootState to 'ready').
      await runPostUnlockLoad();
    } catch (error) {
      console.error('SessionStore: initialise error', error);
      // Kept, not just logged. This is the one failure with no screen behind it: every other boot
      // state has a form or a spinner, and 'error' had neither — so a backend that could not be
      // reached left the boot screen's background and nothing else, indefinitely.
      setBootError(error instanceof Error ? error.message : String(error));
      setBootState('error');
    }
  }

  async function login(password: string) {
    const session = agentSession();
    if (!session) {
      console.error('SessionStore: no session available for login');
      return;
    }

    sessionPassword = password;
    setLoginLoading(true);
    setPasswordError(false);

    try {
      // Only this can be wrong about the password. Everything after it has already been let in.
      try {
        await session.unlock(password);
      } catch (err) {
        console.error('SessionStore: agent unlock failed', err);
        setPasswordError(true);
        // Rethrown so the caller's `onSuccess` does not run. `login` used to swallow every failure,
        // so a schema chaining a navigation off a successful sign-in navigated on a failed one.
        throw err;
      }

      // Same post-unlock load as the already-unlocked boot path. A failure here is a data failure —
      // a dataset that would not load, a space that would not resolve — and reporting it as
      // "Incorrect password" about a password that was just accepted sends the user to change
      // something that was never wrong.
      await runPostUnlockLoad();
    } finally {
      setLoginLoading(false);
    }
  }

  function clearPasswordError() {
    setPasswordError(false);
  }

  /**
   * Create the agent, then run the same post-unlock load login does.
   *
   * The password is kept as the session password on success for the same reason login keeps it:
   * `lock()` needs it, and a freshly created agent is already unlocked, so there is no later
   * unlock to capture it from.
   */
  async function createAgent(password: string): Promise<void> {
    const session = agentSession();
    if (!session) {
      console.error('SessionStore: no session available for agent creation');
      return;
    }

    setCreateAgentLoading(true);
    setCreateAgentError('');

    try {
      try {
        await session.generate(password);
      } catch (err) {
        console.error('SessionStore: agent creation failed', err);
        // Leave bootState on 'createAgent' so the user can retry against the same screen.
        settingUp = false;
        setCreateAgentError(err instanceof Error ? err.message : 'Could not create your agent');
        throw err;
      }

      sessionPassword = password;
      settingUp = true;

      /*
        The load is a separate failure with a separate answer. Sharing the catch above meant a
        dataset that would not load reported "Could not create your agent" — about an agent that
        had just been created — and left the user on the create screen, where retrying calls
        `generate` again and the executor refuses, because an agent already exists. The only way out
        was to give up.

        The identity exists from here on, so a failure is a boot failure: `error` has a screen and a
        retry, which is exactly the shape this needs.
      */
      try {
        await runPostUnlockLoad();
      } catch (err) {
        console.error('SessionStore: post-creation load failed', err);
        settingUp = false;
        setBootError(err instanceof Error ? err.message : String(err));
        setBootState('error');
        throw err;
      }
    } finally {
      setCreateAgentLoading(false);
    }
  }

  function finishSetup(): void {
    settingUp = false;
    setBootState('ready');
  }

  /**
   * End the session, by locking the agent when that is possible and by restarting the backend when
   * it is not.
   *
   * `lock` takes the password, and this renderer only has it when *it* was the one that unlocked
   * the agent. Reloading the page during a session loses it while leaving the backend unlocked —
   * which is why the reloaded app walks straight in without asking — and there is then no password
   * to hand back.
   *
   * Sending anything else is not a harmless failed attempt: AD4M's `lock` re-encrypts the wallet's
   * in-memory keys under whatever it is given, so a wrong password silently re-keys the running
   * agent, and the real password then fails to decrypt it (`aead::Error`) until the executor is
   * restarted. Logging out after a reload made the account unopenable for the rest of the session.
   * (The keystore on disk is saved under the true passphrase first, which is why restarting the app
   * recovers it, and why nothing is lost.)
   *
   * So when the password is not in hand, the session ends whichever other way this backend offers:
   * the connector can end the connection (web, where the agent may be on someone else's node and
   * the session *is* the connection), or the host can restart the backend it started, which locks
   * it by construction. With neither, this returns to the sign-in screen with the backend still
   * unlocked — now at least visible in the log rather than silent.
   */
  async function logout(): Promise<void> {
    const session = agentSession();
    if (!session) {
      console.error('SessionStore: no session available for logout');
      return;
    }

    try {
      if (sessionPassword) {
        await session.lock(sessionPassword);
      } else if (disconnectBackend) {
        // The session is the connection: no lock to close, so end the connection and start over.
        // Returning to the sign-in form instead asks for a password against a keystore that is not
        // there — it is refused, and reloading walks straight back in, because nothing about the
        // session actually ended.
        await disconnectBackend();
        window.location.reload();
        return;
      } else if (platform.executor) {
        await platform.executor.restart();
      } else {
        console.warn(
          'SessionStore: logging out without the session password and with no way to end the session — the agent stays unlocked',
        );
      }
    } catch (err) {
      console.error('SessionStore: could not end the session cleanly', err);
    } finally {
      setMe(undefined);
      sessionPassword = '';
      settingUp = false;
      setBootState('login');
    }
  }

  createEffect(initialise);

  const store: SessionStore = {
    bootState,
    bootError,
    passwordError,
    loginLoading,
    createAgentError,
    createAgentLoading,
    client,
    agentSession,
    lifecycle,
    backendPorts,
    me,
    port,
    token,
    serverUrl,
    host,
    hostAccount,
    isDevelopment: () => platform.isDevelopment,
    devTools,
    setDevTools,
    ephemeralPort,

    login,
    createAgent,
    clearPasswordError,
    finishSetup,
    retryBoot: () => window.location.reload(),
    logout,

    refreshMe,
    markReady: () => setBootState(settingUp ? 'finishing' : 'ready'),
    onSessionUnlocked,
  };

  return <SessionContext.Provider value={store}>{props.children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStore {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessionStore must be used within the SessionStoreProvider');
  return context;
}
