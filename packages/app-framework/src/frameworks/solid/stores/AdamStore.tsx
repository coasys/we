import { Ad4mClient, Agent, Perspective, type PerspectiveProxy } from '@coasys/ad4m';
import {
  type AgentProfileSummary,
  FILE_STORAGE_LANGUAGE,
  getProfile,
  isProfileEmpty,
  type PublishProfileFields,
  publishProfileToPublicPerspective,
} from '@shared/agentHelpers';
import { getModelClasses, getModelManifest } from '@shared/perspectiveHelpers';
import { usePlatform } from '@shared/platform';
import { registerDynamicModels } from '@shared/registries/modelRegistry';
import { deduplicateSpaceSdna, installRootSdna, installSpaceSdna } from '@shared/sdnaModels';
import {
  isSpaceSelf,
  type LocationData,
  removeSpaceFromParent,
  spaceSelfWhere,
  syncSpaceToParent,
} from '@shared/syncHelpers';
import {
  AgentSettings,
  compressImageToFileData,
  dataURIToFileData,
  type FileData,
  LocationBlock,
  Space,
} from '@we/models';

// Space.avatar/coverImage are typed as string (resolved data URI on read) but accept FileData on write.
// This input type reflects the actual write-path contract.
type SpaceInput = Omit<Partial<Space>, 'avatar' | 'coverImage'> & {
  avatar?: FileData | string;
  coverImage?: FileData | string;
};
import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  ParentProps,
  useContext,
} from 'solid-js';

import weSeedFile from '../../../../../../we-seed.json';
import type { WeSeedFile } from '../../../types/seed';
import { useRouteStore } from './RouteStore';

export { type Ad4mClient, type PerspectiveProxy } from '@coasys/ad4m';

export type { ModelManifestEntry, ModelManifestProperty } from '@shared/AdamStore';
import type { ModelManifestEntry } from '@shared/AdamStore';

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
  globalSpaceConfigured: Accessor<boolean>;
  marketplaceConfigured: Accessor<boolean>;
  marketplaceId: () => string | null;
  marketplaceJoined: Accessor<boolean>;
  marketplacePerspective: Accessor<PerspectiveProxy | null>;
  rootPerspective: Accessor<PerspectiveProxy | null>;
  testPerspective: Accessor<PerspectiveProxy | null>;
  globalPerspective: Accessor<PerspectiveProxy | null>;
  systemPerspectiveUuids: Accessor<string[]>;
  orderedPerspectives: Accessor<PerspectiveProxy[]>;
  orderedSidebarItems: Accessor<
    { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[]
  >;
  globalSpaceId: () => string | null;
  agentSettings: Accessor<AgentSettings | null>;
  creatingSpace: Accessor<boolean>;
  currentPerspective: Accessor<PerspectiveProxy | null>;
  currentPerspectiveSharedUrl: Accessor<string | undefined>;
  currentPerspectiveSharedCid: Accessor<string | undefined>;
  currentPerspectiveModels: Accessor<ModelManifestEntry[]>;
  /** True once the current perspective is confirmed to have WE's `Space` SDNA installed. */
  isWeSpace: Accessor<boolean>;
  joinedSpaceCids: Accessor<string[]>;
  agents: Accessor<AgentProfileSummary[]>;

  // Actions
  login: (password: string) => Promise<void>;
  fetchAgent: (did: string) => Promise<void>;
  logout: () => Promise<void>;
  createSpace: (
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
  ) => Promise<void>;
  initializeAsWeSpace: (name: string, description: string, avatarValue?: File | string | null) => Promise<Space>;
  removePerspective: (uuid: string) => Promise<void>;
  switchPerspective: (uuid: string) => Promise<void>;
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<void>;
  updateProfileImage: (field: 'avatar' | 'coverImage', imageFile: File) => Promise<void>;
  reorderPerspectives: (newOrder: string[]) => Promise<void>;
  joinSpace: (id: string) => Promise<void>;
  removeSpaceFromGlobal: (spaceUuid: string) => Promise<void>;
  /** One-time remediation for a space that already accumulated duplicate SDNA installs
   * (from before joinSpace checked for existing SDNA) — removes the redundant duplicate
   * link copies so schema reads stop scaling with the number of past installers.
   * Defaults to the currently active perspective. Returns the number of links removed. */
  cleanupSpaceSdna: (uuid?: string) => Promise<number>;
  updateAgentLocation: (update: {
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    countryCode?: string;
  }) => Promise<void>;
  updateOwnProfile: (fields: Pick<AgentProfileSummary, 'firstName' | 'lastName' | 'handle' | 'bio'>) => Promise<void>;
  ownAgent: Accessor<AgentProfileSummary | undefined>;
  updateSpaceInCache: (perspective: PerspectiveProxy, updates: Partial<Space>) => void;
  clearCurrentPerspective: () => void;
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
  const [marketplacePerspective, setMarketplacePerspective] = createSignal<PerspectiveProxy | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });
  const [allPerspectives, setAllPerspectives] = createSignal<PerspectiveProxy[]>([]);
  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [creatingSpace, setCreatingSpace] = createSignal(false);
  const [currentPerspective, setCurrentPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [currentPerspectiveModels, setCurrentPerspectiveModels] = createSignal<ModelManifestEntry[]>([]);
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [agents, setAgents] = createSignal<AgentProfileSummary[]>([]);

  // In-flight deduplication for fetchAgent — prevents concurrent fetches for the same DID
  const inflightFetches = new Map<string, Promise<void>>();

  const ownAgent = createMemo(() => {
    const myDid = me()?.did;
    return myDid ? agents().find((a) => a.did === myDid) : undefined;
  });

  // Converts null → undefined so that when JSON-serialised into an ORM WHERE clause,
  // personal perspectives (no sharedUrl) produce {} rather than {"url":null}.
  const currentPerspectiveSharedUrl = createMemo<string | undefined>(
    () => currentPerspective()?.sharedUrl ?? undefined,
  );
  // CID-only form (neighbourhood:// stripped) for comparing against Space.url,
  // which stores only the CID to avoid URI resolution in the AD4M triple store.
  const currentPerspectiveSharedCid = createMemo<string | undefined>(
    () => currentPerspective()?.sharedUrl?.replace('neighbourhood://', '') ?? undefined,
  );
  const joinedSpaceCids = createMemo<string[]>(() =>
    allPerspectives()
      .filter((p) => p.sharedUrl)
      .map((p) => p.sharedUrl!.replace('neighbourhood://', '')),
  );

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

  // Derived: all non-system perspectives with Space avatar/name when available, plain perspective data otherwise.
  // Prepends a virtual pre-join entry for the global space when it is configured but the user hasn't joined yet.
  const orderedSidebarItems = createMemo(() => {
    // For joined spaces, s.uuid is the creator's local UUID which never matches the
    // joiner's p.uuid. Space.url stores only the CID (no neighbourhood:// prefix) to
    // avoid URI resolution in the triple store; strip the prefix when looking up.
    const spaceByUuid = new Map(mySpaces().map((s) => [s.uuid, s]));
    const spaceByUrl = new Map(
      mySpaces()
        .filter((s) => s.url)
        .map((s) => [s.url!, s]),
    );
    const items: { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[] =
      orderedPerspectives().map((p) => {
        const cid = p.sharedUrl?.replace('neighbourhood://', '');
        const s = (cid ? spaceByUrl.get(cid) : undefined) ?? spaceByUuid.get(p.uuid);
        return {
          uuid: p.uuid,
          name: s?.name ?? p.name,
          avatar: typeof s?.avatar === 'string' ? s.avatar : undefined,
          spaceId: p.sharedUrl ? p.sharedUrl.replace('neighbourhood://', '') : p.uuid,
        };
      });

    const seedUrl = (weSeedFile as unknown as WeSeedFile).globalSpaceUrl;
    const globalId = seedUrl ? seedUrl.replace('neighbourhood://', '') : null;
    const alreadyJoined = globalId ? items.some((item) => item.spaceId === globalId) : true;
    if (globalId && !alreadyJoined) {
      items.unshift({ uuid: 'global-pre-join', name: 'WE Discovery', spaceId: globalId, isGlobalPreJoin: true });
    }

    const mktUrl = (weSeedFile as unknown as WeSeedFile).marketplaceUrl;
    const mktId = mktUrl ? mktUrl.replace('neighbourhood://', '') : null;

    return mktId ? items.filter((item) => item.spaceId !== mktId) : items;
  });

  // Derived: personal and shared spaces
  const personalSpaces = createMemo(() => mySpaces().filter((s) => s.access === 'personal'));
  const sharedSpaces = createMemo(() => mySpaces().filter((s) => s.access === 'shared'));

  // Expose platform development mode to schemas
  const isDevelopment = () => platform.isDevelopment;
  const globalSpaceConfigured = () => !!(weSeedFile as unknown as WeSeedFile).globalSpaceUrl;
  const marketplaceConfigured = () => !!(weSeedFile as unknown as WeSeedFile).marketplaceUrl;
  const marketplaceId = (): string | null => {
    const url = (weSeedFile as unknown as WeSeedFile).marketplaceUrl;
    return url ? url.replace('neighbourhood://', '') : null;
  };
  const marketplaceJoined = createMemo(() => {
    const id = marketplaceId();
    return id ? joinedSpaceCids().includes(id) : false;
  });

  async function getMe(client: Ad4mClient): Promise<void> {
    try {
      setMe(await client.agent.me());
    } catch (error) {
      console.error('AdamStore: getMe error', error);
    }
  }

  function subscribeToPerspectiveChanges(client: Ad4mClient): void {
    client.perspective.addPerspectiveAddedListener((handle) => {
      if (allPerspectives().some((p) => p.uuid === handle.uuid)) return null;
      client.perspective.byUUID(handle.uuid).then((perspective) => {
        if (!perspective) return;
        // Log unexpected perspectives so we can identify and filter system ones
        const meAgent = me();
        const publicPerspectiveUuid = (meAgent?.perspective as { uuid?: string } | undefined)?.uuid;
        if (publicPerspectiveUuid && perspective.uuid === publicPerspectiveUuid) {
          console.log(
            'AdamStore: suppressing agent public perspective from sidebar',
            perspective.name,
            perspective.uuid,
          );
          return;
        }
        if (perspective.name?.toLowerCase().startsWith('agent perspective')) {
          console.log('AdamStore: suppressing agent perspective from sidebar', perspective.name, perspective.uuid);
          return;
        }
        // Re-check after the async gap: createSpace's eager update may have run while
        // we were waiting for byUUID to resolve, which would add a duplicate.
        if (allPerspectives().some((p) => p.uuid === handle.uuid)) return;
        setAllPerspectives((prev) => [...prev, perspective]);
        reorderPerspectives([...getPerspectiveOrder(), perspective.uuid]).catch(console.error);
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

  async function reorderPerspectives(newOrder: string[]): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;
    // Deduplicate while preserving order — guards against any remaining race between
    // the eager update in createSpace and the addPerspectiveAddedListener subscription.
    const deduped = [...new Set(newOrder)];
    settings.perspectiveOrder = JSON.stringify(deduped);
    await settings.save();
    setAgentSettings(settings);
  }

  async function getMySpaces(client: Ad4mClient): Promise<void> {
    try {
      const perspectives = await client.perspective.all();
      setAllPerspectives(perspectives);
      // we-root and we-test are system perspectives that never have Space SDNA installed —
      // calling Space.findOne on them produces an RPC 500 "No SHACL shape" error.
      const SYSTEM_PERSPECTIVES = ['we-root', 'we-test'];
      const candidatePerspectives = perspectives.filter((p) => !SYSTEM_PERSPECTIVES.includes(p.name));
      // Any other joined perspective without Space SDNA installed (e.g. a Flux
      // neighbourhood) would throw the same "No SHACL shape" error. Since these run in a
      // Promise.all, one rejection would otherwise abort the whole batch and hide every
      // real space's data (including avatars) until each is visited individually. Catch
      // per-perspective so one bad perspective can't poison the rest.
      const spaces = await Promise.all(
        candidatePerspectives.map(
          async (perspective) =>
            await Space.findOne(perspective, { where: spaceSelfWhere(perspective) }).catch(() => null),
        ),
      );
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

      // Seed own profile into the agents cache from the public perspective
      const ownDid = me()?.did;
      if (ownDid) fetchAgent(ownDid);

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

    // On desktop, pass the raw port/token so the embedded app can open its own WebSocket.
    // On web, the embedded app cannot reach localhost directly (browser PNA enforcement),
    // so we tell it to use the postMessage proxy instead. Port is intentionally omitted.
    const payload: Record<string, unknown> = platform.isDesktop
      ? { type: 'AD4M_CONFIG', port, token, ...(url ? { url } : {}) }
      : { type: 'AD4M_CONFIG', token, proxy: true };

    let sent = 0;
    weIframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        const rawSrc = el.getAttribute('src');
        const iframeOrigin = rawSrc ? new URL(rawSrc).origin : '*';
        el.postMessage(payload, iframeOrigin);
        sent++;
      }
    });

    if (sent === 0) {
      console.warn('AdamStore: no we-iframe elements found to send AD4M_CONFIG');
    }
  }

  function setupMessageListener() {
    // Tracks live WebSocket proxies keyed by the iframe's contentWindow.
    // Used when the host forwards AD4M WebSocket traffic on behalf of embedded apps
    // that cannot open their own connections (e.g. browser PNA enforcement on web).
    // origin is stored so proxy response frames can be targeted to the specific iframe
    // origin rather than broadcast with '*'.
    const proxyConnections = new Map<Window, { ws: WebSocket; origin: string }>();

    // Listen for requests from iframes asking for AD4M config.
    // Reads port/token from signals at call time so it works even when called before
    // credentials are available (e.g. during the web auth flow on first load).
    const handleMessage = (event: MessageEvent) => {
      const source = event.source as Window | null;

      // ── AD4M_PROXY_WS_* protocol ─────────────────────────────────────────
      // Embedded apps that receive proxy:true open no WebSocket themselves;
      // instead they send these messages and we proxy frames via a real WebSocket.

      if (event.data?.type === 'AD4M_PROXY_WS_CONNECT' && source) {
        // Gate: only serve requests from known we-iframe contentWindows.
        // we-iframe is a Lit web component — the real <iframe> lives inside its
        // shadow DOM, so we must look there rather than on the element itself.
        // Without this, any child iframe in WE's page could use WE as a
        // WebSocket proxy to the executor using WE's own auth token.
        const weIframesForWsCheck = document.querySelectorAll('we-iframe');
        const isKnownWsIframe = Array.from(weIframesForWsCheck).some(
          (el) => (el.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow === source,
        );
        if (!isKnownWsIframe) {
          console.warn('AdamStore: rejected AD4M_PROXY_WS_CONNECT from unknown source');
          return;
        }

        // Close any stale connection for this frame
        const existing = proxyConnections.get(source);
        if (existing) {
          existing.ws.close();
          proxyConnections.delete(source);
        }

        // Pin to the verified origin of the requesting iframe so all proxy
        // response frames are delivered only to that origin.
        // Reject if origin is empty — we must never fall back to '*' for
        // frames carrying sensitive GraphQL responses.
        if (!event.origin) {
          console.warn('AdamStore: rejected AD4M_PROXY_WS_CONNECT with empty origin');
          return;
        }
        const iframeOrigin = event.origin;

        const port = ad4mPort();
        const token = ad4mToken();
        const baseUrl = ad4mUrlValue ?? (port !== undefined ? `http://localhost:${port}` : null);
        if (!baseUrl) {
          source.postMessage({ type: 'AD4M_PROXY_WS_ERROR' }, iframeOrigin);
          return;
        }

        const wsBase = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
        const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';
        const wsUrl = tokenParam ? `${wsBase}/api/v1/ws?${tokenParam}` : `${wsBase}/api/v1/ws`;

        const ws = new WebSocket(wsUrl);
        proxyConnections.set(source, { ws, origin: iframeOrigin });

        ws.onopen = () => source.postMessage({ type: 'AD4M_PROXY_WS_OPEN' }, iframeOrigin);
        ws.onmessage = (e) => source.postMessage({ type: 'AD4M_PROXY_WS_MESSAGE', data: e.data }, iframeOrigin);
        ws.onerror = () => source.postMessage({ type: 'AD4M_PROXY_WS_ERROR' }, iframeOrigin);
        ws.onclose = (e) => {
          proxyConnections.delete(source);
          source.postMessage({ type: 'AD4M_PROXY_WS_CLOSED', code: e.code, reason: e.reason }, iframeOrigin);
        };
        return;
      }

      if (event.data?.type === 'AD4M_PROXY_WS_SEND' && source) {
        const entry = proxyConnections.get(source);
        if (entry && entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(event.data.data as string);
        }
        return;
      }

      if (event.data?.type === 'AD4M_PROXY_WS_CLOSE' && source) {
        const entry = proxyConnections.get(source);
        if (entry) {
          entry.ws.close(event.data.code as number | undefined, event.data.reason as string | undefined);
          proxyConnections.delete(source);
        }
        return;
      }

      // ── AD4M_PROXY_HTTP_* protocol ────────────────────────────────────────
      // Embedded apps that received proxy:true cannot make direct HTTP requests
      // to the executor (cross-origin / PNA). They send AD4M_PROXY_HTTP_REQUEST
      // and we make the real fetch from our privileged origin, then reply.
      if (event.data?.type === 'AD4M_PROXY_HTTP_REQUEST' && source) {
        // Gate: only serve requests from known we-iframe contentWindows, not from
        // arbitrary third-party pages that may have embedded WE as a child frame.
        // we-iframe is a Lit web component — the real <iframe> lives inside its shadow DOM.
        const weIframesForHttpCheck = document.querySelectorAll('we-iframe');
        const isKnownIframe = Array.from(weIframesForHttpCheck).some(
          (el) => (el.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow === source,
        );
        if (!isKnownIframe) {
          console.warn('AdamStore: rejected AD4M_PROXY_HTTP_REQUEST from unknown source');
          return;
        }

        const { id, url, method, headers, body } = event.data as {
          id: string;
          url: string;
          method: string;
          headers: Record<string, string>;
          body: ArrayBuffer | null;
        };
        const iframeOrigin = event.origin || '*';

        if (typeof url !== 'string' || typeof method !== 'string') {
          console.warn('AdamStore: rejected AD4M_PROXY_HTTP_REQUEST with invalid url/method type');
          return;
        }

        const port = ad4mPort();
        const baseUrl = ad4mUrlValue ?? (port !== undefined ? `http://localhost:${port}` : null);
        if (!baseUrl) {
          source.postMessage({ type: 'AD4M_PROXY_HTTP_ERROR', id, message: 'No executor URL available' }, iframeOrigin);
          return;
        }

        // Replace the placeholder origin with the real executor base URL.
        const realUrl = url.replace(/^http:\/\/proxy(?=\/|$)/, baseUrl);

        (async () => {
          try {
            const response = await fetch(realUrl, { method, headers, body: body ?? undefined });
            const responseBody = await response.arrayBuffer();
            source.postMessage(
              {
                type: 'AD4M_PROXY_HTTP_RESPONSE',
                id,
                status: response.status,
                statusText: response.statusText,
                body: responseBody,
              },
              iframeOrigin,
              [responseBody],
            );
          } catch (e) {
            source.postMessage(
              { type: 'AD4M_PROXY_HTTP_ERROR', id, message: e instanceof Error ? e.message : String(e) },
              iframeOrigin,
            );
          }
        })();
        return;
      }

      // ─────────────────────────────────────────────────────────────────────

      if (event.data?.type === 'REQUEST_AD4M_CONFIG') {
        // Immediately acknowledge so the embedded app knows the parent window is alive and
        // its "parent not found" timeout can be safely cancelled. The actual AD4M_CONFIG
        // follows as soon as credentials are available (possibly much later, after auth).
        if (source) {
          source.postMessage({ type: 'AD4M_CONFIG_ACK' }, event.origin || '*');
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

    // Cleanup: remove listener and close any open proxy WebSocket connections
    return () => {
      window.removeEventListener('message', handleMessage);
      proxyConnections.forEach(({ ws }) => ws.close());
      proxyConnections.clear();
    };
  }

  /**
   * Fetch an agent's profile from their public perspective and add it to the agents cache.
   * No-ops if the DID is already cached with actual profile data — a blank cached entry
   * (failed/raced fetch, or no profile published yet) is retried rather than stuck forever.
   * Deduplicates concurrent calls for the same DID.
   */
  async function fetchAgent(did: string): Promise<void> {
    const cleanedDid = did.replace('did://', '');
    const cached = agents().find((a) => a.did === cleanedDid);
    if (cached && !isProfileEmpty(cached)) return;

    const existing = inflightFetches.get(cleanedDid);
    if (existing) return existing;

    const client = adamClient();
    if (!client) return;

    const promise = getProfile(cleanedDid, client)
      .then((summary) => {
        setAgents((prev) => {
          const idx = prev.findIndex((a) => a.did === cleanedDid);
          if (idx === -1) return [...prev, summary];
          const next = [...prev];
          next[idx] = summary;
          return next;
        });
      })
      .catch((err) => {
        console.warn(`AdamStore: fetchAgent failed for ${cleanedDid}`, err);
      })
      .finally(() => {
        inflightFetches.delete(cleanedDid);
      });

    inflightFetches.set(cleanedDid, promise);
    return promise;
  }

  /** Find or create the root perspective and all other system perspectives.
   * Also re-registers we-global models if the perspective already exists (previously joined). */
  async function initSystemPerspectives(client: Ad4mClient): Promise<void> {
    try {
      const perspectives = await client.perspective.all();
      const rootP = perspectives.find((p) => p.name === 'we-root');

      if (rootP) {
        // Ensure all models are registered (handles new models added after initial creation)
        await installRootSdna(rootP);
        setRootPerspective(rootP);

        const settings = await AgentSettings.findOne(rootP);
        if (settings) setAgentSettings(settings);

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
        const seedUrl = (weSeedFile as unknown as WeSeedFile).globalSpaceUrl;
        const existingGlobal = seedUrl ? perspectives.find((p) => p.sharedUrl === seedUrl) : undefined;
        if (existingGlobal) {
          setGlobalPerspective(existingGlobal);
          console.log('AdamStore: Restored global perspective', existingGlobal.uuid);
        }

        const marketplaceUrl = (weSeedFile as unknown as WeSeedFile).marketplaceUrl;
        const existingMarketplace = marketplaceUrl
          ? perspectives.find((p) => p.sharedUrl === marketplaceUrl)
          : undefined;
        if (existingMarketplace) {
          setMarketplacePerspective(existingMarketplace);
          console.log('AdamStore: Restored marketplace perspective', existingMarketplace.uuid);
        }

        return;
      }

      // No root perspective exists — create one
      console.log('AdamStore: Creating root perspective');
      const perspective = await client.perspective.add('we-root');
      await installRootSdna(perspective);
      // Model.register resolves before SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      const settings = await AgentSettings.create(perspective, {
        currentTemplateId: 'default',
        currentThemeId: 'dark',
        defaultThemeId: 'dark',
      });

      setRootPerspective(perspective);
      setAgentSettings(settings);

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

  // TODO: could this be done cleaner with the .update() method on the model instead of mutating and saving?
  async function updateAgentSettings(updates: Partial<AgentSettings>): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;

    Object.assign(settings, updates);
    await settings.save();
    setAgentSettings(settings);
  }

  /**
   * Upload a profile image and write its expression URL to the agent's public perspective.
   * Optimistically updates the agents cache with the data URI for immediate display.
   */
  async function updateProfileImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
    const myDid = me()?.did;
    const client = adamClient();
    if (!myDid || !client) return;

    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'profile-image' : 'cover-image');
    // data_base64 from compressImageToFileData is raw base64 (no "data:" prefix) — rebuild the data URI
    // the same way resolveExpressionToDataUri does when reading it back after a refetch.
    const dataUri = `data:${fileData.file_type};base64,${fileData.data_base64}`;
    const expressionUrl = await client.expression.create(JSON.stringify(fileData), FILE_STORAGE_LANGUAGE);

    setAgents((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      if (!existing) return prev;
      return [...prev.filter((a) => a.did !== myDid), { ...existing, [field]: dataUri }];
    });

    const publishKey = field === 'avatar' ? 'avatarExpressionUrl' : 'coverImageExpressionUrl';
    await publishProfileToPublicPerspective({ [publishKey]: expressionUrl } as PublishProfileFields, client);
  }

  /**
   * Update the agent's location in their public perspective.
   * Pass a partial object — missing lat/lng are merged from the existing cached location.
   */
  async function updateAgentLocation(update: {
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    countryCode?: string;
  }): Promise<void> {
    const myDid = me()?.did;
    const client = adamClient();
    if (!myDid || !client) return;

    const existingLoc = agents().find((a) => a.did === myDid)?.location;
    const lat = update.latitude ?? existingLoc?.latitude;
    const lng = update.longitude ?? existingLoc?.longitude;
    if (lat == null || lng == null) return;

    const merged = {
      latitude: lat,
      longitude: lng,
      city: 'city' in update ? update.city : existingLoc?.city,
      country: 'country' in update ? update.country : existingLoc?.country,
    };

    setAgents((prev) => {
      const agent = prev.find((a) => a.did === myDid);
      if (!agent) return prev;
      return [...prev.filter((a) => a.did !== myDid), { ...agent, location: merged }];
    });

    await publishProfileToPublicPerspective({ location: merged }, client);
  }

  /**
   * Update one or more text fields of the own agent profile in the public perspective.
   * Merges with the existing cached entry and writes only the provided fields.
   */
  async function updateOwnProfile(
    fields: Pick<AgentProfileSummary, 'firstName' | 'lastName' | 'handle' | 'bio'>,
  ): Promise<void> {
    const myDid = me()?.did;
    const client = adamClient();
    if (!myDid || !client) return;

    setAgents((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      const base: AgentProfileSummary = existing ?? { did: myDid, firstName: '', lastName: '', handle: '', bio: '' };
      return [...prev.filter((a) => a.did !== myDid), { ...base, ...fields }];
    });

    const publishFields: PublishProfileFields = {};
    if ('firstName' in fields) publishFields.firstName = fields.firstName;
    if ('lastName' in fields) publishFields.lastName = fields.lastName;
    if ('handle' in fields) publishFields.handle = fields.handle;
    if ('bio' in fields) publishFields.bio = fields.bio;

    await publishProfileToPublicPerspective(publishFields, client);
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

      const ownDid = me()?.did;
      if (ownDid) fetchAgent(ownDid);

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

  async function addSpaceToPerspective(
    perspective: PerspectiveProxy,
    space: SpaceInput,
    location?: Partial<LocationBlock>,
  ): Promise<Space> {
    const spaceModel = await Space.create(perspective, space as Partial<Space>);
    if (location) {
      const locationModel = await LocationBlock.create(perspective, location);
      await spaceModel.setLocation(locationModel);
    }
    return spaceModel;
  }

  async function createSpace(
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
  ): Promise<void> {
    const client = adamClient();
    if (!client) return;
    setCreatingSpace(true);

    try {
      // Create the perspective
      const spacePerspective = await client.perspective.add(name);

      // Register SDNA models (full set, same as SpaceStore uses)
      await installSpaceSdna(spacePerspective);

      // HACK: Model.register resolves before the SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // If shared, publish as neighbourhood — capture the returned URL so it can be
      // stored on the Space model (spacePerspective.sharedUrl is not updated in-place).
      let neighbourhoodUrl: string | undefined;
      if (access === 'shared') {
        const uid = crypto.randomUUID();
        const languages = await client.runtime.knownLinkLanguageTemplates();
        const templateAddress = languages?.[0];
        if (!templateAddress) throw new Error('No link language templates available to publish neighbourhood.');
        const templateData = JSON.stringify({ uid, name: `${name}-link-language` });
        const linkLanguage = await client.languages.applyTemplateAndPublish(templateAddress, templateData);
        neighbourhoodUrl = await client.neighbourhood.publishFromPerspective(
          spacePerspective.uuid,
          linkLanguage.address,
          new Perspective([]),
        );
      }

      // Process avatar image if provided
      const avatarData = avatarFile ? await compressImageToFileData(avatarFile, 'space-avatar') : undefined;

      // Process cover image if provided
      const coverImageData = coverImageFile ? await compressImageToFileData(coverImageFile, 'space-cover') : undefined;

      // Assemble Space + optional location data — used for both own and parent perspectives
      const spaceData = {
        uuid: spacePerspective.uuid,
        url: neighbourhoodUrl?.replace('neighbourhood://', ''),
        name,
        description,
        access,
        discovery,
        defaultTemplateId: 'default',
        defaultThemeId: 'dark',
        ...(avatarData && { avatar: avatarData }),
        ...(coverImageData && { coverImage: coverImageData }),
      };
      const locationData = location ?? undefined;

      // Write to own perspective
      const spaceModel = await addSpaceToPerspective(spacePerspective, spaceData, locationData);
      console.log('AdamStore: Created space model for new perspective', spaceModel);

      // Sync to global discovery space when the user opted in.
      // Space.create returns relations unhydrated, so we pass avatarData, coverImageData,
      // and locationData directly rather than reading them back from spaceModel.
      if (discovery === 'listed') {
        const globalP = globalPerspective();
        if (globalP) {
          await syncSpaceToParent(spaceModel, globalP, {
            locationData,
            avatarData,
            coverImageData,
          }).catch((err) => console.error('AdamStore: sync space to global failed', err));
        }
      }

      // Update sidebar and navigate.
      // Eagerly add to allPerspectives for web (where the addPerspectiveAddedListener
      // subscription may not fire). Guarded so we don't double-add on desktop when the
      // subscription has already resolved its byUUID fetch and added the perspective first.
      if (!allPerspectives().some((p) => p.uuid === spacePerspective.uuid)) {
        setAllPerspectives((prev) => [...prev, spacePerspective]);
        await reorderPerspectives([...getPerspectiveOrder(), spacePerspective.uuid]);
      }
      setMySpaces((prev) => [...prev, spaceModel]);
      // await setCurrentPerspective(spacePerspective.uuid);
      // routeStore.navigate(`/space/${spaceModel.uuid}/globe`);
    } catch (error) {
      console.error('AdamStore: createSpace error', error);
    } finally {
      setCreatingSpace(false);
    }
  }

  /**
   * Turns the currently-viewed perspective — which already has some other app's
   * SDNA installed (e.g. a Flux Community) but not WE's — into a WE space in place.
   * Unlike createSpace, this never creates a new perspective or publishes a new
   * neighbourhood: the perspective is already a joined, published neighbourhood
   * (that's the only way it could be showing in the sidebar), so access is always
   * 'shared' here, not a real user choice.
   */
  async function initializeAsWeSpace(
    name: string,
    description: string,
    avatarValue?: File | string | null,
  ): Promise<Space> {
    const perspective = currentPerspective();
    if (!perspective) throw new Error('AdamStore: initializeAsWeSpace called with no active perspective');

    // Additive/idempotent — does not remove or touch the perspective's existing foreign SDNA.
    await installSpaceSdna(perspective);
    // HACK: Model.register resolves before SDNA is actually ready — same pattern used
    // in switchPerspective/createSpace/joinSpace.
    await new Promise((resolve) => setTimeout(resolve, 500));

    let avatarData: FileData | undefined;
    if (avatarValue instanceof File) {
      avatarData = await compressImageToFileData(avatarValue, 'space-avatar');
    } else if (typeof avatarValue === 'string' && avatarValue) {
      // Untouched prefill from the foreign app's own resolved (data-URI) image value —
      // round-tripped back through FILE_STORAGE_LANGUAGE rather than re-compressed.
      avatarData = dataURIToFileData(avatarValue, 'space-avatar');
    }

    const spaceData: SpaceInput = {
      uuid: perspective.uuid,
      url: perspective.sharedUrl?.replace('neighbourhood://', ''),
      name,
      description,
      access: 'shared',
      discovery: 'hidden',
      defaultTemplateId: 'default',
      defaultThemeId: 'dark',
      ...(avatarData && { avatar: avatarData }),
    };

    const spaceModel = await addSpaceToPerspective(perspective, spaceData);

    if (!mySpaces().some((s) => s.uuid === spaceModel.uuid)) {
      setMySpaces((prev) => [...prev, spaceModel]);
    }

    // Re-run switchPerspective on the same uuid rather than hand-duplicating its
    // classes/registerDynamicModels/manifest refresh: this atomically flips isWeSpace,
    // refreshes the dynamic model registry, and hands SpaceStore a new PerspectiveProxy
    // reference so its currentSpace effect re-fires now that a Space instance exists.
    await switchPerspective(perspective.uuid);

    return spaceModel;
  }

  async function joinSpace(id: string): Promise<void> {
    const client = adamClient();
    if (!client) return;
    if (!id || typeof id !== 'string') {
      console.warn('AdamStore: joinSpace called with invalid id', id);
      return;
    }

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

      // Install WE SDNA so Space, SignalType, CollectionBlock etc. are queryable
      // immediately. installSpaceSdna diffs against the perspective's actual state
      // before writing (see sdnaModels.ts), so this is safe to call unconditionally
      // even when the space's creator or an earlier joiner already installed it —
      // it won't write a duplicate copy.
      await installSpaceSdna(joinedP);
      // Give the SDNA write time to settle before reactive queries fire.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // If this is the configured global space, update globalPerspective.
      const seedUrl = (weSeedFile as unknown as WeSeedFile).globalSpaceUrl;
      if (neighbourhoodUrl === seedUrl) {
        setGlobalPerspective(joinedP);
      }

      // If this is the configured marketplace, update marketplacePerspective.
      const mktUrl = (weSeedFile as unknown as WeSeedFile).marketplaceUrl;
      if (neighbourhoodUrl === mktUrl) {
        setMarketplacePerspective(joinedP);
      }

      // Eagerly add to allPerspectives so derived state (e.g. marketplaceJoined,
      // joinedSpaceCids) updates immediately — addPerspectiveAddedListener will also
      // fire for this perspective, but that AD4M event can lag or arrive too late for
      // gates that key off allPerspectives, unlike currentPerspective which switchPerspective
      // sets synchronously below.
      if (!allPerspectives().some((p) => p.uuid === joinedP.uuid)) {
        setAllPerspectives((prev) => [...prev, joinedP]);
      }

      // Load the Space model and push into mySpaces so the sidebar shows the correct
      // name immediately, without requiring a reboot.
      const cid = neighbourhoodUrl.replace('neighbourhood://', '');
      const joinedSpaceModel = await Space.findOne(joinedP, { where: { url: cid } }).catch(() => null);
      if (joinedSpaceModel && !mySpaces().some((s) => s.url === joinedSpaceModel.url)) {
        setMySpaces((prev) => [...prev, joinedSpaceModel]);
      }

      await switchPerspective(joinedP.uuid);
      console.log('AdamStore: joined space', joinedP.uuid);
    } catch (error) {
      console.error('AdamStore: joinSpace error', error);
    }
  }

  async function cleanupSpaceSdna(uuid?: string): Promise<number> {
    const client = adamClient();
    if (!client) return 0;

    const targetUuid = uuid ?? currentPerspective()?.uuid;
    if (!targetUuid) {
      console.warn('AdamStore: cleanupSpaceSdna called with no uuid and no active perspective');
      return 0;
    }

    try {
      const perspective = await client.perspective.byUUID(targetUuid);
      if (!perspective) return 0;
      const removed = await deduplicateSpaceSdna(perspective);
      console.log(`AdamStore: cleanupSpaceSdna removed ${removed} duplicate SDNA link(s) from`, targetUuid);
      return removed;
    } catch (error) {
      console.error('AdamStore: cleanupSpaceSdna error', error);
      return 0;
    }
  }

  /** The neighbourhood CID (with `neighbourhood://` stripped) for the global space, or null if unconfigured. */
  const globalSpaceId = (): string | null => {
    const url = (weSeedFile as unknown as WeSeedFile).globalSpaceUrl;
    return url ? url.replace('neighbourhood://', '') : null;
  };

  async function removePerspective(uuid: string): Promise<void> {
    const client = adamClient();
    if (!client) return;

    try {
      const globalP = globalPerspective();
      const myDid = me()?.did;
      if (globalP && myDid) {
        // Only remove from global discovery if the current user is the author of that
        // space entry — a peer who joined and later deletes their local copy should not
        // affect the global listing.
        const spaceInGlobal = await Space.findOne(globalP, { where: { uuid } }).catch(() => null);
        if (spaceInGlobal && spaceInGlobal.author === myDid) {
          await removeSpaceFromParent(uuid, globalP).catch((err) =>
            console.error('AdamStore: removeSpaceFromParent on delete error', err),
          );
        }
      }
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

      // Check whether SDNA is already installed. This is a fast local conductor
      // lookup for already-joined spaces. If the perspective has no SHACL shapes
      // yet (first-time join race: addPerspectiveAddedListener fires before
      // joinSpace reaches installSpaceSdna), block here until SDNA is installed so
      // schema queries don't immediately throw "No SHACL shape" errors.
      let classes = await getModelClasses(perspective);
      if (Object.keys(classes).length === 0) {
        await installSpaceSdna(perspective);
        await new Promise((resolve) => setTimeout(resolve, 500));
        classes = await getModelClasses(perspective);
      }

      // SDNA is installed — switch immediately so WE templates render.
      // WE model classes are pre-registered at module load; no need to await
      // registerDynamicModels before the UI is usable.
      // isWeSpace is derived from `classes` (already fetched above) rather than the
      // async currentPerspectiveModels manifest below, which lags behind currentPerspective
      // and isn't reset on switch — deriving from it would let isWeSpace transiently read
      // stale/true for a perspective that doesn't actually have WE's Space SDNA.
      batch(() => {
        setIsWeSpace('Space' in classes);
        setCurrentPerspective(perspective);
      });

      // Background: register dynamic (non-WE) model classes and update manifest.
      // Also backfill mySpaces if the Space record wasn't synced from Holochain
      // at join time (joinSpace's Space.findOne may have returned null if the
      // creator's record hadn't propagated yet).
      // Stale guard: if the user navigated away before this resolves, skip updates.
      void (async () => {
        try {
          if (currentPerspective()?.uuid === uuid) registerDynamicModels(uuid, classes);
        } catch (err) {
          console.warn('AdamStore: registerDynamicModels failed', err);
        }

        try {
          const manifest = await getModelManifest(perspective);
          if (currentPerspective()?.uuid === uuid) setCurrentPerspectiveModels(manifest);
        } catch (err) {
          console.warn('AdamStore: getModelManifest failed', err);
          if (currentPerspective()?.uuid === uuid) setCurrentPerspectiveModels([]);
        }

        if (perspective.sharedUrl) {
          const sharedCid = perspective.sharedUrl.replace('neighbourhood://', '');
          if (!mySpaces().some((s) => s.url === sharedCid)) {
            const spaceModel = await Space.findOne(perspective, { where: { url: sharedCid } }).catch(() => null);
            if (spaceModel && !mySpaces().some((s) => s.url === spaceModel.url)) {
              setMySpaces((prev) => [...prev, spaceModel]);
            }
          }
        }
      })();
    } catch (error) {
      console.error('AdamStore: switchPerspective error', error);
    }
  }

  createEffect(initialiseStore);

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
    marketplaceConfigured,
    marketplaceId,
    marketplaceJoined,
    marketplacePerspective,
    rootPerspective,
    testPerspective,
    globalPerspective,
    systemPerspectiveUuids,
    agentSettings,
    creatingSpace,
    currentPerspective,
    currentPerspectiveSharedUrl,
    currentPerspectiveSharedCid,
    currentPerspectiveModels,
    isWeSpace,
    joinedSpaceCids,
    agents,
    ownAgent,

    // Actions
    login,
    fetchAgent,
    logout,
    createSpace,
    initializeAsWeSpace,
    removePerspective,
    switchPerspective,
    updateAgentSettings,
    updateProfileImage,
    updateOwnProfile,
    reorderPerspectives,
    joinSpace,
    cleanupSpaceSdna,
    updateAgentLocation,
    removeSpaceFromGlobal: (spaceUuid) => {
      const globalP = globalPerspective();
      if (!globalP) return Promise.resolve();
      return removeSpaceFromParent(spaceUuid, globalP);
    },
    updateSpaceInCache: (perspective, updates) => {
      setMySpaces((prev) =>
        prev.map((s) =>
          isSpaceSelf(s, perspective) ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, updates) : s,
        ),
      );
    },
    clearCurrentPerspective: () => {
      setCurrentPerspective(null);
      setIsWeSpace(false);
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
