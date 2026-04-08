import { Ad4mClient, Agent, Literal, Perspective, type PerspectiveProxy } from '@coasys/ad4m';
import { usePlatform } from '@shared/platform';
import { useNavigate } from '@solidjs/router';
import type { FileData } from '@we/models';
import {
  AgentConfig,
  blobToDataURL,
  CollectionBlock,
  ImageBlock,
  resizeImage,
  Space,
  Template,
  TextBlock,
  Theme,
  WeNode,
} from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

export { type Ad4mClient, type PerspectiveProxy } from '@coasys/ad4m';

// TODO:
// + move ai to separate stores
// + Set up create agent screen

type NavigateFunction = ReturnType<typeof useNavigate>;

export interface AdamStore {
  // State
  bootState: Accessor<BootState>;
  showPassword: Accessor<boolean>;
  passwordError?: Accessor<boolean>;
  loginLoading?: Accessor<boolean>;
  adamClient: Accessor<Ad4mClient | undefined>;
  me: Accessor<Agent | undefined>;
  mySpaces: Accessor<Space[]>;
  ad4mPort: Accessor<number | undefined>;
  ad4mToken: Accessor<string | undefined>;
  isDevelopment: Accessor<boolean>;
  rootPerspective: Accessor<PerspectiveProxy | null>;
  userPreferences: Accessor<AgentConfig | null>;

  // Setters
  setShowPassword: (showPassword: boolean) => void;
  setNavigateFunction: (navigate: NavigateFunction) => void;

  // Actions
  unlockAgent: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  navigate: (to: string, options?: Record<string, unknown>) => void;
  addNewSpace: (space: Space) => void;
  createSpace: (name: string, description: string, shared: boolean, imageFile?: File) => Promise<void>;
  updatePreferences: (updates: Partial<Pick<AgentConfig, 'currentTemplateId' | 'currentThemeId'>>) => Promise<void>;
}

type BootState = 'initialising' | 'login' | 'createAgent' | 'ready' | 'error';

const AdamContext = createContext<AdamStore>();

export function AdamStoreProvider(props: ParentProps) {
  const platform = usePlatform();

  const [bootState, setBootState] = createSignal<BootState>('initialising');
  let lastPassword = '';
  const [showPassword, setShowPassword] = createSignal(false);
  const [passwordError, setPasswordError] = createSignal(false);
  const [loginLoading, setLoginLoading] = createSignal(false);
  const [navigateFunction, setNavigateFunction] = createSignal<NavigateFunction | null>(null);
  const [adamClient, setAdamClient] = createSignal<Ad4mClient | undefined>(undefined);
  const [me, setMe] = createSignal<Agent | undefined>(undefined);
  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [ad4mPort, setAd4mPort] = createSignal<number | undefined>(undefined);
  const [ad4mToken, setAd4mToken] = createSignal<string | undefined>(undefined);
  const [rootPerspective, setRootPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [userPreferences, setUserPreferences] = createSignal<AgentConfig | null>(null, { equals: false });

  // Expose platform development mode to schemas
  const isDevelopment = () => platform.isDevelopment;

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
      const filteredSpaces = spaces.filter((s) => s).sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      setMySpaces(filteredSpaces);
    } catch (error) {
      console.error('AdamStore: getMySpaces error', error);
    }
  }

  async function initialiseStore(): Promise<void> {
    try {
      // Desktop platforms: set up iframe message listener FIRST (before any delays)
      // This ensures the listener is ready when embedded apps send REQUEST_AD4M_CONFIG
      if (platform.getConnectionDetails) {
        const { port, token } = await platform.getConnectionDetails();
        setAd4mPort(port);
        setAd4mToken(token);

        // Set up listener immediately so it's ready for iframe requests
        setupMessageListener(port, token);
      }

      // Small delay to ensure executor has time to start (desktop only)
      if (platform.isDesktop) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Build the Ad4m client using platform adapter
      const client = await platform.buildAd4mClient();
      setAdamClient(client);

      // Get agent status
      const status = await client.agent.status();

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
      await Promise.all([getMe(client), getMySpaces(client), getOrCreateRootPerspective(client)]);
      setBootState('ready');

      // Navigate to root route when ready
      navigate('/');
    } catch (error) {
      console.error('AdamStore: initialiseStore error', error);
      setBootState('error');
    }
  }

  function sendAdamConfigToIframe(port: number, token: string) {
    // Find the we-iframe element
    const weIframe = document.querySelector('we-iframe') as HTMLElement & {
      postMessage: (data: Record<string, unknown>, origin: string) => void;
    };

    // Pass the port and token to the iframe
    if (weIframe && typeof weIframe.postMessage === 'function') {
      weIframe.postMessage({ type: 'AD4M_CONFIG', port, token }, '*');
    } else {
      console.warn('AdamStore: we-iframe element not found or postMessage not available');
    }
  }

  function setupMessageListener(port: number, token: string) {
    // Listen for requests from iframes asking for AD4M config
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'REQUEST_AD4M_CONFIG') {
        sendAdamConfigToIframe(port, token);
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup function
    return () => window.removeEventListener('message', handleMessage);
  }

  /** Find or create the root perspective containing AgentConfig */
  async function getOrCreateRootPerspective(client: Ad4mClient): Promise<void> {
    try {
      const perspectives = await client.perspective.all();

      // Try to find the root perspective by checking for an AgentConfig instance
      for (const p of perspectives) {
        const results = await AgentConfig.findAll(p);
        if (results.length > 0) {
          setRootPerspective(p);
          setUserPreferences(results[0]);
          console.log('AdamStore: Found root perspective', p.uuid);
          return;
        }
      }

      // No root perspective exists — create one
      console.log('AdamStore: Creating root perspective');
      const perspective = await client.perspective.add('__we_root__');
      await Promise.all([
        perspective.ensureSDNASubjectClass(AgentConfig),
        perspective.ensureSDNASubjectClass(Template),
        perspective.ensureSDNASubjectClass(Theme),
      ]);
      // AD4M's ensureSDNASubjectClass resolves before SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      const root = Literal.from('we-user-preferences').toUrl();
      const prefs = new AgentConfig(perspective, root);
      prefs.currentTemplateId = 'we';
      prefs.currentThemeId = 'default';
      await prefs.save();

      setRootPerspective(perspective);
      setUserPreferences(prefs);
      console.log('AdamStore: Created root perspective', perspective.uuid);
    } catch (error) {
      console.error('AdamStore: getOrCreateRootPerspective error', error);
    }
  }

  /** Update persisted user preferences */
  async function updatePreferences(
    updates: Partial<Pick<AgentConfig, 'currentTemplateId' | 'currentThemeId'>>,
  ): Promise<void> {
    const prefs = userPreferences();
    if (!prefs) return;

    if (updates.currentTemplateId !== undefined) prefs.currentTemplateId = updates.currentTemplateId;
    if (updates.currentThemeId !== undefined) prefs.currentThemeId = updates.currentThemeId;
    await prefs.save();
    setUserPreferences(prefs);
  }

  async function unlockAgent(password: string) {
    console.log('AdamStore: Unlocking agent', password);
    const client = adamClient();
    if (!client) {
      console.error('No AD4M client available');
      return;
    }

    lastPassword = password;
    setLoginLoading(true);
    setPasswordError(false);

    try {
      await client.agent.unlock(password, true);

      // Load user data after unlock
      await Promise.all([getMe(client), getMySpaces(client), getOrCreateRootPerspective(client)]);
      setBootState('ready');

      // Navigate to root route after successful login
      navigate('/');
    } catch (err) {
      console.error('AdamStore: Agent unlock failed', err);
      setPasswordError(true);
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout(): Promise<void> {
    const client = adamClient();
    if (!client) {
      console.error('AdamStore: No AD4M client available for logout');
      return;
    }

    try {
      await client.agent.lock(lastPassword);
    } catch (err) {
      console.error('AdamStore: Agent lock failed during logout', err);
    } finally {
      setMe(undefined);
      setMySpaces([]);
      lastPassword = '';
      setBootState('login');
    }
  }

  function addNewSpace(space: Space): void {
    setMySpaces((prev) => [...prev, space]);
  }

  async function createSpace(name: string, description: string, shared: boolean, imageFile?: File): Promise<void> {
    const client = adamClient();
    if (!client) return;

    try {
      // Create the perspective
      const spacePerspective = await client.perspective.add(name);

      // Register SDNA models
      const models = [Space, WeNode, ImageBlock, TextBlock, CollectionBlock];
      await Promise.all(models.map((model) => spacePerspective.ensureSDNASubjectClass(model)));

      // HACK: AD4M's ensureSDNASubjectClass resolves before the SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // If shared, publish as neighbourhood
      if (shared) {
        const uid = crypto.randomUUID();
        const langs = await client.runtime.knownLinkLanguageTemplates();
        const templateAddress = langs?.[0];
        if (!templateAddress) throw new Error('No link language templates available to publish neighbourhood.');
        const templateData = JSON.stringify({ uid, name: `${name}-link-language` });
        const linkLanguage = await client.languages.applyTemplateAndPublish(templateAddress, templateData);
        await client.neighbourhood.publishFromPerspective(
          spacePerspective.uuid,
          linkLanguage.address,
          new Perspective([]),
        );
      }

      // Create and save Space model
      const space = new Space(spacePerspective);
      space.uuid = spacePerspective.uuid;
      if (spacePerspective.sharedUrl) space.url = spacePerspective.sharedUrl;
      space.name = name;
      space.description = description;
      space.visibility = shared ? 'shared' : 'personal';

      // Process image if provided
      if (imageFile) {
        const thumbnailBlob = await resizeImage(imageFile, 0.3);
        const compressedBlob = await resizeImage(imageFile, 0.6);
        const thumbnailBase64 = await blobToDataURL(thumbnailBlob);
        const imageBase64 = await blobToDataURL(compressedBlob);
        space.thumbnail = {
          data_base64: thumbnailBase64,
          name: 'space-thumbnail',
          file_type: 'image/png',
        } as FileData;
        space.image = { data_base64: imageBase64, name: 'space-image', file_type: 'image/png' } as FileData;
      }

      await space.save();

      // Update sidebar and navigate
      addNewSpace(space);
      navigate(`/space/${space.url || space.uuid}`);
    } catch (error) {
      console.error('AdamStore: createSpace error', error);
    }
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
    showPassword,
    passwordError,
    loginLoading,
    adamClient,
    me,
    mySpaces,
    ad4mPort,
    ad4mToken,
    isDevelopment,
    rootPerspective,
    userPreferences,

    // Setters
    setShowPassword,
    setNavigateFunction,

    // Actions
    unlockAgent,
    logout,
    navigate,
    addNewSpace,
    createSpace,
    updatePreferences,
  };

  return <AdamContext.Provider value={store}>{props.children}</AdamContext.Provider>;
}

export function useAdamStore(): AdamStore {
  const context = useContext(AdamContext);
  if (!context) throw new Error('useAdamStore must be used within the AdamProvider');
  return context;
}

export default AdamStoreProvider;
