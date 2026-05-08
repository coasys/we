import { Ad4mClient, Agent, Perspective, type PerspectiveProxy } from '@coasys/ad4m';
import { usePlatform } from '@shared/platform';
import { registerDynamicModels } from '@shared/registries/modelRegistry';
import type { FileData } from '@we/models';
import {
  AgentProfile,
  AgentSettings,
  blobToDataURL,
  ChatMessage,
  ChatSession,
  CollectionBlock,
  ImageBlock,
  LocationBlock,
  resizeImage,
  SignalType,
  Space,
  Template,
  TextBlock,
  Theme,
  WeNode,
} from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { getModelClasses, getModelManifest } from './perspectiveHelpers';
import { useRouteStore } from './RouteStore';
import { installSpaceSdna } from './spaceModels';
import { removeSpaceFromParent, syncAgentProfileToParent, syncSpaceToParent } from './syncHelpers';

export { type Ad4mClient, type PerspectiveProxy } from '@coasys/ad4m';

/**
 * Normalised description of a model class from a perspective's SHACL shapes.
 * Mirrors ModelManifestEntry from @coasys/ad4m (defined locally until the package
 * is built and linked with the new version).
 */
export interface ModelManifestProperty {
  name: string;
  predicate: string;
  type: 'string' | 'number' | 'boolean' | 'uri';
  isCollection: boolean;
  required: boolean;
  writable: boolean;
  resolveLanguage?: string;
  relatedModel?: string;
}

export interface ModelManifestEntry {
  name: string;
  targetClass: string;
  properties: ModelManifestProperty[];
}

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
  /** The we-test perspective used by testStore for $query testing. Always populated after boot. */
  testPerspective: Accessor<PerspectiveProxy | null>;
  /** The we-global perspective for discovery. Always populated after boot (local in dev, networked in prod when joined). */
  globalPerspective: Accessor<PerspectiveProxy | null>;
  /** UUIDs of all internal WE system perspectives (names starting with 'we-'). */
  systemPerspectiveUuids: Accessor<string[]>;
  /** Perspectives sorted by user-defined order (falls back to load order). */
  orderedPerspectives: Accessor<PerspectiveProxy[]>;
  agentSettings: Accessor<AgentSettings | null>;
  agentProfile: Accessor<AgentProfile | null>;
  creatingSpace: Accessor<boolean>;
  /** The currently focused perspective (universal signal — set for all navigation). */
  currentPerspective: Accessor<PerspectiveProxy | null>;
  /**
   * All model classes found in the current perspective (WE + external).
   * Populated by `setCurrentPerspective`; empty until a perspective is set.
   * WE models are included so the AI validator can narrow its allowlist to
   * what is actually registered in this perspective.
   */
  currentPerspectiveModels: Accessor<ModelManifestEntry[]>;

  // Actions
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  addNewSpace: (space: Space) => void;
  createSpace: (
    name: string,
    description: string,
    visibility: 'personal' | 'shared' | 'public',
    imageFile?: File,
    latitude?: number,
    longitude?: number,
    city?: string,
    country?: string,
    countryCode?: string,
  ) => Promise<void>;
  removePerspective: (uuid: string) => Promise<void>;
  /**
   * Set the active perspective by UUID.
   * - Fetches the PerspectiveProxy via byUUID
   * - Synthesises Ad4mModel classes from the perspective's SHACL shapes and
   *   caches them in the per-perspective model registry (WE models filtered out
   *   to avoid shadowing the real implementations)
   * - Populates currentPerspectiveModels with the full manifest (WE + external)
   *   so the AI validator can narrow its allowlist to what is actually registered
   * - Sets the currentPerspective signal (SpaceStore reacts to this)
   */
  setCurrentPerspective: (uuid: string) => Promise<void>;
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<void>;
  updateAgentProfile: (updates: Partial<AgentProfile>) => Promise<void>;
  updateProfileImage: (imageFile: File) => Promise<void>;
  updateCoverImage: (imageFile: File) => Promise<void>;
  reorderPerspectives: (newOrder: string[]) => Promise<void>;
  joinGlobalSpace: () => Promise<void>;
  /** Generic join action. For the global root this is identical to joinGlobalSpace; community-space
   * neighbourhood joining is a future TODO. */
  joinSpace: (spaceUuid: string) => Promise<void>;
  /** Removes a Space copy from the global perspective. Used when visibility drops from 'public'. */
  removeSpaceFromGlobal: (spaceUuid: string) => Promise<void>;
  /** Creates or replaces the agent's LocationBlock in the root perspective (and syncs to global if joined). */
  updateAgentLocation: (
    latitude: number,
    longitude: number,
    city?: string,
    country?: string,
    countryCode?: string,
  ) => Promise<void>;
}

type BootState = 'initialising' | 'login' | 'createAgent' | 'ready' | 'error';

const DEFAULT_GLOBAL_SIGNAL_TYPES: Partial<SignalType>[] = [
  {
    name: 'Like',
    slug: 'like',
    icon: '👍',
    mode: 'toggle',
    aggregate: 'count',
    semantic: 'approval',
    rangeMin: 0,
    rangeMax: 1,
  },
  {
    name: 'Vibe',
    slug: 'vibe',
    icon: '⚡',
    mode: 'toggle',
    aggregate: 'count',
    semantic: 'relevance',
    rangeMin: 0,
    rangeMax: 1,
  },
  {
    name: 'Quality',
    slug: 'quality',
    icon: '⭐',
    mode: 'rating',
    aggregate: 'mean',
    semantic: 'quality',
    rangeMin: 1,
    rangeMax: 5,
    step: 1,
  },
];

const DEFAULT_GLOBAL_SPACES = [
  {
    name: 'Open Source Collective',
    city: 'Berlin',
    countryCode: 'DE',
    country: 'Germany',
    latitude: 52.52,
    longitude: 13.405,
  },
  {
    name: 'Web3 Builders',
    city: 'Lisbon',
    countryCode: 'PT',
    country: 'Portugal',
    latitude: 38.717,
    longitude: -9.142,
  },
  {
    name: 'Decentralised Arts',
    city: 'Tokyo',
    countryCode: 'JP',
    country: 'Japan',
    latitude: 35.676,
    longitude: 139.65,
  },
];

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
  const [testPerspective, setTestPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [globalPerspective, setGlobalPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });
  const [agentProfile, setAgentProfile] = createSignal<AgentProfile | null>(null, { equals: false });
  const [allPerspectives, setAllPerspectives] = createSignal<PerspectiveProxy[]>([]);
  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [creatingSpace, setCreatingSpace] = createSignal(false);
  const [currentPerspective, setCurrentPerspectiveSignal] = createSignal<PerspectiveProxy | null>(null);
  const [currentPerspectiveModels, setCurrentPerspectiveModels] = createSignal<ModelManifestEntry[]>([]);

  // Derived: perspectives with we-* names are internal WE system perspectives
  const systemPerspectiveUuids = createMemo(() =>
    allPerspectives()
      .filter((p) => p.name.startsWith('we-'))
      .map((p) => p.uuid),
  );

  function getPerspectiveOrder(): string[] {
    const json = agentSettings()?.perspectiveOrder;
    if (!json) return [];
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  }

  // Derived: perspectives sorted by user-defined order (falls back to load order)
  const orderedPerspectives = createMemo(() => {
    const all = allPerspectives();
    const order = getPerspectiveOrder();
    if (order.length === 0) return all;
    const byUuid = new Map(all.map((p) => [p.uuid, p]));
    const ordered = order.flatMap((uuid) => {
      const p = byUuid.get(uuid);
      return p ? [p] : [];
    });
    const inOrder = new Set(order);
    const appended = all.filter((p) => !inOrder.has(p.uuid));
    return [...ordered, ...appended];
  });

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

  function subscribeToPerspectiveChanges(client: Ad4mClient): void {
    // perspectiveAdded fires for any client that adds a perspective (WE, Flux, CLI, etc.)
    // For WE-created spaces the Space model isn't saved yet when this fires, so
    // findOne returns null and createSpace()'s addNewSpace() handles mySpaces.
    client.perspective.addPerspectiveAddedListener((handle) => {
      if (allPerspectives().some((p) => p.uuid === handle.uuid)) return null;
      client.perspective.byUUID(handle.uuid).then((perspective) => {
        if (!perspective) return;
        setAllPerspectives((prev) => [...prev, perspective]);
        reorderPerspectives([...getPerspectiveOrder(), perspective.uuid]).catch(console.error);
        Space.findOne(perspective).then((space) => {
          if (space && !mySpaces().some((s) => s.uuid === handle.uuid)) {
            setMySpaces((prev) => [...prev, space].sort((a, b) => Number(a.createdAt) - Number(b.createdAt)));
          }
        });
      });
      return null;
    });

    // perspectiveUpdated fires on renames and neighbourhood sync-state transitions — not on link changes
    client.perspective.addPerspectiveUpdatedListener((handle) => {
      client.perspective.byUUID(handle.uuid).then((perspective) => {
        if (!perspective) return;
        setAllPerspectives((prev) => prev.map((p) => (p.uuid === handle.uuid ? perspective : p)));
        Space.findOne(perspective).then((space) => {
          if (!space) return;
          setMySpaces((prev) => {
            const exists = prev.some((s) => s.uuid === handle.uuid);
            if (exists) return prev.map((s) => (s.uuid === handle.uuid ? space : s));
            return [...prev, space].sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
          });
        });
      });
      return null;
    });

    // perspectiveRemoved fires for deletions from any client
    client.perspective.addPerspectiveRemovedListener((uuid) => {
      setAllPerspectives((prev) => prev.filter((p) => p.uuid !== uuid));
      setMySpaces((prev) => prev.filter((s) => s.uuid !== uuid));
      reorderPerspectives(getPerspectiveOrder().filter((id) => id !== uuid)).catch(console.error);
      return null;
    });
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
      // Bootstrap perspective order on first load (when no order has been saved yet)
      if (!agentSettings()?.perspectiveOrder) {
        const systemOrder = ['we-root', 'we-test', 'we-global'];
        const initialOrder = [...allPerspectives()]
          .sort((a, b) => {
            const ai = systemOrder.indexOf(a.name);
            const bi = systemOrder.indexOf(b.name);
            if (ai === -1 && bi === -1) return 0;
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          })
          .map((p) => p.uuid);
        await reorderPerspectives(initialOrder);
      }
    } catch (error) {
      console.error('AdamStore: getMySpaces error', error);
    }
  }

  async function initialiseStore(): Promise<void> {
    try {
      // Desktop platforms: set up iframe message listener FIRST (before any delays)
      // This ensures the listener is ready when embedded apps send REQUEST_AD4M_CONFIG
      // (On desktop the executor is already running so credentials are available immediately)
      if (platform.isDesktop && platform.getConnectionDetails) {
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

      // Web platform: credentials are only available after ad4m-connect auth completes
      if (!platform.isDesktop && platform.getConnectionDetails) {
        const { port, token } = await platform.getConnectionDetails();
        setAd4mPort(port);
        setAd4mToken(token);
        setupMessageListener(port, token);
      }

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

      // Agent is ready - load user data.
      // initSystemPerspectives must complete before getMySpaces so that the
      // perspective.all() snapshot in getMySpaces always includes we-root and we-test
      // — even on first boot when they don't exist yet and have to be created.
      await Promise.all([getMe(client), initSystemPerspectives(client)]);
      await getMySpaces(client);
      subscribeToPerspectiveChanges(client);
      setBootState('ready');

      // Navigate to root route when ready
      routeStore.navigate('/');
    } catch (error) {
      console.error('AdamStore: initialiseStore error', error);
      setBootState('error');
    }
  }

  // Track if an iframe requested AD4M_CONFIG while the agent was still locked
  let pendingConfigRequest = false;

  function sendAdamConfigToIframe(port: number, token: string) {
    // Send to ALL mounted we-iframe elements (there may be multiple apps)
    const weIframes = document.querySelectorAll('we-iframe') as NodeListOf<
      HTMLElement & { postMessage: (data: Record<string, unknown>, origin: string) => void }
    >;

    let sent = 0;
    weIframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        el.postMessage({ type: 'AD4M_CONFIG', port, token }, '*');
        sent++;
      }
    });

    if (sent === 0) {
      console.warn('AdamStore: no we-iframe elements found to send AD4M_CONFIG');
    }
  }

  function setupMessageListener(port: number, token: string) {
    // Listen for requests from iframes asking for AD4M config
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'REQUEST_AD4M_CONFIG') {
        if (bootState() === 'ready') {
          // Agent is unlocked — respond immediately
          sendAdamConfigToIframe(port, token);
        } else {
          // Agent is still locked — queue the request; the createEffect above will flush it
          pendingConfigRequest = true;
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup function
    return () => window.removeEventListener('message', handleMessage);
  }

  async function seedGlobalPerspective(perspective: PerspectiveProxy): Promise<void> {
    // Seed default signal types so the react bar is immediately populated
    for (const st of DEFAULT_GLOBAL_SIGNAL_TYPES) {
      await SignalType.create(perspective, st);
    }

    for (const seed of DEFAULT_GLOBAL_SPACES) {
      const space = await Space.create(perspective, {
        uuid: crypto.randomUUID(),
        name: seed.name,
        description: `A community in ${seed.city}`,
        visibility: 'public',
      });
      const loc = await LocationBlock.create(perspective, {
        name: seed.city,
        city: seed.city,
        countryCode: seed.countryCode,
        country: seed.country,
        latitude: seed.latitude,
        longitude: seed.longitude,
      });
      await space.addLocations(loc);
    }
  }

  /** Find or create the root perspective and all other system perspectives.
   * Also re-registers we-global models if the perspective already exists (previously joined). */
  async function initSystemPerspectives(client: Ad4mClient): Promise<void> {
    try {
      const perspectives = await client.perspective.all();
      const existing = perspectives.find((p) => p.name === 'we-root');

      if (existing) {
        // Ensure all models are registered (handles new models added after initial creation)
        await Promise.all([
          ChatMessage.register(existing),
          ChatSession.register(existing),
          Template.register(existing),
          LocationBlock.register(existing),
        ]);
        setRootPerspective(existing);
        const [settings, profile] = await Promise.all([
          AgentSettings.findOne(existing),
          AgentProfile.findOne(existing),
        ]);
        if (settings) setAgentSettings(settings);
        if (profile) setAgentProfile(profile);
        console.log('AdamStore: Found root perspective', existing.uuid);

        // Find or create we-test system perspective (uses same snapshot)
        const existingTest = perspectives.find((p) => p.name === 'we-test');
        if (existingTest) {
          setTestPerspective(existingTest);
        } else {
          const testP = await client.perspective.add('we-test');
          setTestPerspective(testP);
        }

        // Restore we-global if previously joined — model registration is handled
        // by SpaceStore.installSpaceSdna when the perspective is navigated to.
        const existingGlobal = perspectives.find((p) => p.name === 'we-global');
        if (existingGlobal) {
          setGlobalPerspective(existingGlobal);
          console.log('AdamStore: Restored we-global perspective', existingGlobal.uuid);
        }

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
        LocationBlock.register(perspective),
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

      // Find or create we-test system perspective
      const allPersp = await client.perspective.all();
      const existingTest = allPersp.find((p: PerspectiveProxy) => p.name === 'we-test');
      if (existingTest) {
        setTestPerspective(existingTest);
      } else {
        const testP = await client.perspective.add('we-test');
        setTestPerspective(testP);
      }
    } catch (error) {
      console.error('AdamStore: initSystemPerspectives error', error);
    }
  }

  async function updateAgentSettings(updates: Partial<AgentSettings>): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;

    Object.assign(settings, updates);
    await settings.save();
    setAgentSettings(settings);
  }

  async function reorderPerspectives(newOrder: string[]): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;
    settings.perspectiveOrder = JSON.stringify(newOrder);
    await settings.save();
    setAgentSettings(settings);
  }

  async function updateAgentProfile(updates: Partial<AgentProfile>): Promise<void> {
    const profile = agentProfile();
    if (!profile) return;

    Object.assign(profile, updates);
    await profile.save();
    setAgentProfile(profile);

    // Sync to global perspective when the agent has joined
    const globalP = globalPerspective();
    if (globalP) {
      syncAgentProfileToParent(profile, globalP).catch((err) =>
        console.error('AdamStore: syncAgentProfileToGlobal failed', err),
      );
    }
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

      // Load user data after unlock — same serialization as initialiseStore
      await Promise.all([getMe(client), initSystemPerspectives(client)]);
      await getMySpaces(client);
      subscribeToPerspectiveChanges(client);
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

  async function updateAgentLocation(
    latitude: number,
    longitude: number,
    city?: string,
    country?: string,
    countryCode?: string,
  ): Promise<void> {
    const profile = agentProfile();
    const rootP = rootPerspective();
    if (!profile || !rootP) return;

    const name = city && country ? `${city}, ${country}` : (city ?? country ?? undefined);
    // Create a new LocationBlock (replace logic: delete old link first via setLocation)
    const loc = await LocationBlock.create(rootP, {
      latitude,
      longitude,
      ...(name && { name }),
      ...(city && { city }),
      ...(country && { country }),
      ...(countryCode && { countryCode }),
    });
    // HasOne generates setLocation — links the new block, removes any prior link
    await (profile as unknown as { setLocation: (v: LocationBlock) => Promise<void> }).setLocation(loc);
    // Re-read to get hydrated location
    const updated = await AgentProfile.findOne(rootP);
    if (updated) {
      setAgentProfile(updated);
      // Sync location to global perspective if joined
      const globalP = globalPerspective();
      if (globalP) {
        syncAgentProfileToParent(updated, globalP).catch((err) =>
          console.error('AdamStore: syncAgentProfileToGlobal (location) failed', err),
        );
      }
    }
  }

  async function createSpace(
    name: string,
    description: string,
    visibility: 'personal' | 'shared' | 'public',
    imageFile?: File,
    latitude?: number,
    longitude?: number,
    city?: string,
    country?: string,
    countryCode?: string,
  ): Promise<void> {
    // Runtime coercion: JSON schema callers may pass a boolean from the legacy `shared` local state.
    // TODO(commit-5): remove once CreateSpaceModal sends a visibility string.
    const vis: 'personal' | 'shared' | 'public' =
      (visibility as unknown) === true ? 'shared' : (visibility as unknown) === false ? 'personal' : visibility;

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

      // If shared or public, publish as neighbourhood
      if (vis !== 'personal') {
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

      // Process image if provided
      let thumbnailData: FileData | undefined;
      let imageData: FileData | undefined;
      if (imageFile) {
        const thumbnailBlob = await resizeImage(imageFile, 0.3);
        const compressedBlob = await resizeImage(imageFile, 0.6);
        thumbnailData = {
          data_base64: await blobToDataURL(thumbnailBlob),
          name: 'space-thumbnail',
          file_type: 'image/png',
        } as FileData;
        imageData = {
          data_base64: await blobToDataURL(compressedBlob),
          name: 'space-image',
          file_type: 'image/png',
        } as FileData;
      }

      // Create Space model
      const space = await Space.create(spacePerspective, {
        uuid: spacePerspective.uuid,
        url: spacePerspective.sharedUrl ?? undefined,
        name,
        description,
        visibility: vis,
        ...(imageData && { image: imageData, thumbnail: thumbnailData }),
      });

      // Attach a location pin if coordinates were provided
      if (latitude != null && longitude != null) {
        const locationName = city && country ? `${city}, ${country}` : (city ?? country ?? undefined);
        const loc = await LocationBlock.create(spacePerspective, {
          latitude,
          longitude,
          ...(locationName && { name: locationName }),
          ...(city && { city }),
          ...(country && { country }),
          ...(countryCode && { countryCode }),
        });
        await space.addLocations(loc);
      }

      // If public and the global neighbourhood is joined, mirror the space there
      const globalP = globalPerspective();
      if (vis === 'public' && globalP) {
        syncSpaceToParent(space, globalP).catch((err) => console.error('AdamStore: syncSpaceToGlobal failed', err));
      }

      // Update sidebar and navigate
      addNewSpace(space);
      await setCurrentPerspective(spacePerspective.uuid);
      routeStore.navigate(`/space/${space.url || space.uuid}`);
    } catch (error) {
      console.error('AdamStore: createSpace error', error);
    } finally {
      setCreatingSpace(false);
    }
  }

  async function joinSpace(spaceUuid: string): Promise<void> {
    // 'global' is the well-known sentinel for the root global space
    if (spaceUuid === 'global') {
      await joinGlobalSpace();
      return;
    }

    // If a perspective with this UUID/URL already exists locally, just focus it.
    const existing = allPerspectives().find((p) => p.uuid === spaceUuid || p.sharedUrl === spaceUuid);
    if (existing) {
      await setCurrentPerspective(existing.uuid);
      return;
    }

    // Community-space neighbourhood joining not yet implemented.
    console.warn('AdamStore: joinSpace community path not yet implemented', spaceUuid);
  }

  async function joinGlobalSpace(): Promise<void> {
    const client = adamClient();
    if (!client) return;

    try {
      if (isDevelopment()) {
        // Dev: create a local we-global perspective and seed with sample data.
        // Model registration (installSpaceSdna) happens in SpaceStore when the
        // perspective is navigated to — register is idempotent so seeding below
        // can call Space.create safely after navigating there.
        const globalP = await client.perspective.add('we-global');
        await installSpaceSdna(globalP);
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Create root Space node representing the global space itself (holonic pattern)
        await Space.create(globalP, {
          uuid: globalP.uuid,
          name: 'WE Global',
          description: 'The global discovery space',
          visibility: 'public',
        });

        // Seed synthetic spaces, agents, and signals so the globe is populated in dev
        await seedGlobalPerspective(globalP);

        setGlobalPerspective(globalP);
        await setCurrentPerspective(globalP.uuid);
        console.log('AdamStore: Created and seeded we-global perspective', globalP.uuid);
      } else {
        // Prod: join the real global neighbourhood
        // TODO: replace with well-known neighbourhood URL from seed file
        console.warn('AdamStore: joinGlobalSpace prod path not yet implemented');
      }
    } catch (error) {
      console.error('AdamStore: joinGlobalSpace error', error);
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

  async function setCurrentPerspective(uuid: string): Promise<void> {
    const client = adamClient();
    if (!client) return;

    try {
      const perspective = await client.perspective.byUUID(uuid);
      if (!perspective) return;

      // Synthesise Ad4mModel classes from SHACL shapes and register them.
      try {
        const classes = await getModelClasses(perspective);
        registerDynamicModels(uuid, classes);
      } catch (err) {
        console.warn('AdamStore: getModelClasses failed', err);
      }

      // Populate currentPerspectiveModels with the full manifest (WE + external).
      // The full list lets AiStore build a perspective-accurate validator allowlist.
      try {
        const manifest = await getModelManifest(perspective);
        setCurrentPerspectiveModels(manifest);
      } catch (err) {
        console.warn('AdamStore: getModelManifest failed', err);
        setCurrentPerspectiveModels([]);
      }

      setCurrentPerspectiveSignal(perspective);
    } catch (error) {
      console.error('AdamStore: setCurrentPerspective error', error);
    }
  }

  createEffect(initialiseStore);

  // When the agent transitions to ready, send AD4M_CONFIG to any iframes that requested it while locked
  createEffect(() => {
    const port = ad4mPort();
    const token = ad4mToken();
    if (bootState() === 'ready' && pendingConfigRequest && port !== undefined && token !== undefined) {
      pendingConfigRequest = false;
      sendAdamConfigToIframe(port, token);
    }
  });

  const store: AdamStore = {
    // State
    bootState,
    passwordError,
    loginLoading,
    adamClient,
    me,
    allPerspectives,
    orderedPerspectives,
    personalSpaces,
    sharedSpaces,
    ad4mPort,
    ad4mToken,
    isDevelopment,
    rootPerspective,
    testPerspective,
    globalPerspective,
    systemPerspectiveUuids,
    agentSettings,
    agentProfile,
    creatingSpace,
    currentPerspective,
    currentPerspectiveModels,

    // Actions
    login,
    logout,
    addNewSpace,
    createSpace,
    removePerspective,
    setCurrentPerspective,
    updateAgentSettings,
    updateAgentProfile,
    updateProfileImage,
    updateCoverImage,
    reorderPerspectives,
    joinGlobalSpace,
    joinSpace,
    updateAgentLocation,
    removeSpaceFromGlobal: (spaceUuid) => {
      const globalP = globalPerspective();
      if (!globalP) return Promise.resolve();
      return removeSpaceFromParent(spaceUuid, globalP);
    },
  };

  return <AdamContext.Provider value={store}>{props.children}</AdamContext.Provider>;
}

export function useAdamStore(): AdamStore {
  const context = useContext(AdamContext);
  if (!context) throw new Error('useAdamStore must be used within the AdamProvider');
  return context;
}

export default AdamStoreProvider;
