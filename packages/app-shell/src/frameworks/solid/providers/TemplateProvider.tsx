import { queryIRFlag } from '@shared/queryIRFlag';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleStores } from '@shared/registries/moduleRegistry';
import { slotRegistry } from '@shared/registries/slotRegistry';
import { buildTemplateBag, CHROME_TIER, SPACE_TIER } from '@shared/registries/templateSurface';
import { calendarMonth, calendarMonths, monthLabel, yearLabel } from '@shared/sources/calendarMonth';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import {
  useAccountStore,
  useAppStore,
  useDatasetStore,
  useEditorStore,
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
import { BlockDatasetProvider } from '@we/block-solid';
import { toastService } from '@we/components/solid';
import type { DatasetProxy } from '@we/models';
import { getModel } from '@we/models';
import { CORE_MANIFEST } from '@we/models/manifest';
import type { TemplateSchema } from '@we/schema-shared';
import type { VisualEditorContextValue } from '@we/schema-solid';
import { RenderSchema, VisualEditorProvider } from '@we/schema-solid';
import { CHROME_RAIL_WIDTH } from '@we/template-shell';
import { createEffect, createMemo, createSignal, onMount, Show, untrack } from 'solid-js';

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

  // Model store — wraps Ad4m static model methods with automatic perspective injection.
  // Pass `{ perspective: 'store.path' }` in options to target a different perspective
  // (e.g. 'datasetStore.rootDataset' for we-root models like AgentProfile).
  const modelStore = {
    create: (modelName: string, data: Record<string, unknown> = {}, options?: Record<string, unknown>) => {
      const [Model, p] = resolve(modelName, options as { perspective?: string });
      const rest = Object.fromEntries(Object.entries(options ?? {}).filter(([k]) => k !== 'perspective'));
      return Model.create(p, data, Object.keys(rest).length ? rest : undefined);
    },
    update: (modelName: string, id: string, data: Record<string, unknown>, options?: { perspective?: string }) => {
      const [Model, p] = resolve(modelName, options);
      return Model.update(p, id, data);
    },
    delete: (modelName: string, id: string, options?: { perspective?: string }) => {
      const [Model, p] = resolve(modelName, options);
      return Model.delete(p, id);
    },
  };

  // The same capability schemas get as `model.create`, lent to module stores that must write
  // without a click to hang a schema action on — a transcript appears because somebody spoke.
  provideModuleHostServices({
    // `options` is forwarded rather than swallowed so a module can parent its write — a transcript
    // block belongs inside the call that contains it, and creating it unparented then linking it
    // afterwards leaves a window where a crash orphans the block into the space.
    createEntity: async (entity, fields, options) => {
      if (!datasetStore.currentDataset()) return null;
      const created = (await modelStore.create(entity, fields, { ...options })) as { id?: string } | undefined;
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
    // Always present, even with no modules registered: `{ $store: 'modules.x' }` resolves through the
    // single-segment path, which indexes the store object without a guard and would throw on a
    // missing `modules` key rather than returning undefined.
    modules: moduleStores,
    consoleStore,
    model: modelStore,
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
   * `datasetStore.currentDatasetModels` holds *only* foreign schemas, and deliberately — it is also
   * what the AI layer injects as `externalModels`, where core entities would be a duplicate of what
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
  const modelsForBindings = () => [...datasetStore.currentDatasetModels(), ...coreEntries];

  const boundBindings = createMemo(() =>
    sessionStore.backendPorts()?.dataBindings({
      // The backend's own handle, not the shell's ref — these bindings feed model calls.
      currentDataset: () => datasetStore.currentDataset()?.handle ?? null,
      currentDatasetModels: modelsForBindings,
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
  stores.$sources = { calendarMonth, calendarMonths, monthLabel, yearLabel };

  const BINDING_KEYS = [
    '$getModel',
    '$getModelForPerspective',
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
  function resolve(modelName: string, opts?: { perspective?: string }) {
    return [
      getModel(modelName),
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

  // Shell chrome — host slots plus anything feature modules contribute.
  // Rendered once outside the keyed Router so it never remounts on template switches; that isolation
  // is why a template has no channel into the shell.
  const shellSchema: TemplateSchema = {
    meta: { name: 'Shell', description: 'App shell chrome', icon: '' },
    children: slotRegistry.nodes(),
  };

  const notFoundNode = {
    type: 'Column',
    props: { ax: 'center', bg: 'surface', p: '500' },
    children: [{ type: 'we-text', props: { size: '600' }, children: ['Page not found :_('] }],
  };

  const templateSchema = templateStore.currentTemplate;

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
    <BlockDatasetProvider dataset={() => (datasetStore.currentDataset()?.handle as never) ?? null}>
      <VisualEditorProvider value={visualEditorCtx}>
        {/* Shell chrome — stable, never remounts. Chrome tier: this is host-authored. */}
        <RenderSchema node={shellSchema} stores={chromeBag} registry={registry} />

        {/* Router — keyed on template ID so buildRoutes reruns when the template changes.
           Template switching is a rare intentional action; the full remount is acceptable. */}
        <Show when={templateSchema.id || 'empty'} keyed>
          {(_id) => (
            <Router root={Layout}>
              {buildRoutes(templateBag, templateSchema.routes ?? [])}
              <Route
                path="*"
                component={() =>
                  templateSchema.routes?.length
                    ? RenderSchema({ node: notFoundNode, stores: templateBag, registry })
                    : null
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
    </BlockDatasetProvider>
  );
}
