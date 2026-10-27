import { forgetBootSnapshot, readBootSnapshot } from '@shared/bundles/bootSnapshot';
import {
  type AppFace,
  deviceAppOf,
  resolveFace,
  setCurrentProductName,
  svgDataUrl,
  WE_PRODUCT_NAME,
} from '@shared/bundles/brand';
import { readDeviceApp, writeDeviceApp } from '@shared/bundles/deviceApp';
import { appSpaceTemplate, followedTemplateId } from '@shared/bundles/display';
import { displaySourceOf, readInstalledBundles } from '@shared/bundles/installedBundles';
import { bootScreenTemplate, placesNode } from '@shared/bundles/judgeBundle';
import { offeredInPickers } from '@shared/devOnlyOffers';
import { appTemplateRegistry, DEFAULT_APP_ID, resolveAppTemplate } from '@shared/registries/appTemplates';
import { withDerivedIds } from '@shared/registries/derivedIds';
import { reservedTemplateIds } from '@shared/registries/reservedTemplateIds';
import { seedBundleAppId, seedBundlePages, seedBundlePieces } from '@shared/registries/seedBundles';
import { slotRegistry } from '@shared/registries/slotRegistry';
import { devOnlyTemplateIds, templateRegistry } from '@shared/registries/templateRegistry';
import { profileTemplate, settingsTemplate } from '@shared/schemas';
import { getSeed } from '@shared/seedRegistry';
import { reserveId } from '@shared/templateIdentity';
import { withLibrary, withLibraryListed } from '@shared/templateLists';
import { explain } from '@shared/userMessage';
import { deepClone } from '@shared/utils';
import { type NewRecord, trace } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import {
  AGENT_DEFAULT,
  asFileField,
  compressImageToFileData,
  decodeTemplateFile,
  encodeTemplateFile,
  FOLLOW_SPACE,
  ImageBlock,
  runEntityTransaction,
  SpacePreference,
  SpaceTemplatePreference,
  Template,
} from '@we/entities';
import type { RouteSchema, SchemaNode, TemplateMeta, TemplateSchema } from '@we/schema-shared';
import { ensureNodeIds, hasViewsMarker, templateThemeIds } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

import { CHROME_TIER, SPACE_TIER } from '../../../shared/registries/templateSurface';
import { beginRender, leaveSafeMode, safeMode, type SafeModeState } from '../../../shared/safeMode';
import {
  acceptTemplate,
  describeAcceptance,
  describeCapabilities,
  describeRefusal,
} from '../../../shared/templateAcceptance';
import { remoteUpdateFor, TEMPLATE_WATCH_FIELDS, templateChanges } from '../../../shared/templateSync';
import { type AppDataset, canonicalSpaceId, useDatasetStore } from './DatasetStore';
import { useRouteStore } from './RouteStore';
import { useSessionStore } from './SessionStore';
import { createSpaceRecordWait } from './spaceRecordWait';
import { createTemplateDrafts } from './templateDrafts';
import { useThemeStore } from './ThemeStore';

const emptyMeta: TemplateMeta = { name: '', description: '', icon: '' };
const emptyTemplate: TemplateSchema = { id: '', meta: emptyMeta, type: '', children: [], slots: {}, routes: [] };

export type TemplateManagementItem = {
  id: string;
  name: string;
  icon: string;
  description: string;
  isBuiltIn: boolean;
  isInstalled: boolean;
  isDefault: boolean;
};

/**
 * A template in your library that could not be loaded, because it no longer validates.
 *
 * Listed so it can be seen and deleted. It used to be skipped before it reached any list, which made
 * it invisible and also undeletable, since every library action finds a template by the id it was
 * listed under. A copy of a built-in made before a validator was tightened lived on that way, with
 * nothing but a console warning to say it existed.
 */
export type RefusedTemplate = {
  /** The record's own id: a refused template has no schema id anyone may trust. */
  id: string;
  name: string;
  icon: string;
  /** Why it was refused, as the validator put it, with where in the template it is. */
  reason: string;
};

export type TemplateSwitcherItem = {
  id: string;
  name: string;
  icon: string;
  /**
   * Whether editing *this* row would open a session that can be saved.
   *
   * Per row, and that is the whole point of it being here. `editorStore.isReadOnly` answers the same
   * question about whatever is currently on screen, so a picker gating its edit control on that can
   * only ever offer it for the active row — which is why editing a template you were not already
   * using took two extra clicks: switch, reopen the menu, then edit.
   *
   * Derived exactly as `isReadOnly` is, and from the same predicate the "Built-in" *group* is
   * filtered by. There used to be two, differing on a built-in somebody had saved over — it had
   * stored overrides, so it was editable while still being listed as built-in. Ids are reserved
   * now (see `reserveTemplateId`), so that state cannot arise and one predicate answers both.
   */
  editable: boolean;
};
export type TemplateSwitcherGroup = { label: string; items: TemplateSwitcherItem[] };

/** The slice of a Space model this store needs to resolve default templates. */
export interface SpaceLike {
  uuid?: string;
  url?: string;
  defaultTemplateId?: string;
}

/**
 * A marketplace template that has been fetched and judged, waiting on a person's decision.
 *
 * Everything the dialog needs is here rather than re-derived when it opens: `capabilities` is
 * already in the words a person reads, `blocked` already names the paths, and `schema` is the
 * accepted tree — so confirming writes exactly what the dialog described.
 */
export interface PendingInstall {
  marketplaceId: string;
  /** Your own library, or the space on screen — the difference between a personal act and one every member sees. */
  destination: 'personal' | 'space';
  schema: TemplateSchema;
  name: string;
  icon: string;
  version: number;
  /** What it will be able to do, one sentence each. Empty for a template that reads nothing. */
  capabilities: string[];
  /** Store paths it names that it will not be allowed to use — the parts that will be inert. */
  blocked: string[];
}

/** What the app in use calls itself. `name` is always set — WE's own when nothing else is. */
export interface AppBrand {
  /** Whether a bundle's brand is showing, rather than WE's. */
  active: boolean;
  /** The bundle it came from, `''` for WE's own. */
  bundleId: string;
  name: string;
  /** The mark, as a URL an image can draw; empty for WE's, whose surfaces draw WE's own mark. */
  mark: string;
  /** The wordmark, the same way. */
  wordmark: string;
  /** The About page, as Markdown; empty for WE's. */
  about: string;
  /** The bundle's own page that "About" opens, by the id it is opened at; empty when it has none. */
  aboutPage: string;
}

export interface TemplateStore {
  /** Injected by SpaceStore (mounted below) — see resolveSpaceFromPerspective. */
  provideSpaceLookup: (lookup: () => SpaceLike[]) => void;
  // State
  personalTemplates: Accessor<TemplateSchema[]>;
  spaceTemplates: Accessor<TemplateSchema[]>;
  builtInTemplates: Accessor<TemplateSchema[]>;
  myTemplates: Accessor<TemplateSchema[]>;
  allTemplates: Accessor<TemplateSchema[]>;
  templateManagementList: Accessor<TemplateManagementItem[]>;
  refusedTemplates: Accessor<RefusedTemplate[]>;
  switcherGroups: Accessor<TemplateSwitcherGroup[]>;
  currentSwitcherId: Accessor<string>;
  currentTemplate: TemplateSchema;
  loading: Accessor<boolean>;
  defaultTemplateId: Accessor<string>;

  // Actions
  updateTemplate: (newTemplate: TemplateSchema) => void;
  replaceTemplate: (newTemplate: TemplateSchema) => void;
  switchTemplate: (newTemplateId: string) => void;
  removeTemplate: () => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  /**
   * Write templates into the agent's library under the ids they carry, updating any already there,
   * and mark them installed. How a bundle lands; throws if any write fails. Wiring, not template API.
   */
  writeLibraryTemplates: (templates: TemplateSchema[], origin: string) => Promise<void>;
  /**
   * Write templates into a space — the one on screen, or the joined dataset `datasetId` names — under
   * the ids they carry, updating any already there, so every member has them, as a space's own
   * templates are had. How an app's sections reach a space it is set up in. Throws if any write
   * fails. Wiring, not template API.
   */
  writeSpaceTemplates: (templates: TemplateSchema[], origin: string, datasetId?: string) => Promise<void>;
  deleteRefusedTemplate: (recordId: string) => Promise<void>;
  installTemplate: (templateId: string) => Promise<void>;
  uninstallTemplate: (templateId: string) => Promise<void>;
  installFromMarketplace: (marketplaceTemplateId: string) => Promise<void>;
  installToSpace: (marketplaceTemplateId: string) => Promise<void>;
  pendingInstall: Accessor<PendingInstall | null>;
  confirmInstall: () => Promise<void>;
  cancelInstall: () => void;
  toggleInstalled: (templateId: string) => Promise<void>;
  setDefaultTemplate: (templateId: string) => Promise<boolean>;
  /** The app this agent is in — the template WE's chrome is drawn from. See the definition. */
  appTemplate: Accessor<TemplateSchema>;
  /** Its id, for a picker to show as selected. */
  appTemplateId: Accessor<string>;
  /** The apps this agent can be in: WE's own, then their own copies — `{ label, value }` for a we-select. */
  appTemplateOptions: () => { label: string; value: string }[];
  /** Choose the app this agent is in. Theirs alone, kept in their settings. */
  setAppTemplate: (id: string) => Promise<boolean>;
  /**
   * The name, mark and About page the app goes by: WE's, unless the app in use came in a bundle that
   * brings its own. Before anybody has signed in, the app this device last ran. See `bundles/brand.ts`.
   */
  brand: Accessor<AppBrand>;
  /**
   * A bundle's page by the id it is opened at (`coasys--about`), or undefined — for an id no bundle
   * here brings, and for every id in safe mode, since a page is the app's own chrome. A seed bundle's
   * pages are built in; an installed bundle's are in the library, accepted at the chrome tier.
   */
  bundlePage: (id: string) => TemplateSchema | undefined;
  saveTemplate: (name: string) => Promise<void>;
  /**
   * Save a schema as a template of its own, in the agent's library or the current space. By default it
   * then becomes the template on screen, which is what forking wants. `activate: false` saves it and
   * leaves the screen alone — what copying a section wants, since the section takes its place in the
   * shell rather than replacing the shell. A template saved beside a built-in it was forked from is
   * named "(yours)" so the two can be told apart; `rename: false` keeps the name, for a copy that
   * replaces its original rather than sitting beside it.
   */
  saveTemplateAs: (
    schema: TemplateSchema,
    destination?: 'root' | 'space',
    options?: { activate?: boolean; rename?: boolean },
  ) => Promise<boolean>;
  publishToSpace: (perspectiveUuid: string, spaceName: string) => Promise<boolean>;
  deleteMarketplaceTemplate: (templateId: string) => Promise<void>;
  publishToMarketplace: (options: {
    name: string;
    description: string;
    icon?: string;
    themeId?: string;
    slug?: string;
    screenshots: File[];
  }) => Promise<boolean>;
  persistCurrentTemplate: () => Promise<void>;
  /** Save a template's working copy to its own record, whichever template it is — see the definition. */
  persistTemplate: (template: TemplateSchema) => Promise<void>;
  /**
   * Whether somebody else's change to the template on screen is applied as it arrives, or offered
   * with an "Update now" notice. Off by default. This agent's own changes, and any change to a
   * template being edited here, always apply. See "Live template sync" in the definition.
   */
  followTemplateUpdates: Accessor<boolean>;
  setFollowTemplateUpdates: (on: boolean) => Promise<void>;
  /**
   * How the editor tells this store whether a template is being edited here, and hears that a
   * change saved elsewhere has just been put into one. Injected: the editor is built on this store.
   */
  provideEditingProbe: (probe: {
    isEditing(template: TemplateSchema): boolean;
    replaced(template: TemplateSchema): void;
  }) => void;
  /**
   * A working copy of a template edited where another draws it — a section inside its shell — as a
   * store, so what draws it updates finely. Opening one twice answers with the same copy.
   */
  openDraft: (template: TemplateSchema) => TemplateSchema;
  /** Replace a draft's contents, as `updateTemplate` does the template on screen. */
  updateDraft: (draft: TemplateSchema, next: TemplateSchema) => void;
  /** Drop a draft: what draws it goes back to the saved template. */
  closeDraft: (draft: TemplateSchema) => void;
  /** The open draft of a template, if it has one — what draws it prefers this. */
  draftOf: (template: { id?: string; _fromSpace?: boolean }) => TemplateSchema | undefined;
  preloadSpaceTemplates: (dataset: AppDataset) => Promise<void>;
  loadSpaceTemplates: (dataset: AppDataset) => Promise<void>;
  refreshSpaceTemplates: () => Promise<void>;
  clearSpaceTemplates: () => void;
  /**
   * The space on screen has not yet settled which template it renders with.
   *
   * True between a dataset becoming current and its template being applied (or found to be the one
   * already showing) — on a deep link or a reload, the length of a network fetch, during which the
   * agent's own default is on screen standing in for a template it may not be. Anything that would
   * act on *which* template this is waits on it: the section guard read the stand-in's section list,
   * decided a Workshop URL was a section the space did not have, and rewrote the address.
   */
  spaceTemplatePending: Accessor<boolean>;
  /**
   * The dataset whose own record the template store is waiting for — a space joined a moment ago —
   * or null. While it names the space on screen, the host shows that it is loading the space's data
   * rather than a template the space may not use. See `spaceRecordWait.ts`.
   */
  awaitingSpaceRecord: Accessor<string | null>;

  /**
   * Whether this tab is in safe mode — WE's own templates and themes in place of what was chosen —
   * and why. Decided before the first template rendered and fixed for the page; see `safeMode.ts`.
   */
  safeMode: Accessor<SafeModeState>;
  /** Leave safe mode, reloading with the templates and themes that were chosen. */
  leaveSafeMode: () => void;
  /**
   * Leave safe mode into another app — WE's own, or another of the agent's. The way out of an app
   * that hides every way out of it, which leaving into it again would only reopen.
   */
  leaveSafeModeInto: (appId: string) => Promise<void>;

  // Loading state
  operationLoading: Accessor<string | null>;

  // Queries
  isBuiltInTemplateId: (templateId: string) => boolean;
  isInstalled: (templateId: string) => boolean;
  getTemplateRecord: (templateId: string) => NewRecord<Template> | undefined;
}

/**
 * The `role` mirror to store beside a saved schema. See `Template.role`.
 *
 * `''` rather than `'shell'` for a shell, so a record written here is indistinguishable from one
 * written before the field existed — which is what lets the marketplace's template list ask for
 * `not: 'view'` and get both.
 */
const roleOf = (schema: { meta?: { role?: string } }): string => (schema.meta?.role === 'view' ? 'view' : '');

const TemplateContext = createContext<TemplateStore>();

const SPACE_PREFIX = 'space::';

export function TemplateStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const themeStore = useThemeStore();
  const routeStore = useRouteStore();

  /*
    Map template ID → the model instance, for we-root and for the current space's templates.

    `NewRecord` because both are filled from two places — a `findAll` on load, and whatever a save or
    an install just wrote — and a create carries no relations (see `NewRecord`). Nothing reads one off
    these: an entry is here to be addressed, saved and deleted by id. Saying so is what lets the two
    fills agree, rather than leaving a `screenshots` nobody may trust on half the entries.
  */
  const savedTemplateMap = new Map<string, NewRecord<Template>>();
  /** Library records that failed validation, by record id. See {@link RefusedTemplate}. */
  const refusedRecords = new Map<string, NewRecord<Template>>();
  const [refusedTemplates, setRefusedTemplates] = createSignal<RefusedTemplate[]>([]);
  const spaceTemplateMap = new Map<string, NewRecord<Template>>();
  /**
   * The version this agent last saved, by record id — how the watch below tells its own saves
   * coming back from somebody else's. An entry is consumed when its echo arrives. See
   * `templateChanges`.
   */
  const ownSaves = new Map<string, string>();
  /** Note a write this agent made to a template record, so its echo is not taken for news. */
  function noteOwnWrite(record: { id: string; version?: unknown }): void {
    ownSaves.set(record.id, String(record.version ?? ''));
  }

  /**
   * Make a template in this agent's library.
   *
   * The record is all there is to write: a library template is listed unless the agent hid it
   * (`AgentSettings.hiddenTemplates`), so another device watching the library lists it as soon as
   * it arrives, and so does one written by an agent or a bundle.
   */
  /**
   * Hides and unhides this session made, by record id, until the agent's settings read them back. A
   * reload of the library can land before the settings it reads have heard of the change, and would
   * otherwise put back a template just hidden.
   */
  const hiddenHere = new Map<string, boolean>();

  /** Whether this agent hid a library record from their lists. */
  function isHidden(recordId: string): boolean {
    const here = hiddenHere.get(recordId);
    if (here !== undefined) return here;
    // Without `include` a relation reads back as ids, or as records carrying one.
    const refs = (datasetStore.agentSettings()?.hiddenTemplates ?? []) as (string | { id: string })[];
    return refs.some((ref) => (typeof ref === 'string' ? ref : ref.id) === recordId);
  }

  async function createLibraryTemplate(
    handle: unknown,
    data: Parameters<typeof Template.create>[1],
  ): Promise<NewRecord<Template>> {
    const record = await Template.create(handle, data);
    noteOwnWrite(record);
    return record;
  }

  // Per-session cache of space templates keyed by perspective UUID.
  // Populated on first visit; subsequent visits restore synchronously without an AD4M fetch.
  interface SpaceTemplateCacheEntry {
    schemas: TemplateSchema[];
    models: Map<string, Template>;
    ids: Set<string>;
  }
  const spaceTemplateCache = new Map<string, SpaceTemplateCacheEntry>();
  /** Loads of a space's templates still running, by dataset id — see `preloadSpaceTemplates`. */
  const spaceTemplateLoads = new Map<string, Promise<void>>();

  // Built-in templates from registry (always available)
  const builtInTemplates: TemplateSchema[] = Object.entries(templateRegistry).map(([id, template]) => ({
    ...deepClone(template),
    id,
  }));

  // Shell templates — static system pages (profile, settings, testing)
  // landing-page is now an overlay (activeShellView), not a currentTemplate value
  const shellTemplates: TemplateSchema[] = [
    { ...deepClone(withDerivedIds(profileTemplate, 'profile')), id: 'profile' },
    { ...deepClone(withDerivedIds(settingsTemplate, 'settings')), id: 'settings' },
    /*
      The schema-test harness is deliberately absent, and was dead weight here rather than a feature.

      This list is a fallback for resolving a *template* — a persisted `defaultTemplateId` on boot,
      or a `switchTemplate` id. The harness is neither: it is only ever reached through
      `openShellView('schema-tests')`, which goes to the shell-view registry and never looks here. It
      is not in `templateManagementList` either, so it could not be made anyone's default.

      Its entry was therefore unreachable, and its cost was a static import of ~97KB of test schemas
      that a production build shipped. See `schemaTestsView` for where it lives now and why that
      shape is the thing keeping it out of the bundle.
    */
  ];

  /*
    Ensured here, not just on the paths that later replace it.

    `node.id` is what the renderer stamps as `data-we-node-id`, and it is the only handle the visual
    editor has — selection, the inspector, the role readout and every ancestry walk go through
    `findNodeById`. A tree that never passed through `ensureNodeIds` renders identically and cannot
    be clicked on at all, which does not read as a missing id, it reads as the visual editor being
    broken.

    Every other route into `currentTemplate` ensures. This one is a raw clone, so the boot template
    was the one tree in the app that could not be edited visually.
  */
  /*
    Decided now, before anything is committed: the address, the tab's memory and the record of a
    render that never finished are all read before the first template could run. See `safeMode.ts`.
  */
  const safe = safeMode();

  const initialTemplate = deepClone(
    builtInTemplates.find((t) => t.id === 'launcher') || builtInTemplates[0] || emptyTemplate,
  );
  ensureNodeIds(initialTemplate as SchemaNode);

  // State
  const [allTemplates, setAllTemplates] = createSignal<TemplateSchema[]>([...builtInTemplates]);

  /*
    What the last session on this device was drawn with, standing in for the library and the settings
    until they answer — so a reload opens in the app somebody is in rather than in WE's for the
    seconds the library takes. See `bundles/bootSnapshot.ts`. Each template in it is accepted exactly
    as the library's are, and the whole of it is dropped the moment the library has loaded.
  */
  const [libraryLoaded, setLibraryLoaded] = createSignal(false);
  const bootSnapshot = createMemo(() => (libraryLoaded() ? null : readBootSnapshot(session.me()?.did)));
  createEffect(() => {
    const snapshot = bootSnapshot();
    if (!snapshot?.templates.length) return;
    const accepted = snapshot.templates.flatMap((raw) => {
      const result = acceptTemplate(raw, { origin: 'your library', grants: CHROME_TIER });
      return result.schema ? [{ ...result.schema, id: raw.id }] : [];
    });
    const ids = new Set(accepted.map((t) => t.id));
    setAllTemplates((prev) => withLibrary(prev, [...builtInTemplates.filter((t) => !ids.has(t.id)), ...accepted]));
  });
  /** A setting as the agent's settings have it, or as the snapshot remembers it until they arrive. */
  const settingOrRemembered = (key: 'appTemplateId' | 'installedBundles') => {
    const settings = datasetStore.agentSettings();
    return settings ? settings[key] : bootSnapshot()?.[key];
  };
  const [installedIds, setInstalledIds] = createSignal<Set<string>>(new Set());
  const [spaceTemplateIdSet, setSpaceTemplateIdSet] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal(true);
  const [currentTemplate, setCurrentTemplate] = createStore<TemplateSchema>(initialTemplate);
  const [operationLoading, setOperationLoading] = createSignal<string | null>(null);
  /** The install dialog's subject — see `requestInstall`. Non-null is what mounts the dialog. */
  const [pendingInstall, setPendingInstall] = createSignal<PendingInstall | null>(null);
  // Shell overlay: which shell view (if any) is currently shown above the active template

  /** Working copies of templates edited where another draws them — see `templateDrafts.ts`. */
  const { openDraft, updateDraft, closeDraft, draftOf } = createTemplateDrafts({
    onInvalid: (message) => toastService.error(`Schema validation failed: ${message}`),
  });

  /*
    An app template is the chrome around every space, chosen by the agent — never a space's template.
    It is stored like any template, so every list a space's template is chosen from leaves it out.
  */
  const isApp = (t: TemplateSchema) => t.meta?.role === 'app';
  // A bundle's page is the app's own as well: opened by the host, never chosen for a space.
  const isPage = (t: TemplateSchema) => t.meta?.role === 'page';
  // A showcase template only while developer tools are showing — see `offeredInPickers`.
  const spaceChoosable = () =>
    offeredInPickers(
      allTemplates().filter((t) => !isApp(t) && !isPage(t)),
      session.devTools(),
      devOnlyTemplateIds,
    );

  const personalTemplates = () => {
    const installed = installedIds();
    const spaceIds = spaceTemplateIdSet();
    return spaceChoosable().filter(
      (t) => !spaceIds.has(t.id || '') && (isBuiltInTemplateId(t.id || '') || installed.has(t.id || '')),
    );
  };

  const spaceTemplates = () => spaceChoosable().filter((t) => t._fromSpace);

  const builtInTemplatesAccessor = () => spaceChoosable().filter((t) => isBuiltInTemplateId(t.id || ''));

  // User-installed templates that are neither built-in core nor from the current space
  const myTemplates = () => {
    const installed = installedIds();
    return spaceChoosable().filter(
      (t) => !isBuiltInTemplateId(t.id || '') && !t._fromSpace && installed.has(t.id || ''),
    );
  };

  /*
    The app this agent is in: the template WE's own chrome is drawn from.

    Their own choice, else the deployment's (the seed's `host.ui.app`), else WE's. Only WE's apps and
    the agent's own copies are honoured — an app is drawn with the chrome tier, so one from a
    stranger waits for an install that asks first. Safe mode always draws WE's, so an app that hides
    every way out is never the only way in. While the app is being edited, its working copy is drawn.
  */
  const ownApps = () => allTemplates().filter((t) => isApp(t) && !t._fromSpace && !!t.id);
  const appTemplate = createMemo<TemplateSchema>(() => {
    const found = resolveAppTemplate({
      safe: safe.on,
      chosen: settingOrRemembered('appTemplateId'),
      seed: getSeed().host?.ui?.app || seedBundleAppId,
      own: ownApps(),
    });
    return draftOf(found) ?? found;
  });
  /** The apps on offer: what a we-select needs, and what a picker row needs — its icon, and whether it can be edited in place. */
  const appOption = (t: TemplateSchema, editable: boolean) => ({
    label: t.meta?.name ?? t.id ?? '',
    value: t.id ?? '',
    icon: t.meta?.icon ?? '',
    editable,
  });
  const appTemplateOptions = () => [
    ...Object.values(appTemplateRegistry).map((t) => appOption(t, false)),
    // An app that came in a bundle is that bundle's — forked to change, and removed with it.
    ...ownApps().map((t) => appOption(t, !t.source)),
  ];
  const appTemplateId = () => appTemplate().id ?? DEFAULT_APP_ID;
  /**
   * The space template the app the agent is in shows every space with, or undefined when spaces keep
   * their own — the app's display policy, from the bundle it came in. See `bundles/display.ts`.
   */
  const appSpaceTemplateId = createMemo(() =>
    appSpaceTemplate(appTemplateId(), [
      ...seedBundlePieces,
      ...readInstalledBundles(settingOrRemembered('installedBundles')).map(displaySourceOf),
    ]),
  );
  async function setAppTemplate(id: string): Promise<boolean> {
    const saved = await datasetStore.updateAgentSettings({ appTemplateId: id === DEFAULT_APP_ID ? '' : id });
    /*
      Entering an app adopts its look: the first theme it names becomes the agent's default, at the
      moment they chose the app. A choice they make afterwards wins, as any later choice does — this
      is the app's suggestion made once, not a setting it keeps imposing.
    */
    const app = ownApps().find((t) => t.id === id) ?? appTemplateRegistry[id];
    const theme = templateThemeIds(app?.meta).find((themeId) => themeStore.allThemes().some((t) => t.id === themeId));
    if (saved && theme) await themeStore.setDefaultTheme(theme);
    return saved;
  }
  async function leaveSafeModeInto(appId: string): Promise<void> {
    if (typeof appId !== 'string' || !appTemplateOptions().some((option) => option.value === appId)) return;
    if (!(await setAppTemplate(appId))) {
      toastService.error('Could not change the app, so safe mode stays on');
      return;
    }
    // The device remembers the app it last drew, for the next reload's first frame. Forgotten, so
    // that frame cannot be the app just left — the one most likely to be why safe mode is on.
    forgetBootSnapshot(session.me()?.did);
    leaveSafeMode();
  }

  /*
    The app's face — its name, mark and sign-in screen — and what follows from it. See
    `bundles/brand.ts` for the rule and `bundles/deviceApp.ts` for why the device keeps a copy.
  */
  const rememberedApp = readDeviceApp();
  const settled = () => !!datasetStore.agentSettings() && libraryLoaded();
  const face = createMemo<AppFace>(() =>
    resolveFace({
      safe: safe.on,
      settled: settled(),
      inUseBundle: appTemplate().source?.bundle,
      sources: [
        ...seedBundlePieces,
        ...readInstalledBundles(settingOrRemembered('installedBundles')).map((entry) => ({
          bundleId: entry.id,
          brand: entry.brand,
          bootScreen: entry.bootScreen,
        })),
      ],
      device: rememberedApp,
    }),
  );
  const brand = createMemo<AppBrand>(() => {
    const { bundleId, brand: own } = face();
    return {
      active: !!own,
      bundleId,
      name: own?.name || WE_PRODUCT_NAME,
      mark: svgDataUrl(own?.mark),
      wordmark: svgDataUrl(own?.wordmark),
      about: own?.about ?? '',
      aboutPage: own?.aboutPage ?? '',
    };
  });
  const bundlePage = (id: string): TemplateSchema | undefined => {
    if (safe.on) return undefined;
    return (
      seedBundlePages[id] ?? allTemplates().find((t) => t.id === id && isPage(t) && !t._fromSpace && !!t.source?.bundle)
    );
  };

  // The app's first theme stands in for the agent's default until they choose one.
  themeStore.provideAppTheme(() =>
    safe.on
      ? undefined
      : templateThemeIds(appTemplate().meta).find((id) => themeStore.allThemes().some((t) => t.id === id)),
  );

  // Kept for the next boot's sign-in screen, once the app in use is known rather than guessed.
  createEffect(() => {
    if (!settled() || safe.on) return;
    const offered = new Set(templateThemeIds(appTemplate().meta));
    writeDeviceApp(deviceAppOf(face(), offered.size ? themeStore.allThemes().filter((t) => offered.has(t.id)) : []));
  });

  // The window's name and icon, and the name code that is not a template reads.
  if (typeof document !== 'undefined') {
    const baseTitle = document.title;
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    const baseIcon = iconLink?.getAttribute('href') ?? null;
    createEffect(() => {
      const { active, name, mark } = brand();
      setCurrentProductName(name);
      document.title = active ? name : baseTitle;
      if (iconLink && baseIcon !== null) iconLink.setAttribute('href', active && mark ? mark : baseIcon);
    });
  }

  /*
    The sign-in screen: the app's own when it brings one that still passes — accepted at the chrome
    tier, as its app is, and placing the host's password field — else whatever was there before (the
    seed's, or WE's). The slot is replaced rather than drawn around, so the boot screen is one thing
    whoever drew it.
  */
  let baseBootScreen: SchemaNode | undefined;
  createEffect(() => {
    const own = face().bootScreen;
    baseBootScreen ??= slotRegistry.get('core:bootScreen')?.node;
    let node = baseBootScreen;
    if (own && placesNode(own, 'CredentialField')) {
      const accepted = acceptTemplate(bootScreenTemplate({ bootScreen: own, name: brand().name }), {
        origin: `the app “${brand().name}”`,
        grants: CHROME_TIER,
      });
      if (accepted.schema) {
        const { meta: _meta, ...screen } = accepted.schema;
        node = screen as SchemaNode;
      }
    }
    if (node && slotRegistry.get('core:bootScreen')?.node !== node) slotRegistry.replace('core:bootScreen', node);
  });

  const toSwitcherItems = (templates: TemplateSchema[], prefix = ''): TemplateSwitcherItem[] =>
    templates.map((t) => ({
      id: prefix + (t.id || ''),
      name: t.meta?.name || '',
      icon: t.meta?.icon || '',
      // From the unprefixed id: the prefix distinguishes a space's copy from your own for keying
      // rows, and is not part of any identity the template registry knows about.
      // Not one an installed app brought, which is that app's: editing it means forking it.
      editable: !isBuiltInTemplateId(t.id || '') && !t.source,
    }));

  // Grouped template data for the template switcher UI — flat name/icon fields allow $filter in schemas
  const switcherGroups = (): TemplateSwitcherGroup[] => [
    { label: 'Space templates', items: toSwitcherItems(spaceTemplates(), SPACE_PREFIX) },
    { label: 'My templates', items: toSwitcherItems(myTemplates()) },
    { label: 'Built-in', items: toSwitcherItems(builtInTemplatesAccessor()) },
  ];

  /**
   * The active template's id *as the switcher spells it* — `SPACE_PREFIX` and all.
   *
   * A switcher row is keyed by a prefixed id, because a space's copy of a template and your own can
   * share an id and are still two different rows. Deciding which row is the current one therefore
   * means re-applying that prefix, and a schema cannot: it has no string concatenation on a
   * conditional, so a picker doing this by hand would have to compare against the unprefixed id and
   * light up both rows. Derived here, next to the function that builds the ids.
   */
  const currentSwitcherId = (): string =>
    currentTemplate._fromSpace ? SPACE_PREFIX + (currentTemplate.id || '') : currentTemplate.id || '';

  const defaultTemplateId = () => datasetStore.agentSettings()?.defaultTemplateId || 'default';

  /** Load saved templates from root perspective and merge with built-in */
  async function loadSavedTemplates(): Promise<void> {
    try {
      const perspective = datasetStore.rootDataset()?.handle;
      if (!perspective) return;

      const allDbTemplates = await Template.findAll(perspective);

      savedTemplateMap.clear();
      refusedRecords.clear();
      const savedTemplates: TemplateSchema[] = [];
      const refused: RefusedTemplate[] = [];

      for (const template of allDbTemplates) {
        const raw = decodeTemplateFile<TemplateSchema>(template.schema);
        if (!raw) continue;

        // Your own installed templates, at the chrome tier — this is the agent's own library, and
        // one of these may legitimately be a chrome template. Checked all the same: a template
        // installed six months ago from a marketplace is not more trustworthy for having aged, and
        // a structurally broken one blanks the app just as thoroughly.
        const accepted = acceptTemplate(raw, { origin: 'your library', grants: CHROME_TIER });
        if (!accepted.schema) {
          console.warn(describeAcceptance(accepted, 'your library').join('\n'));
          refusedRecords.set(template.id, template);
          refused.push({
            id: template.id,
            name: template.name || (raw as Partial<TemplateSchema>).meta?.name || 'Untitled template',
            icon: template.icon || (raw as Partial<TemplateSchema>).meta?.icon || 'warning',
            reason: describeRefusal(accepted),
          });
          continue;
        }
        if (accepted.blocked.length || accepted.refusedElements.length)
          console.warn(describeAcceptance(accepted, 'your library').join('\n'));
        const schema = accepted.schema;
        // Prefer the ID embedded in the schema (set during save) over deriving from name
        const requested = schema.id || template.name?.toLowerCase().replace(/\s+/g, '-') || template.id;
        // Re-ids a record written before ids were reserved, so it stops hiding a built-in.
        const templateId = await adoptStoredId(template, schema, requested);

        const entry = { ...schema, id: templateId, templateVersion: template.version ?? 1 };
        savedTemplates.push(entry);
        savedTemplateMap.set(templateId, template);
      }

      setRefusedTemplates(refused);

      // If a saved template shares an ID with a core template, use the saved version
      const savedIds = new Set(savedTemplates.map((t) => t.id));
      const filteredCore = builtInTemplates.filter((t) => !savedIds.has(t.id));
      setAllTemplates((prev) => withLibrary(prev, [...filteredCore, ...savedTemplates]));
      setLibraryLoaded(true);

      const library = [...savedTemplateMap].map(([id, model]): [string, string] => [id, model.id]);
      setInstalledIds((prev) => withLibraryListed(prev, library, isHidden, (id) => spaceTemplateMap.has(id)));
    } catch (error) {
      console.error('TemplateStore: loadSavedTemplates error', error);
    }
  }

  /** Remove all current-space templates from state — call before switching spaces */
  function clearSpaceTemplates() {
    const spaceIds = new Set(spaceTemplateMap.keys());
    spaceTemplateMap.clear();
    setSpaceTemplateIdSet(new Set<string>());
    if (spaceIds.size === 0) return;
    // Remove only _fromSpace entries — personal templates with the same slug must stay
    setAllTemplates((prev) => prev.filter((t) => !t._fromSpace));
    setInstalledIds((prev) => {
      const next = new Set(prev);
      // Only drop from installedIds if the ID isn't also a personal template
      spaceIds.forEach((id) => {
        if (!savedTemplateMap.has(id)) next.delete(id);
      });
      return next;
    });
  }

  /**
   * Read a space's templates — decoded, through the trust gate, keyed by the id each is known by —
   * without touching what is on screen. `loadSpaceTemplates` puts what this reads in place on entering
   * a space; `refreshSpaceTemplatesInPlace` does when one changes while it is open.
   */
  async function readSpaceTemplates(dataset: AppDataset): Promise<SpaceTemplateCacheEntry> {
    const readStarted = performance.now();
    const spaceDbTemplates = await Template.findAll(dataset.handle);
    // Each record's schema is a stored file the backend resolves as it reads, so the count is the cost.
    trace('dataset', 'space:templates', {
      dataset: dataset.id,
      count: spaceDbTemplates.length,
      ms: Math.round(performance.now() - readStarted),
    });
    const schemas: TemplateSchema[] = [];
    const models = new Map<string, Template>();

    for (const template of spaceDbTemplates) {
      const raw = decodeTemplateFile<TemplateSchema>(template.schema);
      if (!raw) continue;

      // The untrusted route, and the one nobody opted into: a shared space's templates arrive
      // with the space, so merely visiting is enough to render one. Space tier, and a refusal
      // skips the template rather than the space.
      const origin = `space "${dataset.name ?? dataset.id}"`;
      const accepted = acceptTemplate(raw, { origin, grants: SPACE_TIER });
      if (!accepted.schema) {
        console.warn(describeAcceptance(accepted, origin).join('\n'));
        continue;
      }
      if (accepted.blocked.length || accepted.refusedElements.length)
        console.warn(describeAcceptance(accepted, origin).join('\n'));
      const schema = accepted.schema;
      const templateId = schema.id || template.name?.toLowerCase().replace(/\s+/g, '-') || template.id;

      schemas.push({ ...schema, id: templateId, _fromSpace: true });
      models.set(templateId, template);
    }

    return { schemas, models, ids: new Set(schemas.map((t) => t.id || '').filter(Boolean)) };
  }

  /** Put a space's templates in the lists and the cache — the second half of a load. */
  function placeSpaceTemplates(dataset: AppDataset, read: SpaceTemplateCacheEntry): void {
    spaceTemplateMap.clear();
    for (const [id, model] of read.models) spaceTemplateMap.set(id, model);
    // Always cache the result (including empty) so subsequent visits skip the fetch
    spaceTemplateCache.set(dataset.id, read);
    // One write, so nothing watching the list sees the space's templates gone for a moment.
    setAllTemplates((prev) => [...prev.filter((t) => !t._fromSpace), ...read.schemas]);
    setInstalledIds((prev) => {
      const next = new Set(prev);
      read.schemas.forEach((t) => t.id && next.add(t.id));
      return next;
    });
    setSpaceTemplateIdSet(read.ids);
  }

  /** Load templates from a space perspective, merge into allTemplates, and populate the cache */
  async function loadSpaceTemplates(dataset: AppDataset): Promise<void> {
    clearSpaceTemplates();
    try {
      placeSpaceTemplates(dataset, await readSpaceTemplates(dataset));
    } catch (error) {
      console.error('TemplateStore: loadSpaceTemplates error', error);
    }
  }

  /**
   * Read the open space's templates again and swap them in at once — what a change to one of them,
   * saved elsewhere, needs. Unlike `loadSpaceTemplates` it never clears first: an effect following
   * the space's default template would read "not loaded" in between and choose again.
   */
  async function refreshSpaceTemplatesInPlace(dataset: AppDataset): Promise<void> {
    try {
      const read = await readSpaceTemplates(dataset);
      if (datasetStore.currentDataset()?.id !== dataset.id) return;
      placeSpaceTemplates(dataset, read);
    } catch (error) {
      console.error('TemplateStore: refreshing space templates failed', error);
    }
  }

  /**
   * Ensure space templates for a perspective are in allTemplates.
   * Cache hit: restores synchronously from session cache (no AD4M fetch).
   * Cache miss: full async load that also populates the cache.
   */
  async function preloadSpaceTemplates(dataset: AppDataset): Promise<void> {
    // A boot starts this for the space the address names; the switch the route asks for moments
    // later joins the load rather than starting a second one.
    const inFlight = spaceTemplateLoads.get(dataset.id);
    if (inFlight) return inFlight;
    const cached = spaceTemplateCache.get(dataset.id);
    if (cached) {
      clearSpaceTemplates();
      if (cached.schemas.length > 0) {
        cached.models.forEach((model, id) => spaceTemplateMap.set(id, model));
        setAllTemplates((prev) => [...prev.filter((t) => !t._fromSpace), ...cached.schemas]);
        setInstalledIds((prev) => {
          const next = new Set(prev);
          cached.ids.forEach((id) => next.add(id));
          return next;
        });
        setSpaceTemplateIdSet(cached.ids);
      }
      return;
    }
    const load = loadSpaceTemplates(dataset).finally(() => spaceTemplateLoads.delete(dataset.id));
    spaceTemplateLoads.set(dataset.id, load);
    await load;
  }

  // Load saved templates when root perspective becomes available
  createEffect(() => {
    if (datasetStore.rootDataset()) {
      loadSavedTemplates().finally(() => setLoading(false));
    }
  });

  // Space models are owned by SpaceStore, which mounts BELOW this store (it depends on template
  // preloading). It injects this lookup at creation, keeping the dependency one-directional; the
  // empty default only exists between this provider mounting and SpaceStore mounting, during
  // which no space can be open.
  let spaceLookup: () => SpaceLike[] = () => [];
  function provideSpaceLookup(lookup: () => SpaceLike[]): void {
    spaceLookup = lookup;
  }

  function resolveSpaceFromPerspective(dataset: AppDataset) {
    const allKnownSpaces = spaceLookup();
    return dataset.sharedId
      ? allKnownSpaces.find((s) => s.url === dataset.sharedId)
      : allKnownSpaces.find((s) => s.uuid === dataset.id);
  }

  /**
   * The dataset whose template question has been answered — applied, or found to have nothing to
   * apply.
   *
   * `spaceTemplatePending` is derived from this against the current dataset rather than being a flag
   * the effect below raises, so it is true from the very frame the dataset changes. A flag would
   * depend on that effect running before every reader of it, and the reader that matters — the
   * section guard in TemplateProvider — is an effect too.
   */
  const [templateResolvedFor, setTemplateResolvedFor] = createSignal<string | null>(null);
  const spaceTemplatePending = () => {
    const dataset = datasetStore.currentDataset();
    return !!dataset && templateResolvedFor() !== dataset.id;
  };

  // A space joined a moment ago may not have its own record yet — see `spaceRecordWait.ts`.
  const spaceRecord = createSpaceRecordWait({
    currentId: () => datasetStore.currentDataset()?.id ?? null,
    spaceOf: () => {
      const perspective = datasetStore.currentDataset();
      return perspective ? resolveSpaceFromPerspective(perspective) : undefined;
    },
    hasTemplate: (id) => allTemplates().some((t) => t.id === id),
    choose: async () => {
      const perspective = datasetStore.currentDataset();
      if (perspective) await chooseSpaceTemplate(perspective);
    },
    settle: setTemplateResolvedFor,
  });

  // On space switch: apply default template.
  // When navigateToSpace pre-loads templates, the cache is already populated and the
  // template switches synchronously here. For deep links / page refresh, takes the async path.
  let lastSpacePerspectiveUuid: string | null = null;
  createEffect(() => {
    const perspective = datasetStore.currentDataset();
    if (!perspective) {
      clearSpaceTemplates();
      lastSpacePerspectiveUuid = null;
      return;
    }
    if (perspective.id === lastSpacePerspectiveUuid) return;
    lastSpacePerspectiveUuid = perspective.id;

    if (spaceTemplateCache.has(perspective.id)) {
      // Templates were pre-loaded by navigateToSpace — apply synchronously
      const cachedSpace = resolveSpaceFromPerspective(perspective);
      const followed = followedTemplateId(cachedSpace?.defaultTemplateId, untrack(appSpaceTemplateId));
      if (followed) {
        const template =
          allTemplates().find((t) => t.id === followed && t._fromSpace) ||
          allTemplates().find((t) => t.id === followed);
        if (template) replaceTemplate(template);
      }
      /*
        Settled only once the space's own record is here. The cache says the templates were read,
        not that the record naming one of them has arrived: a join warms the cache before switching
        to the space, often before its record has synced, and settling then let the section guard
        rewrite a link into the space's own template before that template was known.
      */
      if (cachedSpace) setTemplateResolvedFor(perspective.id);
      else spaceRecord.wait(perspective.id);
    } else {
      /*
        The app's display policy decides this space's template whenever the agent follows the space,
        which is nearly always — so it is shown now rather than after the space's templates and this
        agent's override for it have been read, seconds later on a reload. The read below still has
        the last word: an override for this space replaces it.
      */
      const policy = untrack(appSpaceTemplateId);
      const early = policy ? untrack(allTemplates).find((t) => t.id === policy) : undefined;
      if (early) replaceTemplate(early);
      // Deep link or first boot — async path. Settled on every way out, a failure included: the
      // template on screen is then the answer, and anything waiting on one should stop waiting. Only
      // while still in that space: a slow answer for one already left must not overwrite the
      // answer for the space now open, which would leave it pending for good.
      void applySpaceTemplate(perspective, undefined, { shownEarly: !!early }).finally(() => {
        if (lastSpacePerspectiveUuid !== perspective.id) return;
        // A space joined a moment ago may not have its own record yet, so nothing above could say
        // which template it shows. Not settled: see `spaceRecordWait.ts`.
        if (!resolveSpaceFromPerspective(perspective)) spaceRecord.wait(perspective.id);
        else setTemplateResolvedFor(perspective.id);
      });
    }
  });

  /*
    The space's default template, followed after the space has settled.

    The choice above is made on arriving in a space. A record can arrive in pieces — the `Space`
    first and its `defaultTemplateId` a moment later — and a space need not name a default at all,
    so "none yet" and "none" read alike when it is made. And another member can change the default
    while this agent is in the space. Either way the record changes under a space that has already
    settled, and nothing asked again. Keyed on the template it names *and* whether that template is
    loaded, because a space's own template syncs in like its record.

    Only within one space: arriving in another is the effect above's to answer, and a space still
    pending is the wait's.
  */
  let followedDefault: { dataset: string; template: string } | null = null;
  createEffect(() => {
    const perspective = datasetStore.currentDataset();
    const named = perspective ? (resolveSpaceFromPerspective(perspective)?.defaultTemplateId ?? '') : '';
    const present = !named || allTemplates().some((t) => t.id === named);
    const key = perspective ? { dataset: perspective.id, template: present ? named : '' } : null;
    const previous = followedDefault;
    followedDefault = key;
    if (!perspective || !key || previous?.dataset !== key.dataset || previous.template === key.template) return;
    if (templateResolvedFor() !== perspective.id) return;
    void untrack(() => chooseSpaceTemplate(perspective));
  });

  /**
   * This agent's template override for a space, migrating the legacy record on the way past.
   *
   * `SpaceTemplatePreference` could say only whether to follow the space or follow your own default.
   * `SpacePreference.templateId` says *which* template, and expresses both of those as values —
   * `''` and `AGENT_DEFAULT` — so it strictly subsumes the older record. Rather than read two
   * shapes forever, the first time a space is opened with a legacy record and no new one, the old
   * answer is written across and the old record deleted.
   *
   * Migrating on read rather than in a boot sweep: it touches only spaces actually visited, needs no
   * separate pass to fail halfway through, and a record that never gets read never mattered.
   */
  async function migrateAndReadTemplateOverride(
    rootPerspective: Parameters<typeof SpacePreference.findAll>[0],
    perspective: AppDataset,
  ): Promise<string> {
    const [preference] = await SpacePreference.findAll(rootPerspective, {
      where: { spaceUuid: perspective.id },
    }).catch(() => [] as SpacePreference[]);
    if (preference) return preference.templateId || FOLLOW_SPACE;

    const spaceUrl = perspective.sharedId || perspective.id;
    const [legacy] = await SpaceTemplatePreference.findAll(rootPerspective, { where: { spaceUrl } }).catch(
      () => [] as SpaceTemplatePreference[],
    );
    if (!legacy) return FOLLOW_SPACE;

    const templateId = legacy.preference === 'user' ? AGENT_DEFAULT : FOLLOW_SPACE;
    try {
      await SpacePreference.create(rootPerspective, { spaceUuid: perspective.id, templateId });
      await legacy.delete();
    } catch (error) {
      // A failed migration must not stop the space opening — the value is still known here, and the
      // next visit will try again.
      console.warn('TemplateStore: could not migrate SpaceTemplatePreference', error);
    }
    return templateId;
  }

  async function applySpaceTemplate(
    perspective: AppDataset,
    fallback?: string,
    options: { shownEarly?: boolean } = {},
  ): Promise<void> {
    // preloadSpaceTemplates handles cache hit (sync restore) or miss (AD4M fetch)
    await preloadSpaceTemplates(perspective);
    await chooseSpaceTemplate(perspective, fallback, options);
  }

  /**
   * Which template this space shows, from what has already been read — its record, this agent's
   * override, the templates loaded. The half of `applySpaceTemplate` after the preload, so the
   * late path below can run it without restoring the cached template list over newer arrivals.
   */
  async function chooseSpaceTemplate(
    perspective: AppDataset,
    fallback?: string,
    options: { shownEarly?: boolean } = {},
  ): Promise<void> {
    // Use mySpaces cache for defaultTemplateId — avoids a redundant Space.findOne round-trip
    const cachedSpace = resolveSpaceFromPerspective(perspective);

    // Read per-space preferences from we-root directly rather than through SpaceStore, which mounts
    // below this one — the same reason `provideSpaceLookup` exists.
    const rootPerspective = datasetStore.rootDataset()?.handle;
    const templateOverride = rootPerspective
      ? await migrateAndReadTemplateOverride(rootPerspective, perspective)
      : FOLLOW_SPACE;

    // The override names *which* template this agent wants here, so it answers on its own —
    // including when the space set no default at all, which the community-default path cannot act
    // on. `AGENT_DEFAULT` means "whatever my default is", so leave whatever is already applied.
    if (templateOverride === AGENT_DEFAULT) {
      // "Leave it" means the agent's default, not the app's template shown while this was read.
      const own = options.shownEarly ? allTemplates().find((t) => t.id === defaultTemplateId()) : undefined;
      if (own && datasetStore.currentDataset()?.id === perspective.id) replaceTemplate(own);
      return;
    }
    const spaceTemplateId =
      (templateOverride === FOLLOW_SPACE
        ? followedTemplateId(cachedSpace?.defaultTemplateId, appSpaceTemplateId())
        : templateOverride) ?? fallback;
    if (!spaceTemplateId) return;

    const spaceTemplate =
      allTemplates().find((t) => t.id === spaceTemplateId && t._fromSpace) ||
      allTemplates().find((t) => t.id === spaceTemplateId);
    if (!spaceTemplate) return;

    // Guard: if the user navigated away before the async work completed, skip
    if (datasetStore.currentDataset()?.id !== perspective.id) return;

    replaceTemplate(spaceTemplate);

    // Only worth saying when the agent prefers their own template generally and has expressed no
    // choice for this space — an explicit override, either way, is not a surprise worth a toast.
    const settings = datasetStore.agentSettings();
    if (settings && !settings.useSpaceTemplate && templateOverride === FOLLOW_SPACE) {
      toastService.info(`Viewing with this space's template. Open its settings to use your own.`, 7000);
    }
  }

  /*
    Changing app changes how the space on screen is shown when the app has a display policy, so the
    space's template is chosen again. Deferred: on first run the space effect above has just chosen it.
  */
  createEffect(
    on(
      appSpaceTemplateId,
      () => {
        const perspective = untrack(datasetStore.currentDataset);
        // A space with no template of its own falls back to the agent's default, so leaving an app
        // that showed it its own way does not leave that app's template on screen.
        if (perspective) void applySpaceTemplate(perspective, untrack(defaultTemplateId));
      },
      { defer: true },
    ),
  );

  // Restore persisted template choice on boot (runs once, then stops)
  let initialRestoreDone = false;
  createEffect(() => {
    const prefs = datasetStore.agentSettings();
    if (loading() || initialRestoreDone) return;
    // Use defaultTemplateId for boot, fall back to currentTemplateId for backward compat
    const bootId = prefs?.defaultTemplateId || prefs?.currentTemplateId;
    // Always boot on the landing page overlay — skip restore for 'default' and 'landing-page'.
    // 'landing-page' is now an overlay (activeShellView), not a template to restore.
    // Only restore explicitly non-default templates (e.g. a custom template the user was editing).
    if (bootId && bootId !== 'default' && bootId !== 'landing-page' && bootId !== currentTemplate.id) {
      const persisted = allTemplates().find((t) => t.id === bootId) || shellTemplates.find((t) => t.id === bootId);
      if (persisted) {
        commitTemplate(persisted);
        initialRestoreDone = true;
      }
    }
    initialRestoreDone = true;
  });

  /** Settles the template on screen's render record. Replaced on every commit. */
  let settleRendering: () => void = () => {};

  /**
   * The only way a schema becomes the live template.
   *
   * `node.id` is what the renderer stamps as `data-we-node-id`, and it is the whole handle the
   * visual editor has: selection, the inspector, the role readout and every ancestry walk go through
   * `findNodeById`. A tree that skipped `ensureNodeIds` renders identically and cannot be clicked at
   * all — which does not read as a missing id, it reads as the visual editor being broken.
   *
   * There were six setters and three of them forgot. `saveTemplateAs` was the one that mattered:
   * it is how both "Start fresh" and "Fork" arrive, and `starterTemplate` is hand-written with no
   * ids, so a brand-new template was inert to the first click anybody gave it. `removeTemplate`
   * dropped to a raw `emptyTemplate` the same way.
   *
   * So there is one committer and `setCurrentTemplate` is not called anywhere else. Ensuring at the
   * point of commit rather than at each call site is what makes "did this path remember?" a question
   * with one answer instead of six.
   *
   * The same argument puts safe mode here: being the one door, this is the only place that has to
   * know a chosen template is not to be drawn. In safe mode a template that is not WE's own is
   * committed as the bundled one in its place, however it arrived — a boot restore, a space's
   * default, a link's `?template=`, a switch.
   */
  function commitTemplate(schema: TemplateSchema | SchemaNode) {
    const chosen = safe.on ? bundledInPlaceOf(schema as TemplateSchema) : (schema as TemplateSchema);
    // Recorded before it renders, so a render that hangs the page leaves the record behind; the one
    // it replaces is settled, since replacing it took a live page. See `beginRender`.
    settleRendering();
    settleRendering = isBundled(chosen) ? () => {} : beginRender(chosen.id || '');
    const clone = deepClone(chosen) as SchemaNode;
    ensureNodeIds(clone);
    setCurrentTemplate(reconcile(clone as TemplateSchema));
  }

  /**
   * One of WE's own templates — bundled with the app, so not something safe mode protects anybody
   * from. By identity with the bundled copy's id and not from a space: a space can carry a template
   * under a built-in's id, and that copy is the space's.
   */
  function isBundled(schema: TemplateSchema): boolean {
    if (schema._fromSpace) return false;
    return builtInTemplates.some((t) => t.id === schema.id) || shellTemplates.some((t) => t.id === schema.id);
  }

  /**
   * What safe mode draws in place of a template: the bundled copy under the same id when there is
   * one — so the switcher and the settings pages keep working — and otherwise WE's default.
   */
  function bundledInPlaceOf(schema: TemplateSchema): TemplateSchema {
    if (!schema._fromSpace) {
      const same = builtInTemplates.find((t) => t.id === schema.id) ?? shellTemplates.find((t) => t.id === schema.id);
      if (same) return same;
    }
    return builtInTemplates.find((t) => t.id === 'default') ?? builtInTemplates[0] ?? emptyTemplate;
  }

  // Actions
  function updateTemplate(newTemplate: TemplateSchema) {
    const clone = deepClone(newTemplate) as SchemaNode;
    // Against the template it replaces, so a node pasted with an id already in use is the one renewed.
    ensureNodeIds(clone, undefined, currentTemplate as SchemaNode);
    const result = updateSchema(currentTemplate, clone as TemplateSchema, setCurrentTemplate);
    if (!result.applied && result.errors?.length) {
      toastService.error(`Schema validation failed: ${result.errors[0].message}`);
    }
  }

  /** Replace the current template wholesale using reconcile (bypasses findMutations).
   *  Preferred for AI updates where large structural changes (new routes, etc.) need
   *  reliable reactivity. Caller is responsible for pre-validating the schema. */
  function replaceTemplate(newTemplate: TemplateSchema) {
    commitTemplate(newTemplate);
  }

  // Per-template last-view memory — remembers which view segment (e.g. 'globe', 'chat')
  // was active for each template. Intentionally stores only the view, not the space ID,
  // so that template switching and space selection remain independent.
  const lastViewByTemplate = new Map<string, string>();

  function switchTemplate(newTemplateId: string) {
    const isSpace = newTemplateId.startsWith(SPACE_PREFIX);
    const realId = isSpace ? newTemplateId.slice(SPACE_PREFIX.length) : newTemplateId;
    // No-op if already on this template from the same source
    if (currentTemplate.id === realId && !!currentTemplate._fromSpace === isSpace) return;
    // If user manually switches before the boot restore fires, skip the restore
    initialRestoreDone = true;
    // Save current view segment before leaving (not the full path — space stays independent)
    if (currentTemplate.id) {
      const segs = routeStore.segments();
      const view = segs[0] === 'space' && segs[2] ? segs[2] : null;
      if (view) lastViewByTemplate.set(currentTemplate.id, view);
    }
    const newTemplate = isSpace
      ? allTemplates().find((t) => t.id === realId && t._fromSpace)
      : allTemplates().find((t) => t.id === realId && !t._fromSpace) || shellTemplates.find((t) => t.id === realId);
    if (newTemplate) {
      commitTemplate(newTemplate);
      /*
        Every template lives under the space prefix now, so there is one shape here rather than two.

        What still differs is what comes *after* it. A template hosting the space's sections lands
        on one, and carrying the current section across is what `lastViewByTemplate` is for. A
        self-routing template's screens are its own, so it lands on the space itself and its own
        index decides — Workshop's is a `redirect`, precisely so nothing out here has to know its
        first screen is the board.
      */
      const p = datasetStore.currentDataset();
      if (!p) {
        routeStore.navigate('/');
        datasetStore.updateAgentSettings({ currentTemplateId: realId });
        return;
      }
      const base = `/space/${canonicalSpaceId(p)}`;
      if (!hasViewsMarker(newTemplate.routes as RouteSchema[] | undefined)) {
        routeStore.navigate(base);
      } else {
        const segs = routeStore.segments();
        const currentView = segs[0] === 'space' && segs[2] ? segs[2] : 'globe';
        routeStore.navigate(`${base}/${lastViewByTemplate.get(realId) ?? currentView}`);
      }
      datasetStore.updateAgentSettings({ currentTemplateId: realId });
    } else {
      console.error(`TemplateStore: switchTemplate - Invalid templateId "${newTemplateId}"`);
    }
  }

  async function removeTemplate() {
    const templateId = currentTemplate.id;

    // If it's a saved (AD4M) template, delete from AD4M
    if (templateId && savedTemplateMap.has(templateId)) {
      const template = savedTemplateMap.get(templateId)!;
      savedTemplateMap.delete(templateId);
      setAllTemplates(allTemplates().filter((t) => t.id !== templateId));
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.delete(templateId);
        return next;
      });
      // Unlink from AgentSettings and delete template
      const prefs = datasetStore.agentSettings();
      if (prefs) await prefs.removeHiddenTemplates(template).catch(() => {});
      template.delete?.().catch((err: unknown) => console.error('TemplateStore: delete error', err));
    }

    commitTemplate(emptyTemplate);
  }

  /** Delete a template by ID (does not need to be the current template) */
  async function deleteTemplate(templateId: string): Promise<void> {
    if (!templateId || !savedTemplateMap.has(templateId)) return;

    setOperationLoading(`delete:${templateId}`);
    const template = savedTemplateMap.get(templateId)!;

    // Delete from AD4M first, before updating local state
    try {
      const prefs = datasetStore.agentSettings();
      if (prefs) await prefs.removeHiddenTemplates(template).catch(() => {});
      await template.delete();
    } catch (err) {
      console.error('TemplateStore: deleteTemplate AD4M error', err);
      toastService.error('Failed to delete template');
      setOperationLoading(null);
      return;
    }

    // Only update local state after successful AD4M deletion
    savedTemplateMap.delete(templateId);
    setAllTemplates(allTemplates().filter((t) => t.id !== templateId));
    setInstalledIds((prev) => {
      const next = new Set(prev);
      next.delete(templateId);
      return next;
    });

    // An app of the agent's own is deleted from the same library. If it was the app they are in, they
    // are back in WE's: the chrome already falls back once the record is gone, and the choice is put
    // back with it, so nothing goes on naming an app that no longer exists.
    if (datasetStore.agentSettings()?.appTemplateId === templateId) await setAppTemplate(DEFAULT_APP_ID);

    // If we deleted the current template, switch to the default
    if (currentTemplate.id === templateId) {
      const fallback = allTemplates().find((t) => t.id === 'default') || allTemplates()[0] || emptyTemplate;
      commitTemplate(fallback);
    }
    setOperationLoading(null);
  }

  /**
   * Delete a library template that could not be loaded. By record id, since a refused template was
   * never given a library id; see {@link RefusedTemplate}.
   */
  async function deleteRefusedTemplate(recordId: string): Promise<void> {
    const template = refusedRecords.get(recordId);
    if (!template) return;
    setOperationLoading(`delete:${recordId}`);
    try {
      const prefs = datasetStore.agentSettings();
      if (prefs) await prefs.removeHiddenTemplates(template).catch(() => {});
      await template.delete();
      refusedRecords.delete(recordId);
      setRefusedTemplates((rows) => rows.filter((row) => row.id !== recordId));
    } catch (err) {
      console.error('TemplateStore: deleteRefusedTemplate AD4M error', err);
      toastService.error('Failed to delete template');
    } finally {
      setOperationLoading(null);
    }
  }

  /** Add a template to the installed set (appears in sidebar) */
  async function installTemplate(templateId: string): Promise<void> {
    if (!savedTemplateMap.has(templateId)) return;
    const template = savedTemplateMap.get(templateId)!;

    setOperationLoading(`install:${templateId}`);
    try {
      const prefs = datasetStore.agentSettings();
      // `.catch(() => {})` swallowed the only write this function makes, so the sidebar gained a
      // template that the next boot would not have — the state moved and the record did not.
      if (prefs) await prefs.removeHiddenTemplates(template);
      hiddenHere.set(template.id, false);

      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.add(templateId);
        return next;
      });
    } catch (error) {
      console.error('TemplateStore: installTemplate error', error);
      toastService.error('Could not install this template.');
      throw error;
    } finally {
      setOperationLoading(null);
    }
  }

  /** Remove a template from the installed set (hidden from sidebar, not deleted) */
  async function uninstallTemplate(templateId: string): Promise<void> {
    if (!savedTemplateMap.has(templateId)) return;
    const template = savedTemplateMap.get(templateId)!;

    setOperationLoading(`uninstall:${templateId}`);
    try {
      const prefs = datasetStore.agentSettings();
      if (prefs) await prefs.addHiddenTemplates(template);
      hiddenHere.set(template.id, true);

      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.delete(templateId);
        return next;
      });
    } catch (error) {
      console.error('TemplateStore: uninstallTemplate error', error);
      toastService.error('Could not uninstall this template.');
      throw error;
    } finally {
      setOperationLoading(null);
    }
  }

  /** Write an already-inspected marketplace template into the agent's own library. */
  async function writeLibraryTemplates(templates: TemplateSchema[], origin: string): Promise<void> {
    const rootPerspective = datasetStore.rootDataset()?.handle;
    if (!rootPerspective) throw new Error('Your library is not available yet');
    for (const template of templates) {
      const id = template.id;
      if (!id) continue;
      const schema = asFileField(encodeTemplateFile(template));
      const existing = savedTemplateMap.get(id);
      if (existing) {
        existing.schema = schema;
        existing.name = template.meta.name;
        existing.version = (existing.version || 1) + 1;
        noteOwnWrite(existing);
        await existing.save();
        continue;
      }
      const record = await createLibraryTemplate(rootPerspective, {
        name: template.meta.name,
        description: template.meta.description,
        icon: template.meta.icon,
        origin,
        slug: id,
        version: 1,
        schema,
        role: roleOf(template),
      });
      savedTemplateMap.set(id, record);
    }
    setInstalledIds((prev) => new Set([...prev, ...templates.map((t) => t.id ?? '').filter(Boolean)]));
    await loadSavedTemplates();
  }

  async function writeSpaceTemplates(templates: TemplateSchema[], origin: string, datasetId?: string): Promise<void> {
    const current = datasetStore.currentDataset();
    const dataset = datasetId ? datasetStore.datasets().find((d) => d.id === datasetId) : current;
    if (!dataset) throw new Error(datasetId ? 'That space is not joined here' : 'There is no space open');
    const onScreen = dataset.id === current?.id;
    // A space not on screen has nothing in the map, so its own records are read to update in place.
    const records = onScreen
      ? spaceTemplateMap
      : new Map((await Template.findAll(dataset.handle)).map((record) => [record.slug, record] as const));
    for (const template of templates) {
      const id = template.id;
      if (!id) continue;
      // The space's copy carries nothing of where it was read from but the bundle it came in.
      const { _fromSpace: _ignored, ...clean } = template;
      const schema = asFileField(encodeTemplateFile(clean as TemplateSchema));
      const existing = records.get(id);
      if (existing) {
        existing.schema = schema;
        existing.name = template.meta.name;
        existing.version = (existing.version || 1) + 1;
        noteOwnWrite(existing);
        await existing.save();
        continue;
      }
      noteOwnWrite(
        await Template.create(dataset.handle, {
          name: template.meta.name,
          description: template.meta.description,
          icon: template.meta.icon,
          origin,
          slug: id,
          version: 1,
          schema,
          role: roleOf(template),
        }),
      );
    }
    // The next visit to another space reads it afresh rather than from what was cached before.
    spaceTemplateCache.delete(dataset.id);
    if (onScreen) await loadSpaceTemplates(dataset);
  }

  async function performPersonalInstall(request: PendingInstall): Promise<void> {
    const rootPerspective = datasetStore.rootDataset()?.handle;
    if (!rootPerspective) {
      toastService.error('Cannot install: marketplace not connected');
      return;
    }

    const marketplaceTemplateId = request.marketplaceId;
    setOperationLoading(`marketplace-install:${marketplaceTemplateId}`);
    try {
      const schema = request.schema;
      const templateId = reserveTemplateId(
        schema.id || request.name.toLowerCase().replace(/\s+/g, '-') || marketplaceTemplateId,
      );
      const newVersion = request.version;
      const schemaToInstall: TemplateSchema = { ...deepClone(schema), id: templateId, templateVersion: newVersion };

      const schemaBlob = encodeTemplateFile(schemaToInstall);

      const existingLocal = savedTemplateMap.get(templateId);
      if (existingLocal) {
        // Already installed — update schema and version in place
        existingLocal.schema = asFileField(schemaBlob);
        existingLocal.version = newVersion;
        noteOwnWrite(existingLocal);
        await existingLocal.save();
        toastService.success(`"${schemaToInstall.meta.name}" updated to v${newVersion}`);
      } else {
        const newTemplate = await createLibraryTemplate(rootPerspective, {
          name: schemaToInstall.meta.name,
          origin: 'marketplace',
          slug: templateId,
          version: newVersion,
          schema: asFileField(schemaBlob),
          role: roleOf(schemaToInstall),
        });
        savedTemplateMap.set(templateId, newTemplate);

        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
        toastService.success(`"${schemaToInstall.meta.name}" installed`);
      }

      await loadSavedTemplates();
    } catch (error) {
      toastService.error(explain(error, 'Could not install that template'));
    } finally {
      setOperationLoading(null);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Live template sync
  // ────────────────────────────────────────────────────────────────

  /*
    A template saved elsewhere reaches this agent as it is saved.

    Before this, a space's templates were read once, when the space opened, so an edit made by
    another member, on another of this agent's devices, or by an agent asked to edit it, reached
    nobody until they reloaded. Two watches now follow the templates: the open space's and this
    agent's own library (which also holds its app). Each reads only the cheap fields; a change is
    re-read through the same loaders a visit uses, so the trust gate and the id a template is known
    by are decided in one place.

    What a change to the template ON SCREEN does is decided by `remoteUpdateFor`: this agent's own
    change from elsewhere applies, a change to a template being edited here applies and says so, and
    somebody else's is offered rather than imposed — unless this agent follows others' changes.
  */
  const followTemplateUpdates = createMemo(() => datasetStore.agentSettings()?.followTemplateUpdates === true);

  async function setFollowTemplateUpdates(on: boolean) {
    await datasetStore.updateAgentSettings({ followTemplateUpdates: on });
  }

  /**
   * What the editor tells this store, injected the way `provideSpaceLookup` is, since the editor is
   * built on this store and not the other way round: whether a template is being edited here, and
   * what to do once a change saved elsewhere has been put into it.
   */
  let editing: { isEditing(template: TemplateSchema): boolean; replaced(template: TemplateSchema): void } = {
    isEditing: () => false,
    replaced: () => {},
  };
  function provideEditingProbe(probe: typeof editing): void {
    editing = probe;
  }

  /** Watch one dataset's templates, calling `onChange` with the records added, changed or removed. */
  function watchTemplates(handle: unknown, onChange: (records: string[]) => void): () => void {
    let stamps: Map<string, string> | undefined;
    let stopped = false;
    const take = (rows: { id: string; version?: unknown; updatedAt?: unknown }[]) => {
      if (stopped) return;
      const { next, changed, removed } = templateChanges(stamps, rows, ownSaves);
      stamps = next;
      if (changed.length || removed.length) onChange([...changed, ...removed]);
    };
    const watch = Template.query(handle, { properties: [...TEMPLATE_WATCH_FIELDS] });
    // A backend may or may not hand the first result to the callback as well; taking it twice is
    // harmless, since an unchanged push reports nothing.
    void watch
      .subscribe(take)
      .then(take)
      .catch((error: unknown) => console.warn('[TemplateStore] watching templates failed', error));
    return () => {
      stopped = true;
      watch.dispose();
    };
  }

  /**
   * One refresh at a time per scope, given every record that changed since the last one began. A
   * change arriving during a refresh is caught by the next, not dropped.
   */
  function serialised(run: (records: Set<string>) => Promise<void>): (records: string[]) => void {
    let running = false;
    let waiting = new Set<string>();
    const go = (records: string[]): void => {
      records.forEach((id) => waiting.add(id));
      if (running) return;
      running = true;
      const batch = waiting;
      waiting = new Set();
      void run(batch).finally(() => {
        running = false;
        if (waiting.size) go([]);
      });
    };
    return go;
  }

  const sameContent = (a: TemplateSchema, b: TemplateSchema) => {
    const bare = (t: TemplateSchema) => {
      const {
        templateVersion: _v,
        author: _a,
        _fromSpace: _s,
        ...rest
      } = deepClone(t) as TemplateSchema & {
        author?: string;
      };
      return JSON.stringify(rest);
    };
    return bare(a) === bare(b);
  };

  /** The notice offering a change somebody else made, while it is up. One at a time. */
  let offered: string | null = null;

  /** After a scope was read again: decide what a change to the template on screen does. */
  function followChange(fromSpace: boolean, records: Set<string>): void {
    if (safe.on) return; // safe mode draws WE's own templates, whatever the chosen ones say
    const current = currentTemplate;
    if (!!current._fromSpace !== fromSpace) return;
    /*
      Only when its own record is among those that changed. Comparing content alone is not enough:
      a template stored before node ids were permanent is given them as it goes on screen and not in
      storage, so it never compares equal — and a change to another template would offer this one.
    */
    const record = current.id ? (fromSpace ? spaceTemplateMap : savedTemplateMap).get(current.id) : undefined;
    if (!record || !records.has(record.id)) return;
    const fresh = allTemplates().find((t) => t.id === current.id && !!t._fromSpace === fromSpace);
    if (!fresh || sameContent(fresh, current)) return;

    const decision = remoteUpdateFor({
      author: (fresh as { author?: string }).author,
      me: session.me()?.did,
      editing: editing.isEditing(current),
      followOthers: followTemplateUpdates(),
    });
    if (offered) toastService.remove(offered);
    offered = null;

    if (decision === 'offer') {
      offered = toastService.info('This template was updated by someone in this space.', 0, {
        label: 'Update now',
        run: () => {
          offered = null;
          const latest = allTemplates().find((t) => t.id === current.id && !!t._fromSpace === fromSpace);
          if (latest && currentTemplate.id === latest.id) updateTemplate(latest);
        },
      });
      return;
    }
    // Diffed in, not replaced: what did not change keeps its components and everything they hold.
    updateTemplate(fresh);
    if (decision === 'apply-editing') {
      editing.replaced(fresh);
      const mine = (fresh as { author?: string }).author === session.me()?.did;
      toastService.info(
        mine
          ? 'You changed this template on another device, and that change is now here too. Undo starts again from this point.'
          : 'Someone else changed this template while you were editing it, and their change is now here too. Undo starts again from this point.',
        8000,
      );
    }
  }

  const syncLibrary = serialised(async (records) => {
    // Which library templates are installed lives in the agent's settings, read once at boot.
    await datasetStore.refreshAgentSettings();
    await loadSavedTemplates();
    followChange(false, records);
  });

  createEffect(() => {
    const root = datasetStore.rootDataset();
    if (!root) return;
    onCleanup(watchTemplates(root.handle, syncLibrary));
  });

  createEffect(() => {
    const dataset = datasetStore.currentDataset();
    if (!dataset) return;
    const syncSpace = serialised(async (records) => {
      await refreshSpaceTemplatesInPlace(dataset);
      if (datasetStore.currentDataset()?.id === dataset.id) followChange(true, records);
    });
    onCleanup(watchTemplates(dataset.handle, syncSpace));
  });

  /** Re-fetch space templates for the current perspective — call after any mutation (delete, install) */
  async function refreshSpaceTemplates(): Promise<void> {
    const perspective = datasetStore.currentDataset();
    if (!perspective) return;
    await loadSpaceTemplates(perspective);
  }

  /** Write an already-inspected marketplace template into the current space, for every member. */
  async function performSpaceInstall(request: PendingInstall): Promise<void> {
    const spaceDs = datasetStore.currentDataset();
    const spacePerspective = spaceDs?.handle;
    if (!spacePerspective) {
      toastService.error('Cannot install: no active space or marketplace not connected');
      return;
    }

    const marketplaceTemplateId = request.marketplaceId;
    setOperationLoading(`space-install:${marketplaceTemplateId}`);
    try {
      const schema = request.schema;
      const templateId = reserveTemplateId(
        schema.id || request.name.toLowerCase().replace(/\s+/g, '-') || marketplaceTemplateId,
      );
      const schemaToInstall: TemplateSchema = { ...deepClone(schema), id: templateId };

      const schemaBlob = encodeTemplateFile(schemaToInstall);

      noteOwnWrite(
        await Template.create(spacePerspective, {
          name: schemaToInstall.meta.name,
          origin: 'marketplace',
          slug: templateId,
          version: request.version,
          schema: asFileField(schemaBlob),
          role: roleOf(schemaToInstall),
        }),
      );

      await loadSpaceTemplates(spaceDs!);
      toastService.success(`"${schemaToInstall.meta.name}" installed to space`);
    } catch (error) {
      toastService.error(explain(error, 'Could not install that template into this space'));
    } finally {
      setOperationLoading(null);
    }
  }

  /**
   * Fetch a marketplace template, judge it, and raise the install dialog.
   *
   * ## Why installing asks first
   *
   * `templateSurface.ts` grants capabilities in groups deliberately worded for a person — "Read and
   * write the content of this space", "Change the name, look and defaults of THIS space" — with a
   * comment saying they are what a marketplace listing will show a human at install time.
   * `inspectTemplateSurface` has computed exactly that list since it was written. Nothing showed it:
   * the only production caller took `blocked` and dropped `groups`, and the install button wrote a
   * stranger's template into your library on one unqualified click.
   *
   * So the capability list is now what stands between the click and the write. It is not a
   * permission prompt in the OS sense — the tier is what actually bounds the template, and the
   * answer to this dialog cannot widen it — it is disclosure: this is what the thing you are about
   * to install will be able to do, before it can do any of it.
   *
   * The fetch and the judgement happen before the dialog rather than after the confirmation, so
   * what the dialog shows is the template that will actually be written, not a promise about one.
   */
  async function requestInstall(marketplaceTemplateId: string, destination: 'personal' | 'space'): Promise<void> {
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
    if (!marketplacePerspective) {
      toastService.error('Cannot install: marketplace not connected');
      return;
    }
    if (destination === 'space' && !datasetStore.currentDataset()?.handle) {
      toastService.error('Cannot install: no active space');
      return;
    }

    setOperationLoading(`${destination === 'space' ? 'space' : 'marketplace'}-install:${marketplaceTemplateId}`);
    try {
      const marketplaceTemplate = await Template.findOne(marketplacePerspective, {
        where: { id: marketplaceTemplateId },
      });
      if (!marketplaceTemplate) {
        toastService.error('Template not found in marketplace');
        return;
      }

      const raw = decodeTemplateFile<TemplateSchema>(marketplaceTemplate.schema);
      if (!raw) {
        toastService.error('Could not read template data');
        return;
      }

      // A deliberate install, so a refusal is worth a toast rather than a console line — the user
      // pressed a button and is owed an answer. Space tier: a marketplace template is a stranger's,
      // whatever it says about itself, and the tier is what makes it safe to press the button.
      const accepted = acceptTemplate(raw, { origin: 'the marketplace', grants: SPACE_TIER });
      if (!accepted.schema) {
        console.warn(describeAcceptance(accepted, 'the marketplace').join('\n'));
        toastService.error('That template is not a valid schema and was not installed');
        return;
      }

      setPendingInstall({
        marketplaceId: marketplaceTemplateId,
        destination,
        schema: accepted.schema,
        name: marketplaceTemplate.name || accepted.schema.meta.name || 'This template',
        icon: accepted.schema.meta.icon || '',
        version: marketplaceTemplate.version || 1,
        capabilities: describeCapabilities(accepted.groups),
        // Named rather than counted: "one reference is not allowed here" says nothing about which
        // part of the template will be inert, and the path is the only thing that does.
        blocked: [
          ...new Set(accepted.blocked.map((reference) => reference.path)),
          // And any element it may not mount — a `script`, an `iframe` — which will render nothing.
          ...accepted.refusedElements.map((tag) => `<${tag}>`),
        ],
      });
    } catch (error) {
      toastService.error(explain(error, 'Could not read that template'));
    } finally {
      setOperationLoading(null);
    }
  }

  /** Install what the dialog is showing. */
  async function confirmInstall(): Promise<void> {
    const request = pendingInstall();
    if (!request) return;
    setPendingInstall(null);
    if (request.blocked.length) {
      toastService.warning('Installed, but parts of this template are not allowed to run here');
    }
    await (request.destination === 'space' ? performSpaceInstall(request) : performPersonalInstall(request));
  }

  /** Close the dialog without installing. */
  function cancelInstall(): void {
    setPendingInstall(null);
  }

  /**
   * Copy a marketplace template into your own library — asking first. See {@link requestInstall}.
   *
   * The name and the signature are unchanged, because what a template writes in its schema should
   * not have to know that a dialog appeared between the click and the write.
   */
  function installFromMarketplace(marketplaceTemplateId: string): Promise<void> {
    return requestInstall(marketplaceTemplateId, 'personal');
  }

  /** The same, into the space on screen, so every member of that community gets it. */
  function installToSpace(marketplaceTemplateId: string): Promise<void> {
    return requestInstall(marketplaceTemplateId, 'space');
  }

  /** Set a template as the default (loaded on boot) */
  function setDefaultTemplate(templateId: string): Promise<boolean> {
    return datasetStore.updateAgentSettings({ defaultTemplateId: templateId });
  }

  async function saveTemplate(name: string): Promise<void> {
    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) {
      console.error('TemplateStore: No root perspective available');
      return;
    }

    const templateId = reserveTemplateId(name.toLowerCase().replace(/\s+/g, '-'));
    const schemaToSave: TemplateSchema = {
      ...deepClone(currentTemplate),
      id: templateId,
      author: session.me()?.did,
      meta: { ...currentTemplate.meta, name },
    };

    const schemaBlob = encodeTemplateFile(schemaToSave);

    try {
      const existingTemplate = savedTemplateMap.get(templateId);
      if (existingTemplate) {
        existingTemplate.schema = asFileField(schemaBlob);
        existingTemplate.name = name;
        existingTemplate.version = (existingTemplate.version || 1) + 1;
        noteOwnWrite(existingTemplate);
        await existingTemplate.save();
      } else {
        const newTemplate = await createLibraryTemplate(perspective, {
          name,
          origin: 'custom',
          slug: templateId,
          version: 1,
          schema: asFileField(schemaBlob),
          role: roleOf(schemaToSave),
        });
        savedTemplateMap.set(templateId, newTemplate);

        // Immediately mark as installed so it shows in sidebar
        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
      }

      // Refresh templates list from AD4M
      await loadSavedTemplates();
    } catch (error) {
      console.error('TemplateStore: saveTemplate error', error);
    }
  }

  /**
   * Save a provided schema as a new (or updated) template, refresh the
   * templates list, and switch to it. Returns true on success.
   * Pass destination='space' to save into the current space perspective instead of we-root.
   */
  async function saveTemplateAs(
    schema: TemplateSchema,
    destination: 'root' | 'space' = 'root',
    options: { activate?: boolean; rename?: boolean } = {},
  ): Promise<boolean> {
    const isSpace = destination === 'space';
    const targetDs = isSpace ? datasetStore.currentDataset() : datasetStore.rootDataset();
    const perspective = targetDs?.handle;
    if (!perspective) {
      toastService.error(`Cannot save template: no ${isSpace ? 'space' : 'root'} perspective available`);
      return false;
    }

    const requestedId = schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-');
    const templateId = reserveTemplateId(requestedId);
    /*
      Renamed exactly when the id had to be minted, and never otherwise.

      This is the fork path — "Fork as a new template" arrives here carrying the id and the name of
      whatever it was forking from — so a minted id means a second thing now exists beside a
      built-in, and two rows called "Workshop" are barely better than the one row that used to lie
      about which it was. An id that was already free is a save in place, where renaming somebody's
      template every time they pressed save would be its own bug.
    */
    const name =
      templateId === requestedId || options.rename === false ? schema.meta.name : `${schema.meta.name} (yours)`;
    setOperationLoading('save');
    /*
      With node ids, as everything committed has them: a template arriving here without them (a
      fresh start is hand-written) would otherwise be given them on screen and not in storage, and
      the two would never compare equal again — so the next change anybody made anywhere read as a
      change to this one.
    */
    const schemaToSave: TemplateSchema = {
      ...(ensureNodeIds(deepClone(schema) as SchemaNode) as TemplateSchema),
      id: templateId,
      author: session.me()?.did,
      meta: { ...schema.meta, name },
    };

    const schemaBlob = encodeTemplateFile(schemaToSave);

    try {
      const targetMap = isSpace ? spaceTemplateMap : savedTemplateMap;
      const existingTemplate = targetMap.get(templateId);
      if (existingTemplate) {
        existingTemplate.schema = asFileField(schemaBlob);
        existingTemplate.name = schemaToSave.meta.name;
        existingTemplate.version = (existingTemplate.version || 1) + 1;
        noteOwnWrite(existingTemplate);
        await existingTemplate.save();
      } else {
        const data = {
          name: schemaToSave.meta.name,
          origin: isSpace ? 'shared' : 'custom',
          slug: templateId,
          version: 1,
          schema: asFileField(schemaBlob),
          role: roleOf(schemaToSave),
        };
        // In the library, made and marked installed as one write, so it appears in the pickers.
        const newTemplate = isSpace
          ? await Template.create(perspective, data)
          : await createLibraryTemplate(perspective, data);
        if (isSpace) noteOwnWrite(newTemplate);
        targetMap.set(templateId, newTemplate);

        setInstalledIds((prev) => {
          const next = new Set(prev);
          next.add(templateId);
          return next;
        });
      }

      if (isSpace) {
        await loadSpaceTemplates(targetDs!);
      } else {
        await loadSavedTemplates();
      }

      // Ensure the just-saved template appears in allTemplates even if
      // AD4M's file storage hasn't resolved the schema blob yet
      setAllTemplates((prev) => {
        if (prev.some((t) => t.id === templateId)) return prev;
        const savedRecord = savedTemplateMap.get(templateId);
        return [...prev, { ...deepClone(schemaToSave), templateVersion: savedRecord?.version ?? 1 }];
      });
      setInstalledIds((prev) => {
        if (prev.has(templateId)) return prev;
        const next = new Set(prev);
        next.add(templateId);
        return next;
      });

      if (options.activate === false) {
        setOperationLoading(null);
        return true;
      }
      commitTemplate(schemaToSave);
      const p = datasetStore.currentDataset();
      if (p) {
        const spaceId = p.sharedId ?? p.id;
        const segs = routeStore.segments();
        const view = segs[0] === 'space' && segs[2] ? segs[2] : 'globe';
        routeStore.navigate('/space/' + spaceId + '/' + view);
      } else {
        routeStore.navigate('/');
      }
      datasetStore.updateAgentSettings({ currentTemplateId: templateId });
      setOperationLoading(null);
      return true;
    } catch (error) {
      toastService.error(explain(error, 'Could not save that template'));
      setOperationLoading(null);
      return false;
    }
  }

  /** Persist the current in-memory template state to AD4M (for saved templates only) */
  async function persistCurrentTemplate(): Promise<void> {
    return persistTemplate(currentTemplate);
  }

  /**
   * Save a template's working copy to its own record — the agent's library or the space it lives in.
   *
   * Takes the template rather than reading `currentTemplate`, because the template being edited is not
   * always the one on screen: a section is edited inside the shell that draws it, and the app around
   * both. Which record it is follows where the copy came from, `_fromSpace`, since an agent's template
   * and a space's may share an id.
   */
  async function persistTemplate(template: TemplateSchema): Promise<void> {
    const templateId = template.id;
    const fromSpace = !!template._fromSpace;
    const recordOf = (id: string) =>
      fromSpace
        ? (spaceTemplateMap.get(id) ?? savedTemplateMap.get(id))
        : (savedTemplateMap.get(id) ?? spaceTemplateMap.get(id));
    if (!templateId || !recordOf(templateId)) return;

    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return;

    const cloned = deepClone(template);
    delete cloned._fromSpace;
    const schemaToSave: TemplateSchema = { ...cloned, author: session.me()?.did };
    // Timestamped, so re-persisting a schema already saved (after an undo, say) is a new file
    // rather than one the content-addressed store refuses as a duplicate.
    const schemaBlob = encodeTemplateFile(schemaToSave, { savedAt: Date.now() });

    try {
      const existing = recordOf(templateId);
      if (!existing) return;
      existing.schema = asFileField(schemaBlob);
      existing.version = (existing.version || 1) + 1;
      /*
        Noted before the write, so the watch can tell this agent's own save coming back from somebody
        else's. And one transaction: the version and the content land together, so nobody watching
        sees the new version arrive with the old template behind it.
      */
      ownSaves.set(existing.id, String(existing.version));
      const dataset = (fromSpace ? datasetStore.currentDataset() : datasetStore.rootDataset())?.handle ?? perspective;
      await runEntityTransaction(dataset, (tx) => existing.save(tx.batchId));
    } catch (error) {
      // Content-addressed store returns "Key already exists" when the blob
      // is already stored — this is expected and the data is persisted.
      const msg = String(error);
      if (!msg.includes('Key already exists')) {
        console.error('[TemplateStore] persistCurrentTemplate failed', error);
        return; // Only bail on real errors
      }
    }

    // Update the in-memory templates signal so switching away and back preserves changes.
    // Use schemaToSave (captured before any await) — currentTemplate may have changed
    // if the user navigated to a different template while the save was in flight.
    // Preserve templateVersion from the existing entry — it's sourced from the model record
    // and may not be present on currentTemplate if the fallback path was taken.
    setAllTemplates((prev) =>
      prev.map((t) => {
        if (t.id !== templateId || !!t._fromSpace !== fromSpace) return t;
        const tv = t.templateVersion ?? recordOf(templateId)?.version ?? 1;
        // The origin is kept: dropping it is what let a space's copy and an agent's template with the
        // same id be confused on the next load.
        return { ...schemaToSave, ...(fromSpace ? { _fromSpace: true } : {}), templateVersion: tv };
      }),
    );
    // And the space's cached copy, or coming back to the space later restores what this replaced.
    const openSpace = fromSpace ? datasetStore.currentDataset() : null;
    const cached = openSpace && spaceTemplateCache.get(openSpace.id);
    if (cached) cached.schemas = allTemplates().filter((t) => t._fromSpace);
  }

  /** Copy the current template into a specific space perspective */
  async function publishToSpace(perspectiveUuid: string, spaceName: string): Promise<boolean> {
    const targetDs = datasetStore.datasets().find((d) => d.id === perspectiveUuid);
    if (!targetDs) {
      toastService.error('Space not found');
      return false;
    }
    const perspective = targetDs.handle;

    const schema = currentTemplate;
    const templateId = reserveTemplateId(schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-'));

    const existing = await Template.findOne(perspective, { where: { slug: templateId } });
    if (existing) {
      toastService.error(`Template "${schema.meta.name}" is already in "${spaceName}"`);
      return false;
    }

    setOperationLoading('publish-space');

    const schemaBlob = encodeTemplateFile({ ...deepClone(schema), id: templateId });

    try {
      await Template.create(perspective, {
        name: schema.meta.name,
        origin: 'shared',
        slug: templateId,
        version: 1,
        schema: asFileField(schemaBlob),
        role: roleOf(schema),
      });
      toastService.success(`Template "${schema.meta.name}" shared to space "${spaceName}"`);
      return true;
    } catch (error) {
      console.error('TemplateStore: publishToSpace error', error);
      toastService.error('Failed to share template to space');
      return false;
    } finally {
      setOperationLoading(null);
    }
  }

  /** Publish the current template to the marketplace perspective */
  async function deleteMarketplaceTemplate(templateId: string): Promise<void> {
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return;
    }
    setOperationLoading(`marketplace-delete:${templateId}`);
    try {
      const template = await Template.findOne(marketplacePerspective, { where: { id: templateId } });
      if (!template) {
        toastService.error('Template not found');
        return;
      }
      await template.delete();
    } catch (error) {
      console.error('TemplateStore: deleteMarketplaceTemplate error', error);
      toastService.error('Failed to delete template');
    } finally {
      setOperationLoading(null);
    }
  }

  async function publishToMarketplace(options: {
    name: string;
    description: string;
    icon?: string;
    themeId?: string;
    slug?: string;
    screenshots: File[];
  }): Promise<boolean> {
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return false;
    }

    const schema = currentTemplate;
    const localId = schema.id || schema.meta.name.toLowerCase().replace(/\s+/g, '-');
    const slug = (options.slug || localId).trim().toLowerCase().replace(/\s+/g, '-');

    const existing = await Template.findOne(marketplacePerspective, { where: { slug } });
    if (existing && existing.author !== session.me()?.did) {
      toastService.error(`A template with slug "${slug}" already exists in the marketplace by a different author`);
      return false;
    }

    setOperationLoading('publish-marketplace');

    const schemaBlob = encodeTemplateFile({ ...deepClone(schema), id: localId, author: session.me()?.did });

    const templateIcon = options.icon ?? schema.meta?.icon ?? '';

    try {
      /*
        The new pictures are uploaded *before* the old ones are let go.

        This cleared the relation first — `setScreenshots([])`, then one `addScreenshots` per file —
        so a compress or an upload that failed part way through landed in the catch below, reported
        "Failed to publish", and left the listing with no screenshots at all. The listing that was
        already there, working, was the thing destroyed by the attempt to update it.

        Building the blocks first and assigning the whole list at once makes the failure lose nothing:
        an upload that throws never reaches the assignment, and the existing screenshots are still
        attached. Relation assignment replaces the set, so the old ones go exactly when the new ones
        arrive rather than a round trip earlier.
      */
      const uploaded = await Promise.all(
        options.screenshots.map(async (file) =>
          ImageBlock.create(marketplacePerspective, {
            src: asFileField(await compressImageToFileData(file, `screenshot-${Date.now()}`)),
            altText: 'Screenshot',
            version: 1,
          }),
        ),
      );

      if (existing) {
        // Update existing marketplace entry in place — bump version, replace schema and screenshots
        existing.name = options.name;
        existing.description = options.description;
        existing.icon = templateIcon;
        existing.version = (existing.version || 1) + 1;
        existing.schema = asFileField(schemaBlob);
        if (options.themeId !== undefined) existing.themeId = options.themeId;
        await existing.save();

        // Only when there are new ones: publishing an update with no screenshots picked should keep
        // the ones the listing has rather than silently stripping them.
        if (uploaded.length) await existing.setScreenshots(uploaded);

        toastService.success(`Template "${options.name}" updated in marketplace (v${existing.version})`);
      } else {
        const template = await Template.create(marketplacePerspective, {
          name: options.name,
          description: options.description,
          icon: templateIcon,
          origin: 'marketplace',
          slug,
          version: 1,
          schema: asFileField(schemaBlob),
          ...(options.themeId ? { themeId: options.themeId } : {}),
        });

        if (uploaded.length) await template.setScreenshots(uploaded);

        toastService.success(`Template "${options.name}" published to marketplace`);
      }
      return true;
    } catch (error) {
      console.error('TemplateStore: publishToMarketplace error', error);
      toastService.error('Failed to publish template to marketplace');
      return false;
    } finally {
      setOperationLoading(null);
    }
  }

  function isBuiltInTemplateId(templateId: string): boolean {
    return builtInTemplates.some((t) => t.id === templateId);
  }

  /**
   * The id a stored record may have — never a built-in's. Every write of one goes through here.
   *
   * The built-in or a fork, and nothing between; `@shared/templateIdentity` is why.
   */
  function reserveTemplateId(requested: string): string {
    // Built-in sections too, not only built-in templates — see `reservedTemplateIds`.
    return reserveId(requested, reservedTemplateIds());
  }

  /**
   * Re-id a stored template that was saved over a built-in, once, on the way in.
   *
   * Records written before ids were reserved are still out there, and each one is hiding a built-in.
   * Renamed rather than refused: what is in there is somebody's work — usually a panel arrangement
   * they pressed "Fork as a new template" to keep — and deleting it to restore the built-in would
   * answer one silent loss with another. It becomes the fork it should always have been, and the
   * built-in comes back beside it.
   *
   * Best effort. If the write fails the record is still used under its new id for the rest of the
   * session, so the built-in is un-shadowed either way and the rename is retried next load.
   */
  async function adoptStoredId(record: Template, schema: TemplateSchema, requested: string): Promise<string> {
    const reserved = reserveTemplateId(requested);
    if (reserved === requested) return requested;

    const name = schema.meta?.name ? `${schema.meta.name} (yours)` : reserved;
    schema.id = reserved;
    if (schema.meta) schema.meta.name = name;

    try {
      record.slug = reserved;
      record.name = name;
      record.schema = asFileField(encodeTemplateFile(schema));
      await record.save();
    } catch (error) {
      console.error('TemplateStore: could not re-id a template saved over a built-in', requested, error);
    }
    return reserved;
  }

  /** Check if a custom template is installed (visible in sidebar) */
  function isInstalled(templateId: string): boolean {
    return installedIds().has(templateId);
  }

  /** Get the AD4M Template model instance by slug ID — to address and save, not to read relations off. */
  function getTemplateRecord(templateId: string): NewRecord<Template> | undefined {
    return savedTemplateMap.get(templateId) ?? spaceTemplateMap.get(templateId);
  }

  /** Toggle a custom template's installed state */
  async function toggleInstalled(templateId: string): Promise<void> {
    if (isBuiltInTemplateId(templateId)) return;
    if (isInstalled(templateId)) {
      await uninstallTemplate(templateId);
    } else {
      await installTemplate(templateId);
    }
  }

  /** Pre-computed list for Settings UI with status flags — excludes space templates */
  const templateManagementList = () => {
    const defaultId = defaultTemplateId();
    const installed = installedIds();
    return spaceChoosable()
      .filter((t) => !t._fromSpace)
      .map((t) => ({
        id: t.id || '',
        name: t.meta?.name || '',
        icon: t.meta?.icon || '',
        description: t.meta?.description || '',
        isBuiltIn: isBuiltInTemplateId(t.id || ''),
        isInstalled: isBuiltInTemplateId(t.id || '') || installed.has(t.id || ''),
        isDefault: (t.id || '') === defaultId,
        // The app it came with, when it came with one: removed with that app, never on its own.
        fromApp: t.source ? (appNames().get(t.source.bundle) ?? t.source.bundle) : '',
      }));
  };

  /** Installed and built-in apps' names by bundle id, for saying where a template came from. */
  const appNames = createMemo(
    () =>
      new Map<string, string>([
        ...seedBundlePieces.map((pieces) => [pieces.bundleId, pieces.name] as [string, string]),
        ...readInstalledBundles(datasetStore.agentSettings()?.installedBundles).map(
          (entry) => [entry.id, entry.name] as [string, string],
        ),
      ]),
  );

  const store: TemplateStore = {
    provideSpaceLookup,
    // State
    personalTemplates,
    spaceTemplates,
    builtInTemplates: builtInTemplatesAccessor,
    myTemplates,
    allTemplates,
    templateManagementList,
    refusedTemplates,
    switcherGroups,
    currentSwitcherId,
    currentTemplate,
    loading,
    defaultTemplateId,

    // Actions
    updateTemplate,
    replaceTemplate,
    switchTemplate,
    removeTemplate,
    deleteTemplate,
    writeLibraryTemplates,
    writeSpaceTemplates,
    deleteRefusedTemplate,
    installTemplate,
    uninstallTemplate,
    installFromMarketplace,
    pendingInstall,
    confirmInstall,
    cancelInstall,
    deleteMarketplaceTemplate,
    installToSpace,
    refreshSpaceTemplates,
    toggleInstalled,
    setDefaultTemplate,
    saveTemplate,
    saveTemplateAs,
    publishToSpace,
    publishToMarketplace,
    persistCurrentTemplate,
    persistTemplate,
    followTemplateUpdates,
    setFollowTemplateUpdates,
    provideEditingProbe,
    appTemplate,
    appTemplateId,
    appTemplateOptions,
    setAppTemplate,
    brand,
    bundlePage,
    openDraft,
    updateDraft,
    closeDraft,
    draftOf,
    preloadSpaceTemplates,
    loadSpaceTemplates,
    clearSpaceTemplates,
    spaceTemplatePending,
    awaitingSpaceRecord: spaceRecord.waiting,
    safeMode: () => safe,
    leaveSafeMode,
    leaveSafeModeInto,

    // Loading state
    operationLoading,

    // Queries
    isBuiltInTemplateId,
    isInstalled,
    getTemplateRecord,
  };

  return <TemplateContext.Provider value={store}>{props.children}</TemplateContext.Provider>;
}

export function useTemplateStore(): TemplateStore {
  const ctx = useContext(TemplateContext);
  if (!ctx) throw new Error('useTemplateStore must be used within TemplateStoreProvider');
  return ctx;
}

export default TemplateStoreProvider;
