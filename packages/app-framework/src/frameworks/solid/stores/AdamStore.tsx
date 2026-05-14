import { Ad4mClient, Agent, Perspective, type PerspectiveProxy } from '@coasys/ad4m';
import { getModelClasses, getModelManifest } from '@shared/perspectiveHelpers';
import { usePlatform } from '@shared/platform';
import { registerDynamicModels } from '@shared/registries/modelRegistry';
import { installSpaceSdna } from '@shared/spaceModels';
import { removeSpaceFromParent, syncAgentProfileToParent } from '@shared/syncHelpers';
import type { FileData } from '@we/models';
import {
  AgentProfile,
  AgentSettings,
  blobToDataURL,
  ChatMessage,
  ChatSession,
  LocationBlock,
  resizeImage,
  Space,
  Template,
  Theme,
} from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import weSeedFile from '../../../../../../we-seed.json';
import type { WeSeedFile } from '../../../types/seed';
import { useRouteStore } from './RouteStore';

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
  /** True when a globalSpaceUrl is configured in we-seed.json. */
  globalSpaceConfigured: Accessor<boolean>;
  rootPerspective: Accessor<PerspectiveProxy | null>;
  /** The we-test perspective used by testStore for $query testing. Always populated after boot. */
  testPerspective: Accessor<PerspectiveProxy | null>;
  /** The we-global perspective for discovery. Always populated after boot (local in dev, networked in prod when joined). */
  globalPerspective: Accessor<PerspectiveProxy | null>;
  /** UUIDs of all internal WE system perspectives (names starting with 'we-'). */
  systemPerspectiveUuids: Accessor<string[]>;
  /** Perspectives sorted by user-defined order (falls back to load order). */
  orderedPerspectives: Accessor<PerspectiveProxy[]>;
  /** All non-system perspectives in user-defined order, enriched with Space avatar/name when available. Use this in the sidebar to show both WE spaces and external perspectives (e.g. Flux). */
  orderedSidebarItems: Accessor<{ uuid: string; name: string; avatar?: string; spaceId: string }[]>;
  /** The URL path segment for the global space — the neighbourhood CID (with `neighbourhood://` stripped), or null if no global space is configured in we-seed.json. */
  globalSpaceId: () => string | null;
  agentSettings: Accessor<AgentSettings | null>;
  agentProfile: Accessor<AgentProfile | null>;
  creatingSpace: Accessor<boolean>;
  /** The currently focused perspective (universal signal — set for all navigation). */
  currentPerspective: Accessor<PerspectiveProxy | null>;
  /**
   * All model classes found in the current perspective (WE + external).
   * Populated by `switchPerspective`; empty until a perspective is set.
   * WE models are included so the AI validator can narrow its allowlist to
   * what is actually registered in this perspective.
   */
  currentPerspectiveModels: Accessor<ModelManifestEntry[]>;

  // Actions
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  createSpace: (
    name: string,
    description: string,
    visibility: 'personal' | 'shared' | 'public',
    avatarFile?: File,
    coverImageFile?: File,
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
  switchPerspective: (uuid: string) => Promise<void>;
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<void>;
  updateAgentProfile: (updates: Partial<AgentProfile>) => Promise<void>;
  updateAvatarImage: (imageFile: File) => Promise<void>;
  updateCoverImage: (imageFile: File) => Promise<void>;
  reorderPerspectives: (newOrder: string[]) => Promise<void>;
  /** Join a space by its route segment (CID without `neighbourhood://` prefix), full neighbourhood URL, or local UUID.
   * If already joined locally, just focuses the perspective. Otherwise joins the neighbourhood and syncs the agent profile. */
  joinSpace: (id: string) => Promise<void>;
  /**
   * If the global space has been joined and no perspective is currently active,
   * sets the global perspective as the current perspective.
   * If globalPerspective is not yet set, this is a no-op — the template handles joining.
   */
  // activateGlobalPerspective: () => Promise<void>;
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
  const [currentPerspective, setCurrentPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [currentPerspectiveModels, setCurrentPerspectiveModels] = createSignal<ModelManifestEntry[]>([]);

  const systemPerspectiveUuids = createMemo(() =>
    allPerspectives()
      .filter((p) => ['we-root', 'we-test'].includes(p.name))
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

  // Derived: perspectives sorted by user-defined order (falls back to load order), system perspectives excluded
  const orderedPerspectives = createMemo(() => {
    const all = allPerspectives().filter((p) => !['we-root', 'we-test'].includes(p.name));
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

  // Derived: all non-system perspectives with Space avatar/name when available, plain perspective data otherwise
  const orderedSidebarItems = createMemo(() => {
    const spaceByUuid = new Map(mySpaces().map((s) => [s.uuid, s]));
    return orderedPerspectives().map((p) => {
      const s = spaceByUuid.get(p.uuid);
      return {
        uuid: p.uuid,
        name: s?.name ?? p.name,
        avatar: typeof s?.avatar === 'string' ? s.avatar : undefined,
        spaceId: p.sharedUrl ? p.sharedUrl.replace('neighbourhood://', '') : p.uuid,
      };
    });
  });

  // Derived: personal and shared spaces
  const personalSpaces = createMemo(() => mySpaces().filter((s) => s.visibility !== 'shared'));
  const sharedSpaces = createMemo(() => mySpaces().filter((s) => s.visibility === 'shared'));

  // Expose platform development mode to schemas
  const isDevelopment = () => platform.isDevelopment;
  const globalSpaceConfigured = () => !!(weSeedFile as WeSeedFile).globalSpaceUrl;

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
    // findOne returns null and createSpace() handles setMySpaces directly.
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
    // Space model data lives in links, so there's nothing to refresh here beyond the perspective handle
    client.perspective.addPerspectiveUpdatedListener((handle) => {
      client.perspective.byUUID(handle.uuid).then((perspective) => {
        if (!perspective) return;
        setAllPerspectives((prev) => prev.map((p) => (p.uuid === handle.uuid ? perspective : p)));
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

  // Capture the URL the user landed on before any boot-time navigation.
  // Used to restore deep links after auth completes (e.g. refresh on /space/uuid/flux).
  const initialPath = window.location.pathname;

  async function initialiseStore(): Promise<void> {
    try {
      // Set up iframe message listener for ALL platforms BEFORE any async work.
      // This ensures REQUEST_AD4M_CONFIG from embedded apps (e.g. Flux) is never dropped,
      // including during the ad4m-connect auth flow on first load where auth can take many
      // seconds and the embedded app's 30-second timeout would otherwise expire.
      setupMessageListener();

      if (platform.isDesktop && platform.getConnectionDetails) {
        const { port, token, url } = await platform.getConnectionDetails();
        // Set url BEFORE signals — createEffect fires synchronously when signals change,
        // so url must be in place before setAd4mPort/setAd4mToken trigger the flush.
        if (url) ad4mUrlValue = url;
        setAd4mPort(port);
        setAd4mToken(token);
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
        const { port, token, url } = await platform.getConnectionDetails();
        // Set url BEFORE signals — createEffect fires synchronously when signals change,
        // so url must be in place before setAd4mPort/setAd4mToken trigger the flush.
        if (url) ad4mUrlValue = url;
        setAd4mPort(port);
        setAd4mToken(token);
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

      // Restore the original URL (e.g. a deep link opened via refresh), falling back to '/'
      routeStore.navigate(initialPath || '/');
    } catch (error) {
      console.error('AdamStore: initialiseStore error', error);
      setBootState('error');
    }
  }

  // Track if an iframe requested AD4M_CONFIG while the agent was still locked
  let pendingConfigRequest = false;
  let ad4mUrlValue: string | undefined = undefined;

  function sendAdamConfigToIframe(port: number, token: string, url?: string) {
    // Send to ALL mounted we-iframe elements (there may be multiple apps)
    const weIframes = document.querySelectorAll('we-iframe') as NodeListOf<
      HTMLElement & { postMessage: (data: Record<string, unknown>, origin: string) => void }
    >;

    let sent = 0;
    weIframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        el.postMessage({ type: 'AD4M_CONFIG', port, token, ...(url ? { url } : {}) }, '*');
        sent++;
      }
    });

    if (sent === 0) {
      console.warn('AdamStore: no we-iframe elements found to send AD4M_CONFIG');
    }
  }

  function setupMessageListener() {
    // Listen for requests from iframes asking for AD4M config.
    // Reads port/token from signals at call time so it works even when called before
    // credentials are available (e.g. during the web auth flow on first load).
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'REQUEST_AD4M_CONFIG') {
        // Immediately acknowledge so the embedded app knows the parent window is alive and
        // its "parent not found" timeout can be safely cancelled. The actual AD4M_CONFIG
        // follows as soon as credentials are available (possibly much later, after auth).
        const sourceFrame = event.source as Window | null;
        if (sourceFrame) {
          sourceFrame.postMessage({ type: 'AD4M_CONFIG_ACK' }, '*');
        }

        const port = ad4mPort();
        const token = ad4mToken();
        const agentReady = !platform.isDesktop || bootState() === 'ready';
        if (port !== undefined && token !== undefined && agentReady) {
          // Credentials available and agent is unlocked — respond immediately
          sendAdamConfigToIframe(port, token, ad4mUrlValue);
        } else {
          // Either credentials not yet available, or on desktop the agent is still locked.
          // Queue; the createEffect below flushes once conditions are met.
          pendingConfigRequest = true;
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Cleanup function
    return () => window.removeEventListener('message', handleMessage);
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
          AgentProfile.findOne(existing, { include: { location: true } }),
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

        // Restore the global perspective if previously joined — model registration is handled
        // by SpaceStore.installSpaceSdna when the perspective is navigated to.
        const seedUrl = (weSeedFile as WeSeedFile).globalSpaceUrl;
        const existingGlobal = seedUrl ? perspectives.find((p) => p.sharedUrl === seedUrl) : undefined;
        if (existingGlobal) {
          setGlobalPerspective(existingGlobal);
          console.log('AdamStore: Restored global perspective', existingGlobal.uuid);
          // Sync profile on boot so the global space always has up-to-date data
          const currentProfile = agentProfile();
          if (currentProfile) {
            syncAgentProfileToParent(currentProfile, existingGlobal).catch((err) =>
              console.error('AdamStore: boot sync agentProfile to global failed', err),
            );
          }
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
    const rootP = rootPerspective();
    if (!profile || !rootP) return;

    Object.assign(profile, updates);
    await profile.save();

    // Re-fetch to restore the hydrated location relation that save() clears
    const updated = await AgentProfile.findOne(rootP, { include: { location: true } });
    if (updated) {
      setAgentProfile(updated);
      const globalP = globalPerspective();
      if (globalP) {
        syncAgentProfileToParent(updated, globalP).catch((err) =>
          console.error('AdamStore: syncAgentProfileToGlobal failed', err),
        );
      }
    }
  }

  async function updateAvatarImage(imageFile: File): Promise<void> {
    const profile = agentProfile();
    const rootP = rootPerspective();
    if (!profile || !rootP) return;

    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    profile.avatar = { data_base64: imageBase64, name: 'profile-image', file_type: 'image/png' } as FileData;
    await profile.save();

    // Sync BEFORE re-fetching — at this point profile.avatar is still a FileData object
    // that FILE_STORAGE_LANGUAGE can consume. After findOne() it becomes a data URL string.
    const globalP = globalPerspective();
    if (globalP) {
      syncAgentProfileToParent(profile, globalP).catch((err) =>
        console.error('AdamStore: syncAgentProfileToGlobal (avatar) failed', err),
      );
    }

    // Re-fetch to restore the hydrated location relation that save() clears
    const updated = await AgentProfile.findOne(rootP, { include: { location: true } });
    if (updated) {
      setAgentProfile(updated);
    }
  }

  async function updateCoverImage(imageFile: File): Promise<void> {
    const profile = agentProfile();
    const rootP = rootPerspective();
    if (!profile || !rootP) return;

    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    profile.coverImage = { data_base64: imageBase64, name: 'cover-image', file_type: 'image/png' } as FileData;
    await profile.save();

    // Sync BEFORE re-fetching — at this point profile.coverImage is still a FileData object
    // that FILE_STORAGE_LANGUAGE can consume. After findOne() it becomes a data URL string.
    const globalP = globalPerspective();
    if (globalP) {
      syncAgentProfileToParent(profile, globalP).catch((err) =>
        console.error('AdamStore: syncAgentProfileToGlobal (coverImage) failed', err),
      );
    }

    // Re-fetch to restore the hydrated location relation that save() clears
    const updated = await AgentProfile.findOne(rootP, { include: { location: true } });
    if (updated) {
      setAgentProfile(updated);
    }
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

      // Restore the original URL if the user was on a deep link before the login screen
      routeStore.navigate(initialPath || '/');
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
    const updated = await AgentProfile.findOne(rootP, { include: { location: true } });
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

  async function addSpaceToPerspective(
    perspective: PerspectiveProxy,
    space: Partial<Space>,
    location?: Partial<LocationBlock>,
  ): Promise<Space> {
    const spaceModel = await Space.create(perspective, space);
    if (location) {
      const locationModel = await LocationBlock.create(perspective, location);
      await spaceModel.setLocation(locationModel);
    }
    return spaceModel;
  }

  async function createSpace(
    name: string,
    description: string,
    visibility: 'personal' | 'shared' | 'public',
    avatarFile?: File,
    coverImageFile?: File,
    latitude?: number,
    longitude?: number,
    city?: string,
    country?: string,
    countryCode?: string,
  ): Promise<void> {
    const client = adamClient();
    if (!client) return;
    // Capture the active perspective now — it becomes the parent once the new space is created
    const parentPerspective = currentPerspective();
    setCreatingSpace(true);

    try {
      // Create the perspective
      const spacePerspective = await client.perspective.add(name);

      // Register SDNA models (full set, same as SpaceStore uses)
      await installSpaceSdna(spacePerspective);

      // HACK: Model.register resolves before the SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // If shared or public, publish as neighbourhood
      if (visibility !== 'personal') {
        const uid = crypto.randomUUID();
        const languages = await client.runtime.knownLinkLanguageTemplates();
        const templateAddress = languages?.[0];
        if (!templateAddress) throw new Error('No link language templates available to publish neighbourhood.');
        const templateData = JSON.stringify({ uid, name: `${name}-link-language` });
        const linkLanguage = await client.languages.applyTemplateAndPublish(templateAddress, templateData);
        await client.neighbourhood.publishFromPerspective(
          spacePerspective.uuid,
          linkLanguage.address,
          new Perspective([]),
        );
      }

      // Process avatar image if provided
      let avatarData: FileData | undefined;
      if (avatarFile) {
        const resized = await resizeImage(avatarFile, 0.6);
        avatarData = {
          data_base64: await blobToDataURL(resized),
          name: 'space-avatar',
          file_type: 'image/png',
        } as FileData;
      }

      // Process cover image if provided
      let coverImageData: FileData | undefined;
      if (coverImageFile) {
        const resized = await resizeImage(coverImageFile, 0.6);
        coverImageData = {
          data_base64: await blobToDataURL(resized),
          name: 'space-cover',
          file_type: 'image/png',
        } as FileData;
      }

      // Assemble Space + optional location data — used for both own and parent perspectives
      const spaceData = {
        uuid: spacePerspective.uuid,
        url: spacePerspective.sharedUrl ?? undefined,
        name,
        description,
        visibility,
        ...(avatarData && { avatar: avatarData }),
        ...(coverImageData && { coverImage: coverImageData }),
      };
      const locationName = city && country ? `${city}, ${country}` : (city ?? country ?? undefined);
      const locationData =
        latitude != null && longitude != null
          ? {
              latitude,
              longitude,
              ...(locationName && { name: locationName }),
              ...(city && { city }),
              ...(country && { country }),
              ...(countryCode && { countryCode }),
            }
          : undefined;

      // Write to own perspective
      const spaceModel = await addSpaceToPerspective(spacePerspective, spaceData, locationData);
      console.log('AdamStore: Created space model for new perspective', spaceModel);

      // Mirror into parent perspective — no re-fetch or findAll needed for a fresh creation
      if (parentPerspective && parentPerspective.uuid !== spacePerspective.uuid) {
        await addSpaceToPerspective(parentPerspective, spaceData, locationData).catch((err) =>
          console.error('AdamStore: mirror space to parent failed', err),
        );
      }

      // Update sidebar and navigate
      setMySpaces((prev) => [...prev, spaceModel]);
      // await setCurrentPerspective(spacePerspective.uuid);
      // routeStore.navigate(`/space/${spaceModel.uuid}/globe`);
    } catch (error) {
      console.error('AdamStore: createSpace error', error);
    } finally {
      setCreatingSpace(false);
    }
  }

  async function joinSpace(id: string): Promise<void> {
    const client = adamClient();
    if (!client) return;

    // Normalise the identifier to a full neighbourhood URL when appropriate:
    //   - Full URL passed directly → use as-is
    //   - CID (no hyphens, no '://') → prepend 'neighbourhood://'
    //   - UUID (contains '-') → no neighbourhood URL; only local lookup
    const neighbourhoodUrl = id.includes('://') ? id : !id.includes('-') ? 'neighbourhood://' + id : null;

    // If already joined locally, just focus the perspective.
    const existing = allPerspectives().find(
      (p) => p.uuid === id || (neighbourhoodUrl && p.sharedUrl === neighbourhoodUrl),
    );
    if (existing) {
      await switchPerspective(existing.uuid);
      return;
    }

    if (!neighbourhoodUrl) {
      console.warn('AdamStore: joinSpace — cannot determine neighbourhood URL for', id);
      return;
    }

    console.log('AdamStore: joining neighbourhood', neighbourhoodUrl);
    try {
      const handle = await client.neighbourhood.joinFromUrl(neighbourhoodUrl);
      const joinedP = await client.perspective.byUUID(handle.uuid);
      if (!joinedP) {
        console.error('AdamStore: failed to get perspective proxy after joining');
        return;
      }

      // If this is the configured global space, update globalPerspective and sync profile.
      const seedUrl = (weSeedFile as WeSeedFile).globalSpaceUrl;
      if (neighbourhoodUrl === seedUrl) {
        setGlobalPerspective(joinedP);
        const currentProfile = agentProfile();
        if (currentProfile) {
          syncAgentProfileToParent(currentProfile, joinedP).catch((err) =>
            console.error('AdamStore: post-join sync agentProfile to global failed', err),
          );
        }
      }

      await switchPerspective(joinedP.uuid);
      console.log('AdamStore: joined space', joinedP.uuid);
    } catch (error) {
      console.error('AdamStore: joinSpace error', error);
    }
  }

  /** The neighbourhood CID (with `neighbourhood://` stripped) for the global space, or null if unconfigured. */
  const globalSpaceId = (): string | null => {
    const url = (weSeedFile as WeSeedFile).globalSpaceUrl;
    return url ? url.replace('neighbourhood://', '') : null;
  };

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

  async function switchPerspective(uuid: string): Promise<void> {
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

      setCurrentPerspective(perspective);
    } catch (error) {
      console.error('AdamStore: switchPerspective error', error);
    }
  }

  createEffect(initialiseStore);

  // Resolve the route segment to a local perspective whenever the route changes.
  // Two cases:
  //   CID  — neighbourhood space (no hyphens, no '://'): look up by sharedUrl
  //   UUID — local/private perspective (contains '-'): set directly by UUID
  createEffect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return;
    const seg = segs[1];

    // CID — neighbourhood space: find an already-joined local perspective by sharedUrl
    if (!seg.includes('-')) {
      const p = allPerspectives().find((ap) => ap.sharedUrl === 'neighbourhood://' + seg);
      if (p) {
        const current = currentPerspective();
        if (current?.uuid !== p.uuid) void switchPerspective(p.uuid);
      } else {
        // No local perspective exists — clear current perspective so the join gate shows.
        setCurrentPerspective(null);
      }
      return;
    }

    // UUID — local/private perspective: set directly
    const current = currentPerspective();
    if (current?.uuid !== seg) void switchPerspective(seg);
  });

  // Send AD4M_CONFIG to iframes as soon as credentials are available AND the agent is unlocked.
  //
  // The two platforms have different timing:
  //
  // Web: port+token are set by getConnectionDetails() AFTER ad4m-connect's auth UI completes,
  // so the agent is already unlocked at that point. We send immediately — no need to wait for
  // the rest of the boot chain (getMySpaces etc.), which would add unnecessary delay against
  // the ACK-cleared but still-finite wait in ad4m-connect.
  //
  // Desktop: port+token are set early (before buildAd4mClient) from stored credentials, while
  // the agent may still be locked waiting for the user's password. Sending AD4M_CONFIG here
  // would cause ad4m-connect's checkAuth() to fail with "Agent is locked". We must wait until
  // bootState === 'ready' (set after login() completes) so the agent is unlocked first.
  createEffect(() => {
    const port = ad4mPort();
    const token = ad4mToken();
    // Always read bootState() before any early returns so SolidJS tracks it as a dependency.
    // Without this, when pendingConfigRequest is false on the first run, bootState() would
    // never be accessed and the effect would not re-run when the agent unlocks.
    const state = bootState();
    if (!pendingConfigRequest || port === undefined || token === undefined) return;
    if (platform.isDesktop && state !== 'ready') return;
    pendingConfigRequest = false;
    sendAdamConfigToIframe(port, token, ad4mUrlValue);
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
    orderedSidebarItems,
    personalSpaces,
    sharedSpaces,
    ad4mPort,
    ad4mToken,
    isDevelopment,
    globalSpaceConfigured,
    globalSpaceId,
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
    createSpace,
    removePerspective,
    switchPerspective,
    updateAgentSettings,
    updateAgentProfile,
    updateAvatarImage,
    updateCoverImage,
    reorderPerspectives,
    joinSpace,
    // activateGlobalPerspective,
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
