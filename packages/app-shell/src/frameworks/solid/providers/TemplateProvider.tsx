import { queryIRFlag } from '@shared/queryIRFlag';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleStores } from '@shared/registries/moduleRegistry';
import { onSlotRegistryChanged, slotRegistry } from '@shared/registries/slotRegistry';
import { buildTemplateBag, CHROME_TIER, SPACE_TIER } from '@shared/registries/templateSurface';
import { hostSourceBag } from '@shared/sources';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import {
  useAccountStore,
  useAppStore,
  useDatasetStore,
  useEditorStore,
  useInterpretationStore,
  usePresenceStore,
  useProfileStore,
  useRecordStore,
  useRouteStore,
  useRuntimeStore,
  useSessionStore,
  useShapeStore,
  useShellStore,
  useSpaceStore,
  useTemplateStore,
  useThemeStore,
} from '@solid/stores';
import type { Stores } from '@solid/types';
import { Route, Router } from '@solidjs/router';
import { manifestEntries } from '@we/backend-shared';
import { BlockHostProvider, colorFor } from '@we/block-solid';
import { toastService } from '@we/components/solid';
import type { DatasetProxy } from '@we/entities';
import { getEntity } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import type { TemplateSchema } from '@we/schema-shared';
import { expandViewRoutes, hasViewsMarker } from '@we/schema-shared';
import type { VisualEditorContextValue } from '@we/schema-solid';
import { RenderSchema, VisualEditorProvider } from '@we/schema-solid';
import { CHROME_RAIL_WIDTH } from '@we/template-shell';
import { RECORD_ROUTE_PATH, recordPage } from '@we/template-views';
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';

import { createCollabSession } from '../collab/collabSession';
import { PersistentAppFrames } from '../layouts/PersistentAppFrames';
import { SHELL_SIDEBAR_WIDTH, TemplateLayout } from '../layouts/TemplateLayout';
import { buildRoutes } from '../utils/buildRoutes';

export default function TemplateProvider() {
  // Stores
  const sessionStore = useSessionStore();
  const accountStore = useAccountStore();
  const runtimeStore = useRuntimeStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const editorStore = useEditorStore();
  const appStore = useAppStore();
  const spaceStore = useSpaceStore();
  const shapeStore = useShapeStore();
  const recordStore = useRecordStore();
  const themeStore = useThemeStore();
  const templateStore = useTemplateStore();
  const routeStore = useRouteStore();
  const shellStore = useShellStore();
  const presenceStore = usePresenceStore();
  const interpretationStore = useInterpretationStore();

  // Set CSS custom properties on :root so position:fixed elements (e.g. CesiumGlobe canvas)
  // can consume the shell's own furniture without hard-coding it.
  //
  // The rail width goes out for the same reason the sidebar's does, and for one more: the editor is
  // in a package that cannot import the shell's templates, so the editing bar has no other way to
  // know how much of its edge the rail is holding. Its fallback is `0px`, which is the right answer
  // for an editor embedded somewhere with no WE rail at all.
  onMount(() => {
    document.documentElement.style.setProperty('--we-sidebar-width', SHELL_SIDEBAR_WIDTH);
    document.documentElement.style.setProperty('--we-chrome-rail-width', CHROME_RAIL_WIDTH);
  });

  // Console store for debugging $action calls in schema
  const consoleStore = {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
  };

  // Record mutations — one instance of an entity, written through the entity's registered class
  // with the perspective injected. Pass `{ perspective: 'store.path' }` in options to target a
  // different one (e.g. 'datasetStore.rootDataset' for we-root entities like AgentSettings).
  const recordActions = {
    create: (entity: string, data: Record<string, unknown> = {}, options?: Record<string, unknown>) => {
      const [Entity, p] = resolve(entity, options as { perspective?: string });
      const rest = Object.fromEntries(Object.entries(options ?? {}).filter(([k]) => k !== 'perspective'));
      return Entity.create(p, data, Object.keys(rest).length ? rest : undefined);
    },
    update: (entity: string, id: string, data: Record<string, unknown>, options?: { perspective?: string }) => {
      const [Entity, p] = resolve(entity, options);
      return Entity.update(p, id, data);
    },
    delete: (entity: string, id: string, options?: { perspective?: string }) => {
      const [Entity, p] = resolve(entity, options);
      return Entity.delete(p, id);
    },
  };

  // The same capability schemas get as `record.create`, lent to module stores that must write
  // without a click to hang a schema action on — a transcript appears because somebody spoke.
  provideModuleHostServices({
    // `options` is forwarded rather than swallowed so a module can parent its write — a transcript
    // block belongs inside the call that contains it, and creating it unparented then linking it
    // afterwards leaves a window where a crash orphans the block into the space.
    createEntity: async (entity, fields, options) => {
      if (!datasetStore.currentDataset()) return null;
      const created = (await recordActions.create(entity, fields, { ...options })) as { id?: string } | undefined;
      return created?.id ?? null;
    },

    // Add-one on a to-many relation. An instance bound to an existing base expression is enough —
    // `addRelationValue` writes a single link and never reads the current set, which is what makes
    // several agents appending to the same list safe without coordination.
    linkEntity: async (entity, id, relation, value) => {
      if (!datasetStore.currentDataset()) return;
      const [Model, p] = resolve(entity);
      const instance = new (Model as unknown as new (perspective: unknown, base: string) => Record<string, unknown>)(
        p,
        id,
      );
      const add = instance[`add${relation.charAt(0).toUpperCase()}${relation.slice(1)}`];
      if (typeof add !== 'function') {
        console.warn(`linkEntity: ${entity} has no to-many relation "${relation}"`);
        return;
      }
      await (add as (v: string) => Promise<void>).call(instance, value);
    },
  });

  const stores: Stores = {
    sessionStore,
    accountStore,
    runtimeStore,
    datasetStore,
    profileStore,
    editorStore,
    appStore,
    spaceStore,
    shapeStore,
    recordStore,
    themeStore,
    templateStore,
    routeStore,
    shellStore,
    presenceStore,
    interpretationStore,
    // Always present, even with no modules registered: a read of `modules.x` resolves through the
    // single-segment path, which indexes the store object without a guard and would throw on a
    // missing `modules` key rather than returning undefined.
    modules: moduleStores,
    consoleStore,
    record: recordActions,
    // Host wiring, not backend adaptation — any backend would wire these the same way, so they stay
    // here rather than pretending to be AD4M-specific.
    $onError: (msg: string) => toastService.error(msg),
    // The router binding behind $localState's syncParam: view state a template
    // mirrors into the URL (?type=…&sort=…) so a shared link reproduces the view.
    $routeParams: {
      get: (name: string) => routeStore.params()[name],
      set: (name: string, value: string | null, options?: { push?: boolean }) =>
        routeStore.setParam(name, value, options),
    },
    $useQueryIR: queryIRFlag.enabled, // reactive; default from the seed, live-toggled via testStore
    // Template-facing vocabulary (templates read `$me.did`), as opposed to the renderer-facing
    // bindings below: the renderer never reads `$me` itself, it resolves like any `$store` path.
    $me: sessionStore.me,
    // Everything the *renderer* needs to read data comes from the connector-supplied backend —
    // model resolution, the dataset handle, the identity directory, and the query adapter. The
    // bindings can only be built once the connector's ports exist (post-connect), while this bag
    // is created at provider init — so the known binding keys are getter-delegated onto a memo.
    // Pre-connect they read as absent, which is each consumer's documented degradation mode.
  };

  /**
   * WE's own entities, in the flat form the ports resolve a query's `scope` against.
   *
   * Constant — the core vocabulary does not change with the dataset — so it is built once rather
   * than per switch.
   */
  const coreEntries = manifestEntries(CORE_MANIFEST);

  /**
   * What the backend ports see: the synced foreign schemas, plus WE's own.
   *
   * `datasetStore.currentDatasetEntities` holds *only* foreign schemas, and deliberately — it is also
   * what the AI layer injects as `externalEntities`, where core entities would be a duplicate of what
   * the generated reference already documents. But an adapter resolving `scope` looks `via` up in
   * this same list, so with foreign models alone a drill-down through core vocabulary could never
   * resolve: `{ anchor: 'CollectionBlock', via: 'children' }` failed with "no such relation in the
   * current perspective's model manifest", and every existing `scope` in the templates happened to
   * be on a Flux entity, so nothing had caught it.
   *
   * Merged here, at the host, rather than inside an adapter: `DataBindingDeps` is declared in
   * `@we/backend-shared` and every backend receives this same list, so the gap was every backend's
   * and fixing it in one would have left the next to rediscover it.
   *
   * Foreign first, so nothing that resolves today changes: `resolveScopeToParent` takes the first
   * match by name, and core is purely a fallback behind it.
   */
  const modelsForBindings = () => [...datasetStore.currentDatasetEntities(), ...coreEntries];

  const boundBindings = createMemo(() =>
    sessionStore.backendPorts()?.dataBindings({
      // The backend's own handle, not the shell's ref — these bindings feed model calls.
      currentDataset: () => datasetStore.currentDataset()?.handle ?? null,
      currentDatasetEntities: modelsForBindings,
      profiles: profileStore.profiles,
      fetchProfile: profileStore.fetchProfile,
      ephemeral: sessionStore.ephemeralPort,
    }),
  );
  /*
    Computed sources a template may iterate — the `$source` registry.

    Registered by the host beside components, for the same reason components are: a deployment
    decides what its templates can reach, and a module could contribute its own. Plain data rather
    than a memo, because a source is a pure function and there is nothing here to react to.
  */
  stores.$sources = hostSourceBag();

  const BINDING_KEYS = [
    '$getEntity',
    '$getEntitiesForPerspective',
    '$currentDataset',
    '$identities',
    '$queryAdapter',
    '$ephemeral',
  ] as const;
  for (const key of BINDING_KEYS) {
    Object.defineProperty(stores, key, {
      enumerable: true,
      get: () => (boundBindings() as Record<string, unknown> | undefined)?.[key],
    });
  }

  // Resolves a dot-path string like 'datasetStore.rootDataset' against the stores object.
  // Only called at action-dispatch time, so `stores` is always fully initialized.
  function resolvePerspective(path?: string): DatasetProxy | null {
    if (!path) return null;
    const [storeName, ...rest] = path.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let val: any = (stores as Record<string, unknown>)[storeName];
    for (const key of rest) val = val?.[key];
    if (typeof val === 'function') val = val();
    // Dataset accessors resolve to refs; model calls consume the handle inside.
    if (val && typeof val === 'object' && 'handle' in val) val = val.handle;
    return val ?? null;
  }

  // Mutations need the raw model class (create/update/delete), not the renderer's read-only
  // handle — resolved through the model layer's own registry.
  function resolve(entityName: string, opts?: { perspective?: string }) {
    return [
      getEntity(entityName),
      resolvePerspective(opts?.perspective) ?? datasetStore.currentDataset()!.handle,
    ] as const;
  }

  /*
    The two bags, built once from the one raw `stores` object.

    `stores` itself is never handed to a renderer any more — it is the host's own handle, holding
    wiring, credentials and backend ports. What a schema renders against is a filtered copy, and
    which copy depends on who authored the schema: host chrome gets the chrome tier, a space's
    template gets the space tier. See `templateSurface.ts` for what those mean.

    Built here rather than inside `RenderSchema` because trust is a property of the *render site* —
    who wrote this schema — and the renderer has no way to know that. It stays neutral and walks
    whatever bag it is given, which is the same division that keeps `ModuleStoreDeps` honest.
  */
  const chromeBag = buildTemplateBag(stores, { grants: CHROME_TIER });
  const templateBag = buildTemplateBag(stores, { grants: SPACE_TIER });

  /*
    Shell chrome — host slots plus anything feature modules or the interface itself contribute.

    Outside the keyed Router, so it never remounts on template switches; that isolation is why a
    template has no channel into the shell.

    ## Why the children are a getter, and why the node has a type

    Contributions used to all arrive before the first render — modules register at boot — so reading
    `nodes()` once was enough. A template declaring panels breaks that: its frames register when a
    template says it has them, which is after this runs. So the list is re-read when the registry
    announces.

    The `type` is what makes the re-read reach anything. A *typeless* node renders its children
    through an unmemoized fragment, so the read is untracked and a getter would never re-run; a typed
    one goes through `createMemo(() => renderChildren(node.children))`. `display: contents` keeps the
    wrapper out of the layout entirely — the same trick `dockFrame` uses, for the same reason.

    The node's own identity never changes, so nothing here rebuilds. `renderChildren` maps with a
    reference-keyed `<For>`, so a newly declared panel mounts on its own and every other piece of
    chrome — a call's live video among them — stays exactly where it was.
  */
  const [slotVersion, setSlotVersion] = createSignal(0);
  onCleanup(onSlotRegistryChanged(() => setSlotVersion((version) => version + 1)));

  const shellSchema: TemplateSchema = {
    meta: { name: 'Shell', description: 'App shell chrome', icon: '' },
    type: 'Column',
    props: { styles: { display: 'contents' } },
    get children() {
      slotVersion();
      return slotRegistry.nodes();
    },
  };

  const notFoundNode = {
    type: 'Column',
    props: { ax: 'center', bg: 'surface-sunken', p: '500' },
    children: [{ type: 'we-text', props: { size: '600' }, children: ['Page not found :_('] }],
  };

  const templateSchema = templateStore.currentTemplate;

  /**
   * The template's routes with its `$views` marker replaced by the space's own sections.
   *
   * Done here, once, before `buildRoutes` — rather than inside the route builder — because the
   * expansion is a property of the *schema*, not of the walk: everything downstream (the router,
   * `keepAlive` stubs, the `$nav` base depths) then sees an ordinary route tree and needs to know
   * nothing about views at all.
   *
   * A template with no marker passes through untouched, so this costs nothing for the showcase
   * templates and for anything installed that predates views.
   */
  /**
   * What a section's route renders when the space does not have that section.
   *
   * Two situations reach this, and only one of them lasts. If the space still has *other* sections,
   * the effect below has already moved you and this is at most a frame — so it draws nothing, rather
   * than flashing a message about a state that is over before it can be read. If the space has no
   * sections at all there is nowhere to move to, and that is the case worth explaining: it is not
   * that one page is missing, it is that nobody has put anything in this space yet.
   *
   * The button leads to where that is fixed. Offered to everyone rather than gated on
   * `canAdministerSpace`, for the reason the About pencil is: the page it opens shows the space's
   * configuration either way, and a control that vanishes for most members makes "where do I even
   * look" depend on who is asking.
   *
   * Host-supplied rather than written inside `expandViewRoutes`, which has no business inventing UI
   * text no template could restyle.
   */
  const noSectionsNode = {
    type: '$if',
    props: {
      condition: { $: 'count(spaceStore.enabledViewIds)' },
      // Other sections exist and the redirect is already on its way — say nothing.
      else: {
        type: 'Column',
        props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600', bg: 'page' },
        children: [
          { type: 'we-icon', props: { name: 'squares-four', size: 'xl', color: 'text-faint' } },
          {
            type: 'we-text',
            props: { variant: 'heading-md', color: 'text', textAlign: 'center' },
            children: ["This space doesn't have any sections"],
          },
          {
            type: 'we-text',
            props: { variant: 'body', color: 'text-muted', textAlign: 'center', maxWidth: 'var(--we-layout-xs)' },
            children: [
              'Sections are the pages a space is made of — posts, a calendar, a map. Turn some on to give this space something to show.',
            ],
          },
          {
            type: 'we-button',
            props: {
              variant: 'primary',
              // The dataset id, never the route segment: for a shared space the segment is the
              // neighbourhood CID, and the settings page keys off the dataset id.
              onClick: {
                $action: 'shellStore.openShellView',
                args: ['settings', { $: '`/spaces/${datasetStore.currentDataset.id}`' }],
              },
            },
            children: [
              { type: 'we-icon', props: { name: 'gear' } },
              { type: 'we-text', children: ['Choose sections'] },
            ],
          },
        ],
      },
    },
  };

  /**
   * Routes the host puts beside a space's sections, wherever the shell mounts them.
   *
   * One list, because two things read it: `expandViewRoutes` injects it at the `$views` marker, and
   * the index redirect below has to know these segments are not sections. Written out twice, the
   * redirect bounced every one of them to the space's first section — see there.
   *
   * A page for one record is the only member so far, and it is here rather than in each template
   * because every space wants it and no template should have to remember to include it.
   */
  const HOST_ROUTES = [{ ...recordPage, path: RECORD_ROUTE_PATH }];

  /** Their first path segment — what the redirect compares a URL against. */
  const HOST_ROUTE_SEGMENTS = new Set(HOST_ROUTES.map((route) => route.path.split('/')[1]));

  const routesWithViews = createMemo(() => {
    const routes = templateSchema.routes ?? [];
    if (!hasViewsMarker(routes)) return routes;
    return expandViewRoutes(routes, spaceStore.routableViews(), {
      activeIds: 'spaceStore.enabledViewIds',
      notInSpace: noSectionsNode,
      extraRoutes: HOST_ROUTES as unknown as (typeof routes)[number][],
    });
  });

  /**
   * What the Router is keyed on — the template, plus the shape of its section list.
   *
   * Ids and segments rather than the resolved objects: a view's *schema* changing (someone editing
   * it live in the editor) must not tear the router down, while a section being added, removed,
   * renamed or reordered must, because the route table itself is different. Keying on identity
   * would rebuild on every edit keystroke; keying on the count alone would miss a reorder.
   */
  /**
   * What the Router is keyed on — the template, and which views *exist*.
   *
   * Not which are enabled, and not their order. A remount here tears down `TemplateLayout` and
   * everything it mounts, the shell overlay included, so the key must name only the things that
   * genuinely change the route table: the template, and the set of views installed. Flicking a
   * section on or off, or dragging one up the list, changes neither.
   *
   * Sorted, because the table is a set of paths and the router matches rather than scans.
   */
  const routeKey = createMemo(() => {
    const id = templateSchema.id || 'empty';
    if (!hasViewsMarker(templateSchema.routes ?? [])) return id;
    const table = spaceStore
      .routableViews()
      .map((view) => `${view.id}:${view.segment}:${view.schema.meta?.keepAlive ? 'k' : ''}`)
      .sort()
      .join(',');
    return `${id}|${table}`;
  });

  /**
   * Keep the URL on a section this space actually has.
   *
   * The job the index redirect used to do, moved out of the route table and into an effect, because
   * a redirect baked into the table can only change by rebuilding it — and rebuilding it remounts
   * the Router and everything under it. Two cases:
   *
   * - No section segment at all (`/space/:id`) — land on the first one in the nav.
   * - A segment the community does not have here — a link to a section since removed, or the one you
   *   were reading when somebody removed it.
   *
   * **Not every segment at that level is a section.** The host injects its own routes beside them —
   * a record's own page — and those are not in any view list, so this read them as sections the
   * community had removed and bounced every one of them to the first section in the nav. Every
   * expand button appeared to navigate to About. The exemption is derived from the same list that is
   * injected rather than written out again, so a second host route cannot reintroduce it.
   *
   * **Membership is tested against the community's list, but the landing place comes from the nav.**
   * Those differ by this agent's own hidden sections, and conflating them would bounce somebody off
   * a section they had merely hidden from their own nav — a refusal nobody asked for. Hidden means
   * "not in my list", not "closed to me".
   *
   * `replace`, so Back does not walk into the section that was just left behind. It can only act
   * where there is somewhere to go; a space with no sections leaves it nowhere, and that case is the
   * route body's to explain rather than this one's to solve.
   */
  /** Which view a URL segment addresses, from the routable table that assigned it. */
  const viewIdForSegment = (segment: string): string | undefined =>
    spaceStore.routableViews().find((view) => view.segment === segment)?.id;

  createEffect(() => {
    const segments = routeStore.segments();
    if (segments[0] !== 'space' || !segments[1]) return;

    const nav = spaceStore.viewNav();
    if (!nav.length) return;

    const current = segments[2];
    if (current && HOST_ROUTE_SEGMENTS.has(current)) return;
    if (current && spaceStore.enabledViewIds().some((id) => id === viewIdForSegment(current))) return;
    routeStore.navigate(`/space/${segments[1]}/${nav[0].segment}`, { replace: true });
  });

  // Any theme the template names by `theme: { themeName }` needs its stylesheet present before the
  // section that names it paints. Re-run on template switch, since the next one names different ones.
  createEffect(() => themeStore.requestNamedThemes(templateStore.currentTemplate));

  // TemplateLayout receives stores via closure — SolidJS Router requires `root` to be
  // a component type, so we wrap it to pass stores through.
  const Layout = (props: { children?: unknown }) =>
    TemplateLayout({
      stores: templateBag,
      chromeStores: chromeBag,
      hostStores: stores,
      children: props.children as never,
    });

  // Visual editor context — lives here (above the Router) so context is available to all
  /**
   * Honor a link's ?template= / ?theme= suggestion — the sharing half of the
   * routing conventions (docs/architecture/routing-and-view-state.md).
   *
   * A link may carry the template/theme its sender was viewing with. When the
   * recipient has it (built-in, installed, or a space template), it is applied
   * silently, exactly as if they had picked it — clicking the link is the
   * consent. When they don't, the app falls back to what they already use and
   * says so once with a warning toast, so the link's intent isn't silently
   * lost. Each suggestion is handled once per value: the effect re-runs as
   * templates/themes stream in (a space template may arrive after boot), but a
   * suggestion is only marked handled when it either applies or is reported.
   */
  const handledSuggestions = { template: '', theme: '', templateReported: '', themeReported: '' };
  createEffect(() => {
    const params = routeStore.params();

    const wantedTemplate = params.template;
    if (wantedTemplate && handledSuggestions.template !== wantedTemplate) {
      const known = templateStore.allTemplates().find((t) => t.id === wantedTemplate);
      if (known) {
        handledSuggestions.template = wantedTemplate;
        if (untrack(() => templateStore.currentTemplate.id) !== wantedTemplate) {
          templateStore.switchTemplate(wantedTemplate);
        }
      } else if (templateStore.allTemplates().length && handledSuggestions.templateReported !== wantedTemplate) {
        // Report once templates have actually loaded — an empty list is boot, not absence.
        handledSuggestions.templateReported = wantedTemplate;
        toastService.warning(`This link suggests a template ("${wantedTemplate}") you don't have — using your own.`);
      }
    }

    const wantedTheme = params.theme;
    if (wantedTheme && handledSuggestions.theme !== wantedTheme) {
      const known = themeStore.allThemes().find((t) => t.id === wantedTheme);
      if (known) {
        handledSuggestions.theme = wantedTheme;
        if (untrack(themeStore.currentThemeId) !== wantedTheme) {
          themeStore.setCurrentTheme(wantedTheme);
        }
      } else if (themeStore.allThemes().length && handledSuggestions.themeReported !== wantedTheme) {
        handledSuggestions.themeReported = wantedTheme;
        toastService.warning(`This link suggests a theme ("${wantedTheme}") you don't have — using your own.`);
      }
    }
  });

  // route RenderSchema instances, which are called as direct functions inside the Router's
  // reactive scope rather than as JSX components with their own Solid owner boundary.
  const [hoveredNodeId, setHoveredNodeId] = createSignal<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const nodeRegistry = new Map<string, HTMLElement>();
  const isVisualMode = () => editorStore.contentMode() === 'visual' && editorStore.isEditingTemplate();

  createEffect(() => {
    if (!isVisualMode()) {
      setSelectedNodeId(null);
      setHoveredNodeId(null);
    }
  });

  const visualEditorCtx: VisualEditorContextValue = {
    get enabled() {
      return isVisualMode();
    },
    hoveredId: hoveredNodeId,
    selectedId: selectedNodeId,
    onHover: setHoveredNodeId,
    onSelect: setSelectedNodeId,
    registerNode: (id, el) => {
      nodeRegistry.set(id, el);
      return () => nodeRegistry.delete(id);
    },
    getNodeElement: (id) => nodeRegistry.get(id) ?? null,
  };

  // VisualEditorProvider wraps everything so that:
  // 1. Route components (called as direct functions in buildRoutes) get context via their reactive owner
  // 2. Shell chrome components like InspectorPanel (in templateEditor) get context too
  return (
    <BlockHostProvider
      dataset={() => (datasetStore.currentDataset()?.handle as never) ?? null}
      // Who a composer here can @mention: the members of the space on screen. The host's
      // knowledge, provided once, so no template names a store to get it.
      mentions={() =>
        spaceStore
          .members()
          .map((m) => ({ did: m.did, name: m.name || m.handle || m.did, avatar: m.avatar || undefined }))
      }
      // A live co-editing session rides the ephemeral port of the space on screen — null in a
      // personal space, where there is nobody to share with, and the composer edits alone.
      collab={(nodeId) => {
        const handle = datasetStore.currentDataset()?.handle;
        return handle ? createCollabSession(sessionStore.ephemeralPort, handle, nodeId) : null;
      }}
      collabUser={() => {
        const did = sessionStore.me()?.did ?? '';
        return { name: profileStore.ownProfile()?.name || 'Someone', color: colorFor(did) };
      }}
    >
      <VisualEditorProvider value={visualEditorCtx}>
        {/* Shell chrome — stable, never remounts. Chrome tier: this is host-authored. */}
        <RenderSchema node={shellSchema} stores={chromeBag} registry={registry} />

        {/* Router — keyed on the template ID *and* the resolved section list, since both decide what
           `buildRoutes` produces. Adding, removing or reordering a section remounts the space's
           content, which is the same trade template switching already makes: both are rare,
           deliberate acts, and a router whose route table changed underneath it is worse. */}
        <Show when={routeKey()} keyed>
          {(_key) => (
            <Router root={Layout}>
              {buildRoutes(templateBag, routesWithViews())}
              <Route
                path="*"
                component={() =>
                  routesWithViews().length ? RenderSchema({ node: notFoundNode, stores: templateBag, registry }) : null
                }
              />
            </Router>
          )}
        </Show>

        {/* Persistent app iframes (e.g. Flux) — stable, never remounts. Rendered after the
           keyed Router (both are DOM order stacking, so this preserves the original
           on-top-of-template paint order) so switching templates doesn't reload embedded apps. */}
        <PersistentAppFrames stores={stores} />
      </VisualEditorProvider>
    </BlockHostProvider>
  );
}
