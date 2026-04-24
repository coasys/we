import { Ad4mClient, Agent, Perspective, type PerspectiveProxy } from '@coasys/ad4m';
import { usePlatform } from '@shared/platform';
import type { FileData } from '@we/models';
import {
  AgentProfile,
  AgentSettings,
  blobToDataURL,
  ChatMessage,
  ChatSession,
  CollectionBlock,
  ImageBlock,
  resizeImage,
  Space,
  Template,
  TextBlock,
  Theme,
  WeNode,
} from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useRouteStore } from './RouteStore';

export { type Ad4mClient, type PerspectiveProxy } from '@coasys/ad4m';

export interface AdamStore {
  // State
  bootState: Accessor<BootState>;
  passwordError?: Accessor<boolean>;
  loginLoading?: Accessor<boolean>;
  adamClient: Accessor<Ad4mClient | undefined>;
  me: Accessor<Agent | undefined>;
  allPerspectives: Accessor<PerspectiveProxy[]>;
  personalSpaces: Accessor<Space[]>;
  sharedSpaces: Accessor<Space[]>;
  ad4mPort: Accessor<number | undefined>;
  ad4mToken: Accessor<string | undefined>;
  isDevelopment: Accessor<boolean>;
  rootPerspective: Accessor<PerspectiveProxy | null>;
  agentSettings: Accessor<AgentSettings | null>;
  agentProfile: Accessor<AgentProfile | null>;
  creatingSpace: Accessor<boolean>;

  // Actions
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  addNewSpace: (space: Space) => void;
  createSpace: (name: string, description: string, shared: boolean, imageFile?: File) => Promise<void>;
  removePerspective: (uuid: string) => Promise<void>;
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<void>;
  updateAgentProfile: (updates: Partial<AgentProfile>) => Promise<void>;
  updateProfileImage: (imageFile: File) => Promise<void>;
  updateCoverImage: (imageFile: File) => Promise<void>;
}

type BootState = 'initialising' | 'login' | 'createAgent' | 'ready' | 'error';

const AdamContext = createContext<AdamStore>();

export function AdamStoreProvider(props: ParentProps) {
  const platform = usePlatform();
  const routeStore = useRouteStore();

  let sessionPassword = '';

  const [bootState, setBootState] = createSignal<BootState>('initialising');
  const [passwordError, setPasswordError] = createSignal(false);
  const [loginLoading, setLoginLoading] = createSignal(false);
  const [adamClient, setAdamClient] = createSignal<Ad4mClient | undefined>(undefined);
  const [me, setMe] = createSignal<Agent | undefined>(undefined);
  const [ad4mPort, setAd4mPort] = createSignal<number | undefined>(undefined);
  const [ad4mToken, setAd4mToken] = createSignal<string | undefined>(undefined);
  const [rootPerspective, setRootPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });
  const [agentProfile, setAgentProfile] = createSignal<AgentProfile | null>(null, { equals: false });
  const [allPerspectives, setAllPerspectives] = createSignal<PerspectiveProxy[]>([]);
  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [creatingSpace, setCreatingSpace] = createSignal(false);

  // Derived: personal and shared spaces
  const personalSpaces = createMemo(() => mySpaces().filter((s) => s.visibility !== 'shared'));
  const sharedSpaces = createMemo(() => mySpaces().filter((s) => s.visibility === 'shared'));

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
      setAllPerspectives(perspectives);
      const spaces = await Promise.all(perspectives.map(async (perspective) => await Space.findOne(perspective)));
      const filteredSpaces = spaces
        .filter((s): s is Space => !!s)
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
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
      routeStore.navigate('/');
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

  /** Find or create the root perspective containing AgentSettings */
  async function getOrCreateRootPerspective(client: Ad4mClient): Promise<void> {
    try {
      const perspectives = await client.perspective.all();
      const existing = perspectives.find((p) => p.name === 'we-root');

      if (existing) {
        // Ensure all models are registered (handles new models added after initial creation)
        await Promise.all([
          ChatMessage.register(existing),
          ChatSession.register(existing),
          Template.register(existing),
        ]);
        setRootPerspective(existing);
        const [settings, profile] = await Promise.all([
          AgentSettings.findOne(existing),
          AgentProfile.findOne(existing),
        ]);
        if (settings) setAgentSettings(settings);
        if (profile) setAgentProfile(profile);
        console.log('AdamStore: Found root perspective', existing.uuid);
        return;
      }

      // No root perspective exists — create one
      console.log('AdamStore: Creating root perspective');
      const perspective = await client.perspective.add('we-root');
      await Promise.all([
        AgentSettings.register(perspective),
        AgentProfile.register(perspective),
        ChatMessage.register(perspective),
        ChatSession.register(perspective),
        Template.register(perspective),
        Theme.register(perspective),
      ]);
      // Model.register resolves before SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      const [settings, profile] = await Promise.all([
        AgentSettings.create(perspective, {
          currentTemplateId: 'default',
          currentThemeId: 'dark',
        }),
        AgentProfile.create(perspective, {}),
      ]);

      setRootPerspective(perspective);
      setAgentSettings(settings);
      setAgentProfile(profile);
      console.log('AdamStore: Created root perspective', perspective.uuid);
    } catch (error) {
      console.error('AdamStore: getOrCreateRootPerspective error', error);
    }
  }

  async function updateAgentSettings(updates: Partial<AgentSettings>): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;

    Object.assign(settings, updates);
    await settings.save();
    setAgentSettings(settings);
  }

  async function updateAgentProfile(updates: Partial<AgentProfile>): Promise<void> {
    const profile = agentProfile();
    if (!profile) return;

    Object.assign(profile, updates);
    await profile.save();
    setAgentProfile(profile);
  }

  async function updateProfileImage(imageFile: File): Promise<void> {
    const profile = agentProfile();
    if (!profile) return;

    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    profile.profileImage = { data_base64: imageBase64, name: 'profile-image', file_type: 'image/png' } as FileData;
    await profile.save();
    setAgentProfile(profile);
  }

  async function updateCoverImage(imageFile: File): Promise<void> {
    const profile = agentProfile();
    if (!profile) return;

    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    profile.coverImage = { data_base64: imageBase64, name: 'cover-image', file_type: 'image/png' } as FileData;
    await profile.save();
    setAgentProfile(profile);
  }

  async function login(password: string) {
    console.log('AdamStore: Unlocking agent', password);
    const client = adamClient();
    if (!client) {
      console.error('No AD4M client available');
      return;
    }

    sessionPassword = password;
    setLoginLoading(true);
    setPasswordError(false);

    try {
      await client.agent.unlock(password, true);

      // Load user data after unlock
      await Promise.all([getMe(client), getMySpaces(client), getOrCreateRootPerspective(client)]);
      setBootState('ready');

      // Navigate to root route after successful login
      routeStore.navigate('/');
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
      await client.agent.lock(sessionPassword);
    } catch (err) {
      console.error('AdamStore: Agent lock failed during logout', err);
    } finally {
      setMe(undefined);
      setMySpaces([]);
      sessionPassword = '';
      setBootState('login');
    }
  }

  function addNewSpace(space: Space): void {
    setMySpaces((prev) => [...prev, space]);
  }

  async function createSpace(name: string, description: string, shared: boolean, imageFile?: File): Promise<void> {
    const client = adamClient();
    if (!client) return;

    setCreatingSpace(true);
    try {
      // Create the perspective
      const spacePerspective = await client.perspective.add(name);

      // Register SDNA models
      const models = [Space, WeNode, ImageBlock, TextBlock, CollectionBlock];
      await Promise.all(models.map((model) => model.register(spacePerspective)));

      // HACK: Model.register resolves before the SDNA is actually ready
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
      routeStore.navigate(`/space/${space.url || space.uuid}`);
    } catch (error) {
      console.error('AdamStore: createSpace error', error);
    } finally {
      setCreatingSpace(false);
    }
  }

  async function removePerspective(uuid: string): Promise<void> {
    const client = adamClient();
    if (!client) return;

    try {
      await client.perspective.remove(uuid);
      setAllPerspectives((prev) => prev.filter((p) => p.uuid !== uuid));
      setMySpaces((prev) => prev.filter((s) => s.uuid !== uuid));
    } catch (error) {
      console.error('AdamStore: removePerspective error', error);
    }
  }

  createEffect(initialiseStore);

  const store: AdamStore = {
    // State
    bootState,
    passwordError,
    loginLoading,
    adamClient,
    me,
    allPerspectives,
    personalSpaces,
    sharedSpaces,
    ad4mPort,
    ad4mToken,
    isDevelopment,
    rootPerspective,
    agentSettings,
    agentProfile,
    creatingSpace,

    // Actions
    login,
    logout,
    addNewSpace,
    createSpace,
    removePerspective,
    updateAgentSettings,
    updateAgentProfile,
    updateProfileImage,
    updateCoverImage,
  };

  return <AdamContext.Provider value={store}>{props.children}</AdamContext.Provider>;
}

export function useAdamStore(): AdamStore {
  const context = useContext(AdamContext);
  if (!context) throw new Error('useAdamStore must be used within the AdamProvider');
  return context;
}

export default AdamStoreProvider;
