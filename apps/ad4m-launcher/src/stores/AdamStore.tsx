import { Ad4mClient, Agent } from '@coasys/ad4m';
import { useNavigate } from '@solidjs/router';
import { Space } from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';
export { type Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';

import { buildAd4mClient } from '@/utils/ad4mClient';

// TODO:
// + move ai to separate stores
// + rename to AppStore
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

  // import Ad4mConnect from '@coasys/ad4m-connect';
  // async function getAdamClient() {
  //   try {
  //     const connect = Ad4mConnect({
  //       appName: 'WE',
  //       appDesc: 'Social media for the new internet',
  //       appDomain: 'ad4m.weco.io',
  //       appIconPath: 'https://avatars.githubusercontent.com/u/34165012',
  //       capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
  //     });
  //     console.log('AdamStore: getAdamClient connecting...', connect);
  //     const client = await connect.getAd4mClient();
  //     console.log('AdamStore: getAdamClient connected', client);
  //     return client;
  //   } catch (error) {
  //     console.error('AdamStore: getAdamClient error', error);
  //   }
  // }

  // async function getMe(client: Ad4mClient): Promise<void> {
  //   try {
  //     setMe(await client.agent.me());
  //   } catch (error) {
  //     console.error('AdamStore: getMyAgentData error', error);
  //   }
  // }

  // async function getMySpaces(client: Ad4mClient): Promise<void> {
  //   try {
  //     const perspectives = await client.perspective.all();
  //     console.log('*** await client.perspective.all()', perspectives);
  //     const spaces = await Promise.all(perspectives.map(async (perspective) => (await Space.findAll(perspective))[0]));
  //     // console.log('AdamStore: getMySpaces spaces', spaces);
  //     const filteredSpaces = spaces.filter((s) => s).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  //     setMySpaces(filteredSpaces);
  //   } catch (error) {
  //     console.error('AdamStore: getMySpaces error', error);
  //   }
  // }

  // async function getMyAI(client: Ad4mClient): Promise<void> {
  //   try {
  //     const models = await client.ai.getModels();
  //     const tasks = await client.ai.tasks();
  //     setMyAI({ models, tasks });
  //   } catch (error) {
  //     console.error('AdamStore: getMyAI error', error);
  //   }
  // }

  async function initialiseStore(): Promise<void> {
    try {
      // Small delay to ensure executor has time to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Build the Ad4m client
      const { client, status, port, token } = await buildAd4mClient();
      setAdamClient(client);
      setAd4mPort(port);
      setAd4mToken(token);

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

      // If the agent is ready, set the boot state to ready
      setBootState('ready');

      // Send adam config to iframe
      sendAdamConfigToIframe(port, token);
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
      sendAdamConfigToIframe(ad4mPort()!, ad4mToken()!);
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
