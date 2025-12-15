import { Ad4mClient, Agent } from '@coasys/ad4m';
import { usePlatform } from '@shared/platform';
import { useNavigate } from '@solidjs/router';
import { Space } from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

export { type Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';

// TODO:
// + move ai to separate stores
// + Set up create agent screen

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface AdamStore {
  // State
  bootState: Accessor<BootState>;
  password: Accessor<string>;
  showPassword: Accessor<boolean>;
  passwordError?: Accessor<boolean>;
  loginLoading?: Accessor<boolean>;
  adamClient: Accessor<Ad4mClient | undefined>;
  me: Accessor<Agent | undefined>;
  mySpaces: Accessor<Space[]>;
  ad4mPort: Accessor<number | undefined>;
  ad4mToken: Accessor<string | undefined>;

  // Setters
  setPassword: (password: string) => void;
  setShowPassword: (showPassword: boolean) => void;
  setNavigateFunction: (navigate: NavigateFunction) => void;

  // Actions
  unlockAgent: () => Promise<void>;
  navigate: (to: string, options?: Record<string, unknown>) => void;
  addNewSpace: (space: Space) => void;
}

type BootState = 'initialising' | 'login' | 'createAgent' | 'ready' | 'error';

const AdamContext = createContext<AdamStore>();

export function AdamStoreProvider(props: ParentProps) {
  const platform = usePlatform();

  const [bootState, setBootState] = createSignal<BootState>('initialising');
  const [password, setPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [passwordError, setPasswordError] = createSignal(false);
  const [loginLoading, setLoginLoading] = createSignal(false);
  const [navigateFunction, setNavigateFunction] = createSignal<NavigateFunction | null>(null);
  const [adamClient, setAdamClient] = createSignal<Ad4mClient | undefined>(undefined);
  const [me, setMe] = createSignal<Agent | undefined>(undefined);
  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [ad4mPort, setAd4mPort] = createSignal<number | undefined>(undefined);
  const [ad4mToken, setAd4mToken] = createSignal<string | undefined>(undefined);

  async function getMe(client: Ad4mClient): Promise<void> {
    try {
      setMe(await client.agent.me());
    } catch (error) {
      console.error('AdamStore: getMe error', error);
    }
  }

  async function getMySpaces(client: Ad4mClient): Promise<void> {
    try {
      const perspectives = await client.perspective.all();
      const spaces = await Promise.all(perspectives.map(async (perspective) => (await Space.findAll(perspective))[0]));
      const filteredSpaces = spaces.filter((s) => s).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
      setMySpaces(filteredSpaces);
    } catch (error) {
      console.error('AdamStore: getMySpaces error', error);
    }
  }

  async function initialiseStore(): Promise<void> {
    try {
      // Small delay to ensure executor has time to start (desktop only)
      if (platform.isDesktop) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Build the Ad4m client using platform adapter
      const client = await platform.buildAd4mClient();
      setAdamClient(client);

      // Get agent status
      const status = await client.agent.status();

      // Desktop platforms: get connection details for iframe communication
      if (platform.getConnectionDetails) {
        const { port, token } = await platform.getConnectionDetails();
        setAd4mPort(port);
        setAd4mToken(token);
      }

      // If no agent exists, go to create agent screen
      if (!status.did) {
        setBootState('createAgent');
        return;
      }

      // If agent is locked, go to login screen
      if (!status.isUnlocked) {
        setBootState('login');
        return;
      }

      // Agent is ready - load user data
      setBootState('ready');
      await Promise.all([getMe(client), getMySpaces(client)]);

      // Navigate to root route when ready (still not working in electron?)
      navigate('/');

      // Send config to iframe if on desktop
      if (platform.isDesktop && ad4mPort() && ad4mToken()) {
        sendAdamConfigToIframe(ad4mPort()!, ad4mToken()!);
      }
    } catch (error) {
      console.error('AdamStore: initialiseStore error', error);
      setBootState('error');
    }
  }

  function sendAdamConfigToIframe(port: number, token: string) {
    // Retry mechanism to wait for iframe to be ready
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max

    const trySend = () => {
      // Find the we-iframe element
      const weIframe = document.querySelector('we-iframe') as any;

      // Pass the port and token to the iframe
      if (weIframe) {
        weIframe.postMessage({ type: 'AD4M_CONFIG', port, token }, '*');
      } else {
        // Wait for timeout and try again
        attempts++;
        if (attempts < maxAttempts) setTimeout(trySend, 100);
        else console.error('AdamStore: Failed to find iframe after', maxAttempts, 'attempts');
      }
    };

    // Start trying after a short delay to let iframe mount
    setTimeout(trySend, 100);
  }

  async function unlockAgent() {
    const client = adamClient();
    if (!client) return;

    setLoginLoading(true);
    setPasswordError(false);

    try {
      await client.agent.unlock(password(), true);
      setBootState('ready');

      // Load user data after unlock
      await Promise.all([getMe(client), getMySpaces(client)]);

      // Navigate to root route after successful login
      navigate('/');

      // Send config to iframe if on desktop
      if (platform.isDesktop && ad4mPort() && ad4mToken()) {
        sendAdamConfigToIframe(ad4mPort()!, ad4mToken()!);
      }
    } catch (err) {
      console.error('AdamStore: wrong password!', err);
      setPasswordError(true);
    } finally {
      setLoginLoading(false);
    }
  }

  function addNewSpace(space: Space): void {
    // console.log('AdamStore: addNewSpace', space);
    setMySpaces((prev) => [...prev, space]);
  }

  function navigate(to: string, options?: Record<string, unknown>) {
    // Skip if already on target path
    if (window.location.pathname === to) return;

    const nav = navigateFunction();
    if (nav) nav(to, options);
    else console.warn('Navigate function not available yet');
  }

  createEffect(initialiseStore);

  const store: AdamStore = {
    // State
    bootState,
    password,
    showPassword,
    passwordError,
    loginLoading,
    adamClient,
    me,
    mySpaces,
    ad4mPort,
    ad4mToken,

    // Setters
    setPassword,
    setShowPassword,
    setNavigateFunction,

    // Actions
    unlockAgent,
    navigate,
    addNewSpace,
  };

  return <AdamContext.Provider value={store}>{props.children}</AdamContext.Provider>;
}

export function useAdamStore(): AdamStore {
  const context = useContext(AdamContext);
  if (!context) throw new Error('useAdamStore must be used within the AdamProvider');
  return context;
}

export default AdamStoreProvider;
