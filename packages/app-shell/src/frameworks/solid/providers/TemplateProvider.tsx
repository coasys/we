import { boardOptimism } from '@shared/boardOptimism';
import { datasetAddressedBy } from '@shared/datasetIdentity';
import { involvementOptimism } from '@shared/involvementOptimism';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { resolveParts, resolvePartsInRoutes } from '@shared/registries/moduleParts';
import { moduleRegistry, moduleStores } from '@shared/registries/moduleRegistry';
import { onSlotRegistryChanged, slotRegistry } from '@shared/registries/slotRegistry';
import { provideChromeBag, provideTemplateBag } from '@shared/registries/templateBag';
import { buildTemplateBag, CHROME_TIER, SPACE_TIER } from '@shared/registries/templateSurface';
import { hostSourceBag } from '@shared/sources';

import { signalOptimism } from '../../../shared/signalOptimism';
import { signalOrder } from '../../../shared/signalOrder';

/** A relation comes back as ids or as hydrated rows; read either, the way `arrangedBoard` does. */
const idOf = (entry: unknown): string =>
  typeof entry === 'string' ? entry : String((entry as { id?: unknown } | null)?.id ?? '');

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
import { datasetKey, formatRef, manifestEntries } from '@we/backend-shared';
import { type ContentInput, copyableContent, createBlocks, deleteBlocks, reconcileBlocks } from '@we/block-shared';
import { BlockDisplayOverrides, BlockHostProvider, colorFor } from '@we/block-solid';
import { toastService } from '@we/components/solid';
import type { DatasetProxy } from '@we/entities';
import { CollectionBlock, getEntity } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import type { DocumentAccess } from '@we/module-shared';
import type { TemplateSchema } from '@we/schema-shared';
import { expandViewRoutes, hasViewsMarker, SPACE_ROUTE_PATH } from '@we/schema-shared';
import type { VisualEditorContextValue } from '@we/schema-solid';
import { RenderSchema, VisualEditorProvider } from '@we/schema-solid';
import { CHROME_RAIL_WIDTH } from '@we/template-shell';
import { RECORD_ROUTE_PATH, recordPage } from '@we/template-views';
import { createEffect, createMemo, createSignal, getOwner, onCleanup, onMount, Show, untrack } from 'solid-js';

import { createCollabSession } from '../collab/collabSession';
import { moduleBlockDisplays } from '../components/moduleBlockDisplays';
import { registerRecordGhost } from '../drag/recordGhost';
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

  /*
    The console, as a store, so a schema author can print from an `$action` while working something
    out. This is the one place `console.log` is the *feature* rather than a leftover — hence the
    disable, rather than an exemption in the lint config that would cover the whole file.
  */
  const consoleStore = {
    // eslint-disable-next-line no-console
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
  };

  /**
   * Where a module's agent-scoped records live, named once.
   *
   * A literal in three call sites would be three chances to write a space's path by mistake, and the
   * consequence of getting it wrong is one person's private collection synced to a community.
   *
   * The personal space rather than the root: what a module keeps for somebody is theirs, and the
   * root is the app's configuration. See `systemDatasets.ts`.
   */
  const PERSONAL_DATASET = 'datasetStore.personalDataset';

  // Record mutations — one instance of an entity, written through the entity's registered class
  // with the dataset injected. Pass `{ dataset: 'store.path' }` in options to target a
  // different one (e.g. 'datasetStore.rootDataset' for we-root entities like AgentSettings).
  const recordActions = {
    create: (entity: string, data: Record<string, unknown> = {}, options?: Record<string, unknown>) => {
      const [Entity, p] = resolve(entity, options as { dataset?: string });
      const rest = Object.fromEntries(Object.entries(options ?? {}).filter(([k]) => k !== 'dataset'));
      return Entity.create(p, data, Object.keys(rest).length ? rest : undefined);
    },
    update: (entity: string, id: string, data: Record<string, unknown>, options?: { dataset?: string }) => {
      const [Entity, p] = resolve(entity, options);
      return Entity.update(p, id, data);
    },
    delete: (entity: string, id: string, options?: { dataset?: string }) => {
      const [Entity, p] = resolve(entity, options);
      return Entity.delete(p, id);
    },
  };

  /**
   * The dataset a module's write means: the one it named, or the space on screen.
   *
   * Named by **URI**, not by store path: a module is not a template and has no store bag, and the
   * URI is the string it already holds — presence anchors an activity with it, which is how
   * transcribe knows the call's space at all. Matched against the dataset list rather than a
   * registry, so this answers only for datasets this agent actually holds.
   *
   * `null` for a name that does not resolve, and the callers refuse rather than falling back. See
   * `DatasetTarget` for why those two must not be the same outcome.
   */
  function moduleTarget(uri?: string): DatasetProxy | null {
    if (!uri) return (datasetStore.currentDataset()?.handle as DatasetProxy | undefined) ?? null;
    const found = datasetStore.datasets().find((d) => d.sharedUri === uri || d.id === uri);
    if (!found) {
      console.warn(`module host: no dataset for "${uri}" — refusing rather than writing elsewhere`);
      return null;
    }
    return found.handle;
  }

  /** `record.create`, against a resolved handle rather than a store path. */
  function createInDataset(
    entity: string,
    fields: Record<string, unknown>,
    perspective: DatasetProxy,
    rest: Record<string, unknown>,
  ) {
    return getEntity(entity).create(perspective, fields, Object.keys(rest).length ? rest : undefined);
  }

  /**
   * Composed documents in one dataset — what the records kernel and the agent-data kernel lend as
   * `documents`, each pinned to its own dataset.
   *
   * The same writes the composer's own save makes (`SpaceStore.createPost` / `updatePost`), against
   * whichever dataset the accessor names, which is the one thing those two cannot do: they are
   * pinned to the space on screen, and a note lives in the personal space.
   */
  function documentAccess(
    target: () => { id: string; sharedUri?: string | null; handle: DatasetProxy } | null,
  ): DocumentAccess {
    const collection = async (handle: DatasetProxy, id: string) => CollectionBlock.findOne(handle, { where: { id } });
    return {
      create: async (document, options) => {
        const ds = target();
        if (!ds) return null;
        const root = await createBlocks(ds.handle, document as ContentInput, { kind: options?.kind ?? 'post' });
        if (!root?.id) return null;
        const key = datasetKey({ cid: ds.sharedUri, uuid: ds.id });
        return { id: root.id, ref: formatRef({ datasetKey: key, entity: 'CollectionBlock', id: root.id }) };
      },
      update: async (id, document) => {
        const ds = target();
        const existing = ds && (await collection(ds.handle, id));
        if (!ds || !existing) return;
        await reconcileBlocks(ds.handle, existing, document as ContentInput);
      },
      remove: async (id) => {
        const ds = target();
        if (ds) await deleteBlocks(ds.handle, id);
      },
      read: async (id) => {
        const ds = target();
        const existing = ds && (await collection(ds.handle, id));
        // Payloads rather than addresses, and no keys: a fresh composition, ready to be written into a
        // dataset whose file storage and records have never seen it. See `copyableContent`.
        return ds && existing ? copyableContent(ds.handle, existing.editorState) : null;
      },
    };
  }

  /** The same, for `record.update` — `recordActions` resolves a store *path*, and a module has a handle. */
  function updateInDataset(entity: string, id: string, fields: Record<string, unknown>, perspective: DatasetProxy) {
    return getEntity(entity).update(perspective, id, fields);
  }

  // The same capability schemas get as `record.create`, lent to module stores that must write
  // without a click to hang a schema action on — a transcript appears because somebody spoke.
  onCleanup(
    provideModuleHostServices({
      // Only the host can turn a URI a module named into a handle. See `targeted` in
      // `moduleHostServices.ts` for why a name it cannot resolve refuses instead of falling back.
      datasetByUri: (uri) => datasetStore.datasets().find((d) => d.sharedUri === uri || d.id === uri)?.handle,
      // `options` is forwarded rather than swallowed so a module can parent its write — a transcript
      // block belongs inside the call that contains it, and creating it unparented then linking it
      // afterwards leaves a window where a crash orphans the block into the space.
      /*
        `options.dataset` names where, and an unresolvable name refuses.

        Passing no dataset used to mean `resolve()` fell through to `datasetStore.currentDataset()`
        — the space *on screen* — which is right for a write caused by the person looking at it and
        wrong for every module whose work outlives the view. #161 made a call survive navigation, and
        transcribe kept writing utterances into whichever space had been opened since. See
        `DatasetTarget`.
      */
      createEntity: async (entity, fields, options) => {
        const perspective = moduleTarget(options?.dataset);
        if (!perspective) return null;
        const rest = Object.fromEntries(Object.entries(options ?? {}).filter(([key]) => key !== 'dataset'));
        const created = (await createInDataset(entity, fields, perspective, rest)) as { id?: string } | undefined;
        return created?.id ?? null;
      },

      // A post, from a module: always the space on screen. See `RecordsKernel.documents`.
      documents: documentAccess(() => datasetStore.currentDataset()),

      /*
        This agent's own records, in their personal space — the write half of
        `entities: { scope: 'agent' }`.

        Everything goes through `recordActions` with the personal dataset named, so there is one
        place that knows how a dataset path is resolved and an agent-scoped module cannot reach a
        space by accident: the path is fixed here rather than passed in.
      */
      agentData: {
        ready: () => !!datasetStore.personalDataset(),
        refKey: () => {
          const personal = datasetStore.personalDataset();
          return personal ? datasetKey({ uuid: personal.id }) : '';
        },
        create: async (entity, fields, options) => {
          if (!datasetStore.personalDataset()) return null;
          const created = (await recordActions.create(entity, fields, {
            ...options,
            dataset: PERSONAL_DATASET,
          })) as { id?: string } | undefined;
          return created?.id ?? null;
        },
        find: async (entity, query) => {
          if (!datasetStore.personalDataset()) return [];
          const [Model, p] = resolve(entity, { dataset: PERSONAL_DATASET });
          const rows = (await Model.findAll(p, query as never)) as unknown as Record<string, unknown>[];
          return rows ?? [];
        },
        update: async (entity, id, fields) => {
          if (!datasetStore.personalDataset()) return;
          await recordActions.update(entity, id, fields, { dataset: PERSONAL_DATASET });
        },
        remove: async (entity, id) => {
          if (!datasetStore.personalDataset()) return;
          await recordActions.delete(entity, id, { dataset: PERSONAL_DATASET });
        },
        documents: documentAccess(() => datasetStore.personalDataset()),
      },

      // Add-one on a to-many relation. An instance bound to an existing base expression is enough —
      // `addRelationValue` writes a single link and never reads the current set, which is what makes
      // several agents appending to the same list safe without coordination.
      linkEntity: async (entity, id, relation, value, options) => {
        const p = moduleTarget(options?.dataset);
        if (!p) return;
        const Model = getEntity(entity);
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

      // The scalar counterpart of `linkEntity`, resolved the same way `createEntity` is: a module
      // names a dataset by URI, and an unresolvable name refuses rather than writing to whatever is
      // on screen. See `ModuleStoreDeps.updateEntity` for why a module needs this when a schema's
      // `record.update` already exists.
      updateEntity: async (entity, id, fields, options) => {
        const p = moduleTarget(options?.dataset);
        if (!p) return;
        await updateInDataset(entity, id, fields, p);
      },

      removeEntity: async (entity, id, options) => {
        const p = moduleTarget(options?.dataset);
        if (!p) return;
        await getEntity(entity).delete(p, id);
      },

      /*
        The read half of the records kernel — what a module that observes records had no way to do.

        Bounded by the same query a `$query` takes, and resolved against the same entity class the
        renderer uses, so a module can read nothing a template rendering the same space could not.
        `subscribe` is the one trigger a module has: the entity's live query, whose subscription
        resolves with the first page and fires again on change. The dispose is handed back so a store
        can register it through `deps.onDispose`.
      */
      findEntities: async (entity, query, options) => {
        const p = moduleTarget(options?.dataset);
        if (!p) return [];
        const Model = getEntity(entity) as unknown as {
          findAll: (perspective: unknown, opts: unknown) => Promise<Record<string, unknown>[]>;
        };
        return (await Model.findAll(p, query ?? {})) ?? [];
      },
      subscribeEntities: (entity, query, cb, options) => {
        const p = moduleTarget(options?.dataset);
        if (!p) return () => {};
        const Model = getEntity(entity) as unknown as {
          query: (
            perspective: unknown,
            opts: unknown,
          ) => { subscribe: (cb: (rows: Record<string, unknown>[]) => void) => Promise<unknown>; dispose: () => void };
        };
        const subscription = Model.query(p, query ?? {});
        void subscription.subscribe(cb).then(
          (rows) => cb(rows as Record<string, unknown>[]),
          (error: unknown) => {
            console.warn(`module host: subscription to ${entity} failed`, error);
          },
        );
        return () => subscription.dispose();
      },
    }),
  );

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
   *
   * Module-declared entities are the third source, and were missing for the same reason core was:
   * they are in neither of the other two. A module that declares a relation and then drills into it
   * — the Pocket, reading a folder's contents — got "no such relation in the current perspective's
   * model manifest" on a completely correct query. Behind core, since a module may not shadow the
   * host's vocabulary.
   */
  const moduleEntries = createMemo(() => {
    const schemas = sessionStore.backendPorts()?.schemas;
    return schemas ? moduleRegistry.entityEntries(schemas) : [];
  });
  const modelsForBindings = () => [...datasetStore.currentDatasetEntities(), ...coreEntries, ...moduleEntries()];

  const boundBindings = createMemo(() =>
    sessionStore.backendPorts()?.dataBindings({
      // The backend's own handle, not the shell's ref — these bindings feed model calls.
      currentDataset: () => datasetStore.currentDataset()?.handle ?? null,
      currentDatasetEntities: modelsForBindings,
      profiles: profileStore.profiles,
      // Per-DID, so a `$agent` row depends on its own agent rather than on the whole cache.
      profileFor: profileStore.profileFor,
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
  /*
    The sources, with the board's own wrapped so it draws what has been dragged but not yet stored.

    The wrap is here and not in `arrangedBoard` because that function is pure and tested as such —
    it takes the overlay as an argument and knows nothing about where one comes from. This is the
    only place that has both the registry and the app's state, which is the same reason the bag is
    assembled here at all.

    Two things happen per call. The overlay goes in, which is what makes a dropped card appear in its
    new column on the tick of the drop; and the columns just drawn are reported back, which is what
    lets the store stop standing in for an arrangement the data has caught up with. Reporting from
    *here* rather than where the rows arrive is the rule `pendingWrites` records for the canvas: a
    read landing is not the same moment as the thing being drawn from it, and clearing on the read
    put the old value back for the whole window in between.

    Deferred to a microtask because this runs inside a memo, and writing a signal during a render is
    how a re-entrancy bug starts.
  */
  /*
    The host's own functions, then the ones registered modules lend — `contributes.functions`. A
    module may not shadow a host function: the host's vocabulary is what every template was written
    against, and a module redefining `calendarMonth` would change every calendar at once. Reported,
    since a silently ignored contribution is the failure this codebase most often meets.
  */
  const hostSources = hostSourceBag();
  const moduleSources: Record<string, (options: unknown) => unknown> = {};
  for (const fn of moduleRegistry.functions()) {
    if (fn.name in hostSources) {
      console.warn(`module "${fn.moduleId}" function "${fn.name}" would shadow a host function and was not registered`);
      continue;
    }
    moduleSources[fn.name] = fn.fn as (options: unknown) => unknown;
  }
  const sources = { ...hostSources, ...moduleSources };
  const arrangedBoardSource = sources.arrangedBoard;
  stores.$sources = {
    ...sources,
    arrangedBoard: (options: unknown) => {
      const given = (options ?? {}) as { columns?: unknown; board?: unknown };
      const view = arrangedBoardSource({
        ...given,
        pending: boardOptimism.overlay(),
        // Who is on each card, including a tick nobody's subscription has carried back yet — a
        // filter that ignored it would dim the card somebody was just assigned to.
        pendingInvolvements: involvementOptimism.overlay(),
      });

      const rows = new Map<string, readonly string[]>();
      const note = (record: unknown, relation: 'arranges' | 'children') => {
        const row = record as { id?: string; arranges?: unknown; children?: unknown } | null;
        if (!row?.id) return;
        const value = relation === 'arranges' ? row.arranges : row.children;
        if (Array.isArray(value)) rows.set(`${row.id}.${relation}`, value.map(idOf));
      };
      for (const column of (Array.isArray(given.columns) ? given.columns : []) as unknown[]) note(column, 'arranges');
      note(given.board, 'children');
      note(given.board, 'arranges');

      // A card's state is held as an arrangement of one, so it settles through the same lookup —
      // `<cardId>.status` against what the pool actually says the record's state is.
      for (const record of (Array.isArray((given as { records?: unknown }).records)
        ? (given as { records: unknown[] }).records
        : []) as unknown[]) {
        const row = record as { id?: string; status?: unknown } | null;
        if (row?.id) rows.set(`${row.id}.status`, [String(row.status ?? '')]);
      }

      queueMicrotask(() => boardOptimism.settle((id, relation) => rows.get(`${id}.${relation}`)));
      const involvementRows = (given as { involvements?: unknown }).involvements;
      if (Array.isArray(involvementRows)) {
        queueMicrotask(() => involvementOptimism.settleFromRows(involvementRows));
      }
      return view;
    },
    /*
      Who is on what, with the answers somebody gave and the data has not carried back yet — the
      same two halves as the board above, for the same reason. The rows the view was drawn from are
      reported, so a hold is released the moment they have overtaken it rather than when the write's
      promise settles.
    */
    // The picker's ticks, from the same held answers — a member ticked in the menu stays ticked
    // through the round trip rather than unticking for a second and ticking again.
    involvementMenu: (options: unknown) => {
      const given = (options ?? {}) as { rows?: unknown };
      const entries = sources.involvementMenu({ ...given, pending: involvementOptimism.overlay() });
      queueMicrotask(() => involvementOptimism.settleFromRows(given.rows));
      return entries;
    },
    involvement: (options: unknown) => {
      const given = (options ?? {}) as { rows?: unknown };
      const view = sources.involvement({ ...given, pending: involvementOptimism.overlay() });
      queueMicrotask(() => involvementOptimism.settleFromRows(given.rows));
      return view;
    },
    /*
      A record's reactions, with this agent's own newest answer in it — the same two halves again.

      The rows reported are the ones the overlay was applied OVER, which is what the record's
      subscription actually says, so a hold is released the moment the data has overtaken it rather
      than when the write's promise settles.
    */
    /*
      The order a record's reactions are drawn in, settled once and then held.

      Here rather than in the fragment, because the fragment cannot hold anything: a reaction
      surface sits inside an `$each` over a query, a subscription answers with fresh objects, and
      Solid's keyed `<For>` therefore remounts the row — taking any `$localState` initial with it.
      Writing a reaction re-runs the query that feeds the row you wrote it on, so a snapshot taken
      at mount was re-taken on exactly the events it was meant to be stable across.

      `of` is the record. Without one there is nothing to key on and the live order is the answer,
      which is right for a caller that is not drawing a particular record's reactions.
    */
    signalTypesByUse: (options: unknown) => {
      const given = (options ?? {}) as { of?: unknown; limit?: unknown };
      if (typeof given.of !== 'string') return sources.signalTypesByUse(given);

      /*
        The WHOLE order is settled, and the limit applied after.

        A compact row asks for four; storing those four as the order would throw away where
        everything else stood, so opening the sheet — which asks for all of them — would settle a
        fresh order for the tail every time it opened.
      */
      const all = sources.signalTypesByUse({
        ...given,
        limit: undefined,
        order: signalOrder.held(given.of),
      }) as unknown[];
      const record = given.of;
      signalOrder.settle(
        record,
        all.map((type) => (type as { id?: unknown }).id).filter((id): id is string => typeof id === 'string'),
      );
      /*
        The order lives exactly as long as this drawing does.

        Held for the session instead, selecting another card and coming back showed the first card's
        order from minutes ago, with a reaction since given sitting halfway down a list that claims
        to be sorted by use. Released when the owner goes away, it still survives the remount a
        subscription causes — that disposes and rebuilds inside one batch, so the order is asked for
        again before the deferred release fires — and is forgotten once the reader has moved on.

        Only where there is an owner to hang it on: a source called outside a reactive computation
        has nothing to be cleaned up with, and `onCleanup` there warns and does nothing.
      */
      if (getOwner()) onCleanup(() => signalOrder.release(record));
      return typeof given.limit === 'number' && given.limit >= 0 ? all.slice(0, given.limit) : all;
    },
    reactions: (options: unknown) => {
      const given = (options ?? {}) as { signals?: unknown; record?: unknown; type?: unknown; me?: unknown };
      const list = sources.reactions({ ...given, pending: signalOptimism.overlay() });
      /*
        Reported for the PAIR this call was about, never for the record.

        The list handed in is one type's — every surface asks per type — so it is evidence about that
        type and nothing else. Read as evidence about the record it said "no reaction of any kind",
        which dropped a withdrawal hold the instant any other type on the same record drew: the heart
        came back on until the real data caught up. See `settleFromSignals`.
      */
      if (typeof given.record === 'string' && typeof given.type === 'string' && typeof given.me === 'string') {
        queueMicrotask(() =>
          signalOptimism.settleFromSignals(
            given.record as string,
            given.type as string,
            given.me as string,
            given.signals,
          ),
        );
      }
      return list;
    },
  };

  const BINDING_KEYS = [
    '$getEntity',
    '$getEntityForDataset',
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

  /**
   * The dataset accessors a `dataset` option may name.
   *
   * ## Why this is a list and not a walk
   *
   * It used to walk the **raw** `stores` object — the host's own handle, holding every store
   * unfiltered — and then *call whatever it landed on*. The third argument of `record.create` flows
   * straight here from a template, so
   *
   * ```json
   * { "$action": "record.create", "args": ["TextBlock", {}, { "dataset": "sessionStore.logout" }] }
   * ```
   *
   * logged the user out from a synced space template, and `runtimeStore.restartExecutor`,
   * `runtimeStore.exportDatabase` and `themeStore.restorePersonalTheme` were reachable the same way.
   * `buildTemplateBag` protects `{ "$action": "sessionStore.logout" }` and did nothing for this
   * closure's own lookup — a filtered bag around an unfiltered walk.
   *
   * The fix is not a better walk. The option means *which dataset*, and the datasets are a closed
   * set of five accessors the host itself names; there is no template for which the answer is "some
   * arbitrary path". So this is the whole vocabulary, and anything else resolves to null — which
   * falls through to the current dataset, exactly as an omitted option does.
   *
   * Adding a dataset accessor to `DatasetStore` means adding it here. That is the point: a new one
   * is a deliberate widening of what a template may write into, not something that arrives by
   * being reachable.
   */
  const DATASET_PATHS = new Set([
    'datasetStore.currentDataset',
    'datasetStore.rootDataset',
    'datasetStore.personalDataset',
    'datasetStore.globalDataset',
    'datasetStore.marketplaceDataset',
  ]);

  // Resolves one of the named dataset accessors above. Only called at action-dispatch time, so
  // `stores` is always fully initialized.
  function resolveDataset(path?: string): DatasetProxy | null {
    if (!path || !DATASET_PATHS.has(path)) {
      if (path) console.warn(`dataset: "${path}" is not a dataset accessor; using the current one`);
      return null;
    }
    const [storeName, member] = path.split('.');
    const store = (stores as Record<string, Record<string, unknown>>)[storeName];
    const accessor = store?.[member];
    // Every entry above is a dataset accessor, so it is a function; guarded anyway rather than
    // assumed, since the assertion this list makes is about *names*, not about shapes.
    let val: unknown = typeof accessor === 'function' ? (accessor as () => unknown)() : accessor;
    // Dataset accessors resolve to refs; model calls consume the handle inside.
    if (val && typeof val === 'object' && 'handle' in val) val = (val as { handle: unknown }).handle;
    return (val as DatasetProxy | null) ?? null;
  }

  // Mutations need the raw model class (create/update/delete), not the renderer's read-only
  // handle — resolved through the model layer's own registry.
  function resolve(entityName: string, opts?: { dataset?: string }) {
    return [getEntity(entityName), resolveDataset(opts?.dataset) ?? datasetStore.currentDataset()!.handle] as const;
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
  /*
    The space bag, with the host's own confirmation in front of every destructive action.

    Only this bag. Chrome is authored here, in this repo, and asks its own questions where it needs
    to — `removeAccountModal`, the account-removal flow, the editor's discard guards — so guarding
    it too would put two dialogs in front of one click. A space template is the case the flag was
    invented for: it arrives from a stranger, so whether it asks before deleting is the stranger's
    decision, and this takes that decision away from them.
  */
  /*
    Lent to `TemplatePanelBody`, which renders a template's panel contents inside a chrome-authored
    frame. Grants follow authorship, not render site — see `shared/registries/templateBag.ts`.
  */
  const templateBag = buildTemplateBag(stores, {
    grants: SPACE_TIER,
    onDestructive: (path, args) => shellStore.requestDestructive(path, args),
  });

  onCleanup(provideTemplateBag(templateBag));
  // And the chrome bag, for a module's declared card drawn inside a template's post. See `templateBag.ts`.
  onCleanup(provideChromeBag(chromeBag));

  /*
    What a drag looks like. Registered from here because it is the same kind of knowledge as
    `openRef` below — the host's, provided once, so no source of a drag has to carry it.

    The chrome bag rather than the template one: this card is host-authored, and a ghost is chrome.
  */
  onMount(() => {
    onCleanup(
      registerRecordGhost({
        stores: chromeBag,
        registry,
        agent: (did) => {
          const profile = profileStore.profiles().find((p) => p.did === did);
          return profile ? { name: profile.name ?? '', avatar: profile.avatar ?? '' } : undefined;
        },
        // The same handle `BlockHostProvider` hands the composer — a ghost renders outside it.
        dataset: () => datasetStore.currentDataset()?.handle as Record<string, unknown> | undefined,
      }),
    );
  });

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
      /*
        `$part` expanded here as well as `$slot`, which the registry does on its way out.

        A module composing its own chrome out of its own published parts is an ordinary thing to
        write — the transcript panel builds its feed from `transcriptLines`, and the extraction panel
        its chips from `extractionTargets` — and until now the only thing that expanded a part was a
        *template* placing one. So the workshop, which supplies both panel bodies and renders them
        through `TemplatePanelBody`, worked; the default template rendered the module's own panels
        through this path and drew "Unknown component $part" in a red box where each fragment should
        have been.

        Not in the slot registry itself, which `moduleParts` already imports for the parts map —
        putting it there makes a cycle out of two modules that currently only point one way.
      */
      return slotRegistry.nodes().flatMap((node) => {
        const expanded = resolveParts(node);
        return Array.isArray(expanded) ? expanded : [expanded];
      });
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

  /*
    Every space template lives under `/space/:spaceId`, and the host is what puts it there.

    A template that marks where the space's sections go declares this prefix itself, because its
    route table is *about* that shape. A template that routes itself declared nothing, and so
    mounted its own paths at the top level — `/board`, `/channel/:id` — which took it out of the one
    mechanism that answers "which space am I in": the URL. The dataset effect in SpaceStore reads
    `segments[0] === 'space'` and returns otherwise, so under a self-routing template the open space
    was whatever happened to be in the store. Reload lost it, sidebar switching landed on the
    template's catch-all, share links matched nothing, and the record page — injected at the views
    marker — was never mounted at all.

    None of that is a property of routing your own screens. It is a property of not being under the
    space prefix, so the host supplies the prefix rather than each template remembering it. What a
    template still owns is everything below: its own children here, the space's sections there.

    A transparent layout route — `$routes` and nothing else — because the template's own chrome is
    in its root node, which `TemplateLayout` renders outside the router. This adds an address, not a
    wrapper anybody can see.
  */
  const routesWithViews = createMemo(() => {
    const routes = templateSchema.routes ?? [];
    const extras = HOST_ROUTES as unknown as (typeof routes)[number][];
    /*
      `$part` expanded over the whole route table, before the router sees it.

      Parts used to be a panel-only mechanism — `TemplatePanelBody` was the single call site — so an
      interface could compose a module's fragments in a panel and nowhere else. That was never a
      decision, only where the need first appeared: a template wanting a transcript on one of its
      own pages, or a *view* built out of a module's pieces, wrote a `$part` that survived the walk
      and reached the renderer, which mounts nothing for a type it does not know.

      Here, for the same reason `$views` is expanded here: it is a property of the schema rather
      than of the walk, so everything downstream — the router, the keep-alive stubs, the `$nav`
      depths — goes on seeing an ordinary route tree. Views come through this memo too, so a section
      gets parts for nothing.
    */
    if (hasViewsMarker(routes)) {
      return resolvePartsInRoutes(
        expandViewRoutes(routes, spaceStore.routableViews(), {
          activeIds: 'spaceStore.enabledViewIds',
          notInSpace: noSectionsNode,
          extraRoutes: extras,
        }),
      );
    }
    if (!routes.length) return routes;
    return resolvePartsInRoutes([
      {
        path: SPACE_ROUTE_PATH,
        children: [{ type: '$routes' }],
        routes: [...routes, ...extras],
      } as unknown as (typeof routes)[number],
    ]);
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

    /*
      Only while the address on screen is about the space these sections belong to.

      Everything below reads the *store's* space — its nav, its enabled sections — and writes the
      *URL's* space. Those are the same space almost always, and the window where they are not is
      the one that mattered: `navigateToSpace` switches the dataset first and navigates second, so
      between the two the stores describe B while the URL still says A. This effect woke in that
      window, because the template had just been replaced with B's default and the previous one was
      self-routing — so `hasViewsMarker` went from false to true, on a URL holding a self-routing
      template's own path, which is a section no space has.

      It then did exactly what it is written to do, to the wrong space: rewrote the URL to
      `/space/A/<B's first section>`. That is a route change naming A, so the route effect that
      keeps the dataset in step with the address dutifully switched *back* to A — landing after the
      switch to B had finished, since it starts later. The reader ended up in space B by every sign
      the URL and the sidebar could give, reading space A's records.

      The guard is the invariant stated plainly: correct an address only when it is an address about
      the space you are reading from.
    */
    if (!datasetAddressedBy(datasetStore.currentDataset(), segments[1])) return;

    /*
      Only once the space has settled which template it renders with.

      On a deep link or a reload the space's own template is fetched, and until it arrives the agent's
      default stands in for it. Reading the stand-in's sections, this took a Workshop address —
      `/space/<id>/canvas?call=…` — for a section the space did not have and rewrote it to the
      default's first, `/about`. Nothing on screen showed it: the space's template arrived, remounted
      the router against the address as it still stood, and the discarded router's navigation landed
      in `history` afterwards. The page drew the canvas under an address saying `/about`, until the
      next parameter write rebuilt the query from that address and dropped the call.

      The template's routes are read below as well, so waiting here also means they are the right
      ones. Re-runs when it settles, since reading the accessor tracks it.
    */
    if (templateStore.spaceTemplatePending()) return;

    /*
      Only for a template whose sections these are.

      Now that the host mounts every template under the space prefix, a self-routing template's own
      screens sit at exactly the depth this reads — `/space/<id>/board` — and `board` is not a view,
      so this bounced straight off it to the first section in the nav. The guard's job is "keep the
      URL on a section this space actually has", which is a question only about a template that has
      sections; one that routes itself answers for its own paths.

      The same marker as the wrap above, and it means the same thing in both places: this template
      hosts the space's sections.
    */
    if (!hasViewsMarker(templateSchema.routes ?? [])) return;

    const nav = spaceStore.viewNav();
    if (!nav.length) return;

    const current = segments[2];
    if (current && HOST_ROUTE_SEGMENTS.has(current)) return;
    if (current && spaceStore.enabledViewIds().some((id) => id === viewIdForSegment(current))) return;
    routeStore.navigate(`/space/${segments[1]}/${nav[0].segment}`, { replace: true });
  });

  /*
    A self-routing template has no home screen, so `/` is not a place it can be.

    The marker kind owns `/` deliberately — the default template's `homeRoute` is the spaces
    overview — but a template that only describes screens *inside* a space has nothing to render
    there, and after the wrap above it has no route matching it either. Send it to the space it is
    already holding rather than to the host's not-found.

    `replace`, because `/` was never somewhere anybody chose to be.
  */
  createEffect(() => {
    if (routeStore.currentPath() !== '/') return;
    if (hasViewsMarker(templateSchema.routes ?? [])) return;
    const dataset = datasetStore.currentDataset();
    if (!dataset) return;
    routeStore.navigate(`/space/${dataset.sharedId ?? dataset.id}`, { replace: true });
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
        if (!handle) return null;
        return createCollabSession(sessionStore.ephemeralPort, handle, nodeId, {
          // Who may write into a draft open here. Read live rather than captured: a session
          // outlives the frame it was created in, and a member who joins mid-session should be
          // able to type. Null while the roster is still loading — see the session's docblock.
          members: () => {
            const dids = spaceStore.memberDids();
            return dids.length ? dids : null;
          },
          self: () => sessionStore.me()?.did,
        });
      }}
      collabUser={() => {
        const did = sessionStore.me()?.did ?? '';
        return { name: profileStore.ownProfile()?.name || 'Someone', color: colorFor(did) };
      }}
      // Where a reference inside a composition goes when somebody follows it. The host's knowledge
      // for the same reason the dataset is: a block cannot know where a record's page lives, and
      // threading a handler from every call site is the `dataset` string all over again.
      openRef={(ref) => void spaceStore.openRecordRef(ref)}
      // A quote names whose words it holds. A person not yet cached is fetched, and the name arrives
      // through the same reactive cache a byline reads.
      personName={(did) => {
        const profile = profileStore.profiles().find((entry) => entry.did === did);
        if (!profile) void profileStore.fetchProfile(did);
        return profile?.name || undefined;
      }}
    >
      <BlockDisplayOverrides overrides={moduleBlockDisplays()}>
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
                    routesWithViews().length
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
      </BlockDisplayOverrides>
    </BlockHostProvider>
  );
}
