import { parseLit } from '@coasys/ad4m';
import type { AgentProfileSummary } from '@shared/agentHelpers';
import { getModelForPerspective, registerModel } from '@shared/registries/modelRegistry';
import { ensureModelRegistered, SPACE_MODELS } from '@shared/sdnaModels';
import { type LocationData, removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '@shared/syncHelpers';
import { deriveSlug } from '@shared/utils';
import { useAdamStore } from '@solid/stores';
import { createBlocks, deleteBlocks, reconcileBlocks } from '@we/block-shared';
import { CollectionBlock, compressImageToFileData, LocationBlock, Signal, SignalType, Space } from '@we/models';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

import { useRouteStore } from './RouteStore';
import { useTemplateStore } from './TemplateStore';
import { useThemeStore } from './ThemeStore';

export interface SpaceMetaUpdate {
  name?: string;
  description?: string;
  discovery?: 'listed' | 'hidden';
  location?: LocationData | null;
}

export interface FluxSubgroupMessage {
  id: string;
  author: string;
  timestamp: string;
  body: string;
}

export interface SpaceStore {
  // State
  memberDids: Accessor<string[]>;
  members: Accessor<AgentProfileSummary[]>;
  spaceDefaultTemplateId: Accessor<string>;
  spaceDefaultThemeId: Accessor<string>;
  currentSpace: Accessor<Space | null>;
  /** Name/description/avatar detected from a foreign app's own model (e.g. Flux's Community),
   * for prefilling the "Initialize as WE space" gate. Null once the perspective is a WE space,
   * or if no recognized foreign model is found. */
  foreignSpacePrefill: Accessor<{ name: string; description: string; avatar: string | null } | null>;

  // Actions
  createPost: (json: unknown) => Promise<void>;
  updatePost: (postId: string, json: unknown) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  updateSpaceImage: (field: 'avatar' | 'coverImage', imageFile: File) => Promise<void>;
  updateSpaceMeta: (updates: SpaceMetaUpdate) => Promise<void>;
  setSpaceDefaultTemplate: (templateId: string) => Promise<void>;
  setSpaceDefaultTheme: (themeId: string) => Promise<void>;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  navigateToSpace: (spaceId: string, view?: string) => Promise<void>;
  getSubgroupMessages: (subgroupId: string) => Promise<FluxSubgroupMessage[]>;

  // Testing
  test: () => Promise<void>;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution (runs once at module load)
// Use .className (set by @Model decorator) rather than .name — bundlers mangle
// the native .name property in production builds, breaking registry lookups.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const M of SPACE_MODELS) registerModel((M as any).className, M as any);

export function SpaceStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();
  const templateStore = useTemplateStore();
  const themeStore = useThemeStore();

  async function test() {
    const p = adamStore.currentPerspective();
    if (!p) return;
    const spaces = await Space.findAll(p, { include: { location: true } });
    console.log('Spaces in perspective:', spaces);

    console.log('spaceId: ', p.uuid);

    // const posts = await CollectionBlock.findAll(p, {
    //   where: { type: 'root' },
    //   include: {
    //     signals: true,
    //     $mySignal: {
    //       from: 'signals',
    //       where: { signalTypeId: signalTypesBySlug().like.id, author: adamStore!.me().did },
    //     },
    //     $totalSignals: { from: 'signals', where: { signalTypeId: signalTypesBySlug().like.id }, count: true },
    //   },
    // });
    // console.log('Posts in perspective:', posts);
  }

  async function createPost(json: unknown): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;
    await createBlocks(p, json);
  }

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    await reconcileBlocks(p, existingRoot, json);
  }

  async function deletePost(postId: string): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;
    await deleteBlocks(p, postId);
  }

  async function navigateToSpace(spaceId: string, view?: string): Promise<void> {
    // Resolve perspective from spaceId (CID has no hyphens, UUID does)
    const perspective = spaceId.includes('-')
      ? adamStore.allPerspectives().find((p) => p.uuid === spaceId)
      : adamStore.allPerspectives().find((p) => p.sharedUrl === 'neighbourhood://' + spaceId);

    if (perspective) {
      // Pre-load space templates before switching so the template and data arrive together
      await templateStore.preloadSpaceTemplates(perspective);
      await adamStore.switchPerspective(perspective.uuid);
    }
    // If no perspective found, route change alone will show the join gate

    const segs = routeStore.segments();
    const currentView = view ?? (segs[0] === 'space' && segs[2] ? segs[2] : 'about');
    const targetPath = '/space/' + spaceId + '/' + currentView;
    templateStore.closeShellView();
    routeStore.navigate(targetPath);
    // Notify embedded app iframes (e.g. Flux) after perspective has switched
    broadcastPerspectiveNavigation(spaceId);
  }

  function broadcastPerspectiveNavigation(communityId: string): void {
    const iframes = document.querySelectorAll('we-iframe') as NodeListOf<
      HTMLElement & { postMessage: (data: unknown, origin: string) => void }
    >;
    iframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        el.postMessage({ type: 'NAVIGATE_PERSPECTIVE', communityId }, '*');
      }
    });
  }

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
    const currentPerspective = adamStore.currentPerspective();
    if (!currentPerspective) return;
    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'space-image' : 'space-cover');
    const [spaceModel] = await Space.findAll(currentPerspective, { where: spaceSelfWhere(currentPerspective) });
    if (!spaceModel) return;
    await Space.update(currentPerspective, spaceModel.id, { [field]: fileData });
    if (spaceModel.discovery === 'listed') {
      const globalP = adamStore.globalPerspective();
      if (globalP) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceModel, globalP, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate): Promise<void> {
    const currentPerspective = adamStore.currentPerspective();
    if (!currentPerspective) return;

    const [spaceModel] = await Space.findAll(currentPerspective, {
      where: spaceSelfWhere(currentPerspective),
      include: { location: true },
    });
    if (!spaceModel) return;

    const previousDiscovery = spaceModel.discovery;

    if (updates.name !== undefined) spaceModel.name = updates.name;
    if (updates.description !== undefined) spaceModel.description = updates.description;
    if (updates.discovery !== undefined) spaceModel.discovery = updates.discovery;
    await spaceModel.save();

    if (updates.location !== undefined) {
      if (updates.location === null) {
        const [existingLoc] = await LocationBlock.findAll(currentPerspective);
        if (existingLoc) {
          try {
            await existingLoc.delete();
          } catch (err) {
            console.error('[SpaceStore] location delete failed:', err);
          }
        }
      } else {
        const loc = updates.location;
        // Always delete + recreate so setLocation updates the Space's we://location triple,
        // which triggers the reactive currentSpace subscription to re-query with fresh data.
        // LocationBlock.update only changes nested triples and doesn't trigger the Space query.
        const [existingLoc] = await LocationBlock.findAll(currentPerspective);
        if (existingLoc) await existingLoc.delete();
        await ensureModelRegistered(currentPerspective, LocationBlock);
        const newLoc = await LocationBlock.create(currentPerspective, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.name && { name: loc.name }),
          ...(loc.city && { city: loc.city }),
          ...(loc.country && { country: loc.country }),
          ...(loc.countryCode && { countryCode: loc.countryCode }),
        });
        await spaceModel.setLocation(newLoc);
      }
    }

    const globalP = adamStore.globalPerspective();
    if (!globalP) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      // Pass locationData explicitly when location changed — the included spaceModel.location
      // snapshot is stale after our delete+recreate. null signals explicit removal to syncSpaceToParent.
      const syncOpts = updates.location !== undefined ? { locationData: updates.location } : {};
      await syncSpaceToParent(spaceModel, globalP, syncOpts).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceModel.uuid, globalP).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
  }

  async function createSignalType(config: Partial<SignalType>): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;
    // Fixed ranges for modes where the user doesn't configure them
    const rangeOverrides: Record<string, { rangeMin: number; rangeMax: number }> = {
      toggle: { rangeMin: 0, rangeMax: 1 },
      vote: { rangeMin: -1, rangeMax: 1 },
    };
    const slugFromName = config.name ? deriveSlug(config.name) : '';
    const effectiveSlug = config.slug ? config.slug : slugFromName;
    const withSlug = { ...config, slug: effectiveSlug };
    const normalised =
      withSlug.mode && rangeOverrides[withSlug.mode] ? { ...withSlug, ...rangeOverrides[withSlug.mode] } : withSlug;
    await SignalType.create(p, normalised);
  }

  async function upsertSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
    const p = adamStore.currentPerspective();
    const myDid = adamStore.me()?.did;
    if (!p || !myDid) return;

    const existing = await Signal.findOne(p, {
      parent: { id: nodeId, predicate: 'we://signal' },
      where: { signalTypeId, author: myDid },
    });

    if (existing) await existing.delete();
    if (value === 0) return;
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
  }

  // Flux's ConversationSubgroup has no typed HasMany relation to its items — they're
  // heterogeneous (messages/posts/tasks), linked only via the raw `flux://has_item`
  // predicate and resolved in Flux's own code through ad-hoc SPARQL (see
  // ConversationSubgroup.itemsData() in @coasys/flux-api). That means the normal
  // $query/include/parent path can't reach them, since it only knows about relations
  // registered in the target model's shape. This mirrors that same SPARQL shape directly
  // against the perspective, scoped to messages only, without depending on the flux package.
  async function getSubgroupMessages(subgroupId: string): Promise<FluxSubgroupMessage[]> {
    const p = adamStore.currentPerspective();
    if (!p) return [];
    const sparqlQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      SELECT ?id ?author ?timestamp ?body WHERE {
        <${subgroupId}> <flux://has_item> ?id .
        ?_reifier rdf:reifies <<( <${subgroupId}> <flux://has_item> ?id )>> .
        ?_reifier <ad4m://ontology/timestamp> ?timestamp .
        ?id <flux://entry_type> <flux://has_message> .
        ?_typeReifier rdf:reifies <<( ?id <flux://entry_type> <flux://has_message> )>> .
        ?_typeReifier <ad4m://ontology/author> ?author .
        OPTIONAL { ?id <flux://body> ?body . }
      }
      ORDER BY ?timestamp
    `;
    type Binding = { id: string; author: string; timestamp: string; body?: string };
    try {
      const result = await p.querySparql<Binding[]>(sparqlQuery);
      return (result || []).map((r) => ({
        id: r.id,
        author: r.author,
        timestamp: r.timestamp,
        body: parseLit(r.body),
      }));
    } catch (err) {
      console.error('SpaceStore: getSubgroupMessages failed', err);
      return [];
    }
  }

  const [currentSpace, setCurrentSpace] = createSignal<Space | null>(null);

  // Subscribe to current space data reactively whenever the perspective changes.
  // include: { location: true } so AboutRoute can access location without a separate query.
  createEffect(() => {
    const p = adamStore.currentPerspective();
    if (!p || !adamStore.isWeSpace()) {
      setCurrentSpace(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = (Space as any).query(p, { where: spaceSelfWhere(p), include: { location: true } }) as {
      subscribe: (cb: (results: Space[]) => void) => Promise<Space[]>;
      dispose: () => void;
    };
    const handleResult = (results: Space[]) => setCurrentSpace(results[0] ?? null);
    builder
      .subscribe(handleResult)
      .then(handleResult)
      .catch(() => setCurrentSpace(null));
    onCleanup(() => builder.dispose());
  });

  const [memberDids, setMemberDids] = createSignal<string[]>([]);
  const [spaceDefaultTemplateId, setSpaceDefaultTemplateId] = createSignal<string>('');
  const [spaceDefaultThemeId, setSpaceDefaultThemeId] = createSignal<string>('');

  // Derive from currentSpace; signals remain writable for optimistic updates
  createEffect(() => setSpaceDefaultTemplateId(currentSpace()?.defaultTemplateId ?? ''));
  createEffect(() => setSpaceDefaultThemeId(currentSpace()?.defaultThemeId ?? ''));

  // Apply the space's default theme when entering a space, restore personal theme when leaving.
  // Only restore when there's genuinely no current perspective — not during the transient null
  // window while switching between spaces (currentSpace loads async after perspective changes).
  createEffect(() => {
    const themeId = spaceDefaultThemeId();
    // Explicitly track space identity: navigating to a different space must always
    // re-apply that space's default theme, even when the new space's default happens
    // to equal the previous one. Without this, spaceDefaultThemeId wouldn't change
    // value across the navigation, and Solid would skip re-running this effect —
    // leaving a theme manually switched to in the old space stuck active.
    void currentSpace()?.uuid;
    if (themeId) {
      themeStore.replaceTheme(themeId);
    } else if (!adamStore.currentPerspective()) {
      themeStore.restorePersonalTheme();
    } else {
      // In a space with no default theme — clear any previously scoped space theme.
      themeStore.clearSpaceTheme();
    }
  });

  async function setSpaceDefaultTemplate(templateId: string): Promise<void> {
    setSpaceDefaultTemplateId(templateId);
    const template = templateStore.allTemplates().find((t) => t.id === templateId);
    if (template) templateStore.replaceTemplate(template);
    const p = adamStore.currentPerspective();
    if (!p) return;
    // Keep mySpaces cache in sync so template pre-loading uses the fresh defaultTemplateId
    adamStore.updateSpaceInCache(p, { defaultTemplateId: templateId } as never);
    const [space] = await Space.findAll(p, { where: spaceSelfWhere(p) });
    if (space) await Space.update(p, space.id, { defaultTemplateId: templateId });
  }

  async function setSpaceDefaultTheme(themeId: string): Promise<void> {
    setSpaceDefaultThemeId(themeId);
    const p = adamStore.currentPerspective();
    if (!p) return;
    adamStore.updateSpaceInCache(p, { defaultThemeId: themeId } as never);
    const [space] = await Space.findAll(p, { where: spaceSelfWhere(p) });
    if (space) await Space.update(p, space.id, { defaultThemeId: themeId });
  }

  // Load neighbourhood members whenever the current perspective changes
  createEffect(() => {
    const p = adamStore.currentPerspective();
    const client = adamStore.adamClient();
    const myDid = adamStore.me()?.did;
    if (!p || !client) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    client.neighbourhood
      .otherAgents(p.uuid)
      .then((dids: string[]) => {
        const allDids = myDid ? [...new Set([myDid, ...dids])] : dids;
        setMemberDids(allDids);
        for (const did of allDids) {
          adamStore.fetchAgent(did);
        }
      })
      .catch(() => {
        setMemberDids(myDid ? [myDid] : []);
      });
  });

  // Map memberDids to cached AgentProfileSummary entries
  const members = createMemo<AgentProfileSummary[]>(() => {
    const cached = adamStore.agents();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  // Resolve the route segment to a local perspective whenever the route changes.
  // Handles deep links, page refresh, and browser back/forward navigation.
  // For intentional navigation via navigateToSpace, this becomes a no-op
  // (perspective already switched; guard prevents double-call).
  createEffect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return;
    const seg = segs[1];

    // CID — neighbourhood space: find an already-joined local perspective by sharedUrl
    if (!seg.includes('-')) {
      const p = adamStore.allPerspectives().find((ap) => ap.sharedUrl === 'neighbourhood://' + seg);
      if (!p) {
        adamStore.clearCurrentPerspective();
        return;
      }
      const current = untrack(adamStore.currentPerspective);
      if (current?.uuid === p.uuid) return;
      void (async () => {
        await templateStore.preloadSpaceTemplates(p);
        await adamStore.switchPerspective(p.uuid);
      })();
      return;
    }

    // UUID — local/private perspective
    const current = untrack(adamStore.currentPerspective);
    if (current?.uuid === seg) return;
    const p = adamStore.allPerspectives().find((ap) => ap.uuid === seg);
    if (!p) return;
    void (async () => {
      await templateStore.preloadSpaceTemplates(p);
      await adamStore.switchPerspective(p.uuid);
    })();
  });

  // Prefill data for the "Initialize as WE space" gate — detected from a foreign app's own
  // model (currently just Flux's Community) when the current perspective isn't a WE space yet.
  const [foreignSpacePrefill, setForeignSpacePrefill] = createSignal<
    { name: string; description: string; avatar: string | null } | null
  >(null);

  createEffect(() => {
    const p = adamStore.currentPerspective();
    const weSpace = adamStore.isWeSpace();
    // Force a re-run once registerDynamicModels has populated the per-perspective registry —
    // that happens in switchPerspective's background IIFE, strictly before currentPerspectiveModels
    // is set, so tracking it here guarantees a second run right when getModelForPerspective is ready.
    void adamStore.currentPerspectiveModels();

    if (!p || weSpace) {
      setForeignSpacePrefill(null);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CommunityClass = getModelForPerspective('Community', p.uuid) as any;
    if (!CommunityClass) {
      setForeignSpacePrefill(null);
      return;
    }

    CommunityClass.findOne(p, {})
      .then((instance: { name?: string; description?: string; thumbnail?: string } | null) => {
        if (!instance || untrack(adamStore.currentPerspective)?.uuid !== p.uuid) return;
        setForeignSpacePrefill({
          name: instance.name ?? '',
          description: instance.description ?? '',
          avatar: instance.thumbnail ?? null,
        });
      })
      .catch(() => setForeignSpacePrefill(null));
  });

  const store: SpaceStore = {
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    currentSpace,
    foreignSpacePrefill,

    // Actions
    createPost,
    updatePost,
    deletePost,
    updateSpaceImage,
    updateSpaceMeta,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    createSignalType,
    upsertSignal,
    navigateToSpace,
    getSubgroupMessages,

    test,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
