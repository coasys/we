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
import { createAd4mAgentSession, createAd4mDatasetLifecycle, createAd4mEphemeralPort } from '@we/backend-ad4m';
import type { AgentIdentity, AgentSessionPort, DatasetLifecyclePort, EphemeralPort } from '@we/backend-shared';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import { useBackend, usePlatform } from '../providers/PlatformProvider';
import { startAppBridge } from '../services/appBridge';

export type BootState = 'initialising' | 'login' | 'createAgent' | 'ready' | 'error';

/** The authenticated identity as the shell holds it — neutral `id` plus the backend's own fields
 * (`did` is template-facing vocabulary: `$me.did`). */
export type SessionIdentity = AgentIdentity & { did?: string; perspective?: unknown };

export interface SessionStore {
  // State
  bootState: Accessor<BootState>;
  passwordError: Accessor<boolean>;
  loginLoading: Accessor<boolean>;
  /** The backend client, opaque to the shell — handed to adapter helpers, never inspected. */
  client: Accessor<unknown>;
  /** The agent-session port over that client. Null until connected. */
  agentSession: Accessor<AgentSessionPort | null>;
  /** The dataset-lifecycle port over that client. Null until connected. */
  lifecycle: Accessor<DatasetLifecyclePort | null>;
  me: Accessor<SessionIdentity | undefined>;
  port: Accessor<number | undefined>;
  token: Accessor<string | undefined>;
  serverUrl: Accessor<string | undefined>;
  isDevelopment: Accessor<boolean>;
  /**
   * The ephemeral transport, as a single shared instance. One port for the whole app because it
   * refcounts scopes per dataset — two ports would mean two executor signal handlers on the same
   * space. Both `PresenceStore` and the renderer's ephemeral binding use this one.
   */
  ephemeralPort: EphemeralPort;

  // Actions
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;

  // Boot wiring (used by the boot controller, not by schemas)
  /** Re-fetch `me` from the backend. */
  refreshMe: () => Promise<void>;
  /** Flip boot state to 'ready' — called by the boot controller once user data is loaded. */
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
  const [passwordError, setPasswordError] = createSignal(false);
  const [loginLoading, setLoginLoading] = createSignal(false);
  const [client, setClient] = createSignal<unknown>(undefined);
  const [agentSession, setAgentSession] = createSignal<AgentSessionPort | null>(null);
  const [lifecycle, setLifecycle] = createSignal<DatasetLifecyclePort | null>(null);
  const [me, setMe] = createSignal<SessionIdentity | undefined>(undefined);
  const [port, setPort] = createSignal<number | undefined>(undefined);
  const [token, setToken] = createSignal<string | undefined>(undefined);
  const [serverUrl, setServerUrl] = createSignal<string | undefined>(undefined);

  const ephemeralPort = createAd4mEphemeralPort(() => me()?.did);

  // Start the embed bridge synchronously, BEFORE any async boot work, so REQUEST_AD4M_CONFIG
  // from embedded apps (e.g. Flux) is never dropped — including during the ad4m-connect auth
  // flow on first load, where auth can take many seconds and the embedded app's 30-second
  // timeout would otherwise expire.
  startAppBridge({
    isDesktop: platform.isDesktop,
    port,
    token,
    serverUrl,
    bootState,
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
      if (platform.isDesktop && backend.connectionDetails) {
        const details = await backend.connectionDetails();
        // Set url BEFORE port/token — signal writes fire effects synchronously (the appBridge
        // flush effect reads all three), so url must be in place before port/token trigger it.
        if (details.url) setServerUrl(details.url);
        setPort(details.port);
        setToken(details.token);
      }

      // Small delay to ensure executor has time to start (desktop only)
      if (platform.isDesktop) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Build the client through the host's connector, then the ports over it. The client itself
      // stays opaque to this store — everything it needs goes through the two ports.
      const c = await backend.connect();
      setClient(c);
      const ports = backend.ports?.(c) ?? {
        agentSession: createAd4mAgentSession(c),
        lifecycle: createAd4mDatasetLifecycle(c),
      };
      const session = ports.agentSession;
      setAgentSession(session);
      setLifecycle(ports.lifecycle);

      // Web platform: credentials are only available after ad4m-connect auth completes
      if (!platform.isDesktop && backend.connectionDetails) {
        const details = await backend.connectionDetails();
        // Set url BEFORE port/token — same ordering constraint as above.
        if (details.url) setServerUrl(details.url);
        setPort(details.port);
        setToken(details.token);
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
      await session.unlock(password);
      // Same post-unlock load as the already-unlocked boot path.
      await runPostUnlockLoad();
    } catch (err) {
      console.error('SessionStore: agent unlock failed', err);
      setPasswordError(true);
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout(): Promise<void> {
    const session = agentSession();
    if (!session) {
      console.error('SessionStore: no session available for logout');
      return;
    }

    try {
      await session.lock(sessionPassword);
    } catch (err) {
      console.error('SessionStore: agent lock failed during logout', err);
    } finally {
      setMe(undefined);
      sessionPassword = '';
      setBootState('login');
    }
  }

  createEffect(initialise);

  const store: SessionStore = {
    bootState,
    passwordError,
    loginLoading,
    client,
    agentSession,
    lifecycle,
    me,
    port,
    token,
    serverUrl,
    isDevelopment: () => platform.isDevelopment,
    ephemeralPort,

    login,
    logout,

    refreshMe,
    markReady: () => setBootState('ready'),
    onSessionUnlocked,
  };

  return <SessionContext.Provider value={store}>{props.children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStore {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessionStore must be used within the SessionStoreProvider');
  return context;
}
