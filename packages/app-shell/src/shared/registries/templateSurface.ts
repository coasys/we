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
import { isExpressionToken, markReactive, parseExpression, referencedPaths } from '@we/schema-shared';

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
  'space-settings': 'Change the name, look and defaults of THIS space',
  appearance: 'Choose which template and theme you are looking at',
  'space-admin': 'Change settings in spaces other than this one',
  library: 'Install, publish and remove templates and themes on your account',
  agent: 'Change your own profile, settings and preferences',
  session: 'Sign in and out, and manage local accounts',
  'runtime-admin': 'Administer the backend — trust, network, AI models, the database',
  editor: 'Drive the template and theme editing surface',
  'host-layout': "Move and resize the app's own panels and docks",
} as const;

export type CapabilityGroup = keyof typeof CAPABILITY_GROUPS;

/**
 * What an ordinary space template gets: everything needed to render a community and take part in
 * it, and nothing that changes the app, the account or the machine.
 *
 * `space-settings` and `appearance` are here because of what WE claims to be. A community's
 * template offering "rename this space", "give it an avatar", "here are the templates and themes
 * this space has, pick one" is not a privilege escalation — it is the product. Drawing the line
 * beneath those would mean a community can shape everything about its space except how the space
 * is configured, which would have to be done from host chrome that looks nothing like the rest of
 * it. WE's own default template is the proof: it lands entirely inside this tier, and it has a
 * complete settings surface.
 *
 * What keeps them safe is scope rather than exclusion. `space-settings` actions are pinned to the
 * space on screen (see `arity` below), so a template cannot reconfigure a space you are not in;
 * `appearance` changes which template and theme *you* are looking at, from what you already have,
 * and cannot install, publish or delete anything. Those remain `space-admin` and `library`, at the
 * chrome tier.
 */
export const SPACE_TIER: readonly CapabilityGroup[] = [
  'content',
  'navigation',
  'view-state',
  'signals',
  'presence',
  'identity',
  'space-settings',
  'appearance',
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
  'host-layout',
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
  /** `state` is read in expressions and tagged reactive; `action` is called through `$action`. */
  kind: 'state' | 'action';
  /**
   * Irreversible, or expensive to reverse. Not a grant of its own — a flag the host reads to decide
   * whether to demand confirmation it owns.
   */
  destructive?: true;
  /**
   * Arguments this action may be given; anything beyond is dropped.
   *
   * There is one thing this is for. Every space-configuring action takes the space as a trailing
   * optional argument — `updateSpaceMeta(updates, spaceUuid?)`,
   * `setSpaceDefaultTemplate(templateId, spaceUuid?)`, `setModuleEnabled(id, enabled, spaceUuid?)` —
   * omitted meaning "the space on screen". That default is exactly right for a template and the
   * argument is exactly wrong: it is the difference between "this community's template configures
   * this community" and "any space you visit can rename every other space you are in".
   *
   * Truncating is better than validating the uuid, because there is nothing to validate against
   * that a template could not also read. Removing the ability to name a space at all leaves only
   * the default, which is the sentence the tier is trying to be.
   *
   * Lifted by the `space-admin` grant, which is that same sentence negated — "change settings in
   * spaces other than this one" — and which only the chrome tier holds. Settings' per-space page
   * exists to configure a space you are *not* standing in, and reaches every one of these actions
   * with the uuid of the row that was clicked; truncated there, each control silently wrote to
   * whichever space was on screen instead. A grant that names the capability and a mechanism that
   * refuses it regardless is not two safeguards, it is one of them being wrong.
   */
  arity?: number;
}

type Classification = MemberSpec | typeof WIRING;

const state = (group: CapabilityGroup): MemberSpec => ({ group, kind: 'state' });
const action = (group: CapabilityGroup): MemberSpec => ({ group, kind: 'action' });
const destructive = (group: CapabilityGroup): MemberSpec => ({ group, kind: 'action', destructive: true });
/**
 * An action pinned to the space on screen: its trailing `spaceUuid` argument is unreachable, unless
 * the bag holds `space-admin` — see {@link MemberSpec.arity}.
 */
const hereOnly = (group: CapabilityGroup, arity: number): MemberSpec => ({ group, kind: 'action', arity });

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
    isGuest: state('session'),
    isDevelopment: state('session'),
    devTools: state('session'),
    setDevTools: action('session'),
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
    aiFormDirty: state('runtime-admin'),
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
    currentDatasetEntities: state('content'),
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
      `bgImage: { $: '`https://…?k=${datasetStore.agentSettings.claudeApiKey}`' }`
      — to exfiltrate it on paint. Any URL-valued prop is a network channel, so this is not fixable
      by watching for suspicious actions.

      The root handle goes with it, and not only for tidiness: it is what a `$query`'s `dataset`
      option resolves against, so leaving it reachable would let a template read the same settings
      the long way round. `agent`-tier surfaces that genuinely need a setting expose it as a named
      accessor rather than the whole record.
    */
    agentSettings: WIRING,
    /*
      The agent's own root dataset. Chrome tier, because settings genuinely needs it — the datasets
      list marks which row is your root by comparing ids — and a space's template has no reason to
      hold a handle to your private perspective.
    */
    rootDataset: state('agent'),
    testDataset: WIRING,
    /*
      The global discovery space and the marketplace — shared neighbourhoods holding nothing of this
      agent's, so nothing here needs the protection `agentSettings` has.

      They were `WIRING` alongside it, on the reasoning above, and that broke two pieces of chrome
      without anything noticing: the create-space modal reads `globalDataset` to decide whether to
      offer "list in the global space", and the marketplace shelf queries with
      `dataset: 'datasetStore.marketplaceDataset'`. Both resolved to nothing — the modal never
      offered the listing and the shelf's queries had no dataset to run against. The tier-fit test
      did not see it because it walked neither the slot nodes nor a query's `dataset` path; it walks
      both now.

      `navigation` because a template already reaches the same space as `globalSpaceId`; `library`
      because reading the marketplace's listing is the act the library group names.
    */
    globalDataset: state('navigation'),
    marketplaceDataset: state('library'),
    updateAgentSettings: WIRING,
    clearCurrentDataset: WIRING,
    trackDataset: WIRING,
    provideAutoInterpretGate: WIRING,
    provideExtractionCandidates: WIRING,
    provideCallExtraction: WIRING,
    onDatasetRemoved: WIRING,
    initSystemDatasets: WIRING,
    loadDatasets: WIRING,
    subscribeToChanges: WIRING,
    getDatasetOrder: WIRING,
  },

  profileStore: {
    profiles: state('identity'),
    ownProfile: state('identity'),
    ownProfileLoaded: state('identity'),
    fetchProfile: action('identity'),
    pendingAvatar: state('agent'),
    setPendingAvatar: action('agent'),
    // 'agent' rather than 'identity': needsName reports something about the viewer's own account
    // and its two actions write to it, which is the agent group's whole distinction from reading
    // the directory. A template that merely paints has no business asking whether you are unnamed.
    needsName: state('agent'),
    saveNameFromPrompt: action('agent'),
    dismissNamePrompt: action('agent'),
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
    unreadNodeIds: state('content'),
    myMentions: state('content'),
    uploadFile: action('content'),
    mutedDids: state('content'),
    mutedAgents: state('content'),
    setAgentMuted: action('content'),
    getSubgroupMessages: action('content'),
    exportCallTranscript: action('content'),

    // ── signals ──
    createSignalType: action('signals'),
    // The vocabulary of connections, alongside the vocabulary of reactions — same tier, same act:
    // a community naming what it means by something.
    createRelationshipType: action('signals'),
    upsertSignal: action('signals'),

    // ── navigation ──
    spaceList: state('navigation'),
    mySpaces: state('navigation'),
    personalSpaces: state('navigation'),
    sharedSpaces: state('navigation'),
    orderedSidebarItems: state('navigation'),
    routeSpaceUnjoined: state('navigation'),
    spacePath: state('navigation'),
    joiningSpace: state('navigation'),
    joinSlow: state('navigation'),
    joinError: state('navigation'),
    joinSpace: action('navigation'),
    navigateToSpace: action('navigation'),
    openRecordRef: action('navigation'),
    canAdministerSpace: action('navigation'),
    copyShareLink: action('navigation'),
    copyGuestLink: action('navigation'),
    activeModules: state('navigation'),
    moduleLaunchers: state('navigation'),
    launchModule: action('navigation'),
    /*
      The space's sections, and the nav projection over them — both `navigation`, which is the
      lowest tier any shell needs and deliberately so.

      A shell template's entire job includes drawing the nav strip, so refusing it here would mean
      no template could render its own sections without an elevated grant. There is nothing to
      protect: the list is what the space already shows every member, and `spaceViews` carries the
      view schemas the renderer is about to walk anyway.
    */
    spaceViews: state('navigation'),
    viewNav: state('navigation'),
    /*
      Every view that could render here, as opposed to the ones this space offers.

      Same tier: it is the host's route-building input rather than a secret, and a shell that wanted
      to draw "sections you could turn on" is asking a reasonable question about its own space.
    */
    routableViews: state('navigation'),
    /** The ids the community has here, which every section's own route body is gated on. */
    enabledViewIds: state('navigation'),
    requiredModules: state('navigation'),
    missingModules: state('navigation'),

    // ── space-admin ──
    spaceDefaultTemplateId: state('space-settings'),
    spaceDefaultThemeId: state('space-settings'),
    creatingSpace: state('space-admin'),
    foreignSpacePrefill: state('space-settings'),
    enabledModules: state('space-admin'),
    /*
      Reading it is `space-settings`, writing it is still admin-gated below.

      Not `space-admin` like `enabledModules` beside it, and the difference is the audience: a card
      showing "extracting automatically" is for every member, not only whoever may change it. The
      results are written into everyone's copy of the space, so whether it is on is not an
      administrator's secret — it is a fact about the space, like its name.

      Caught by `tierFit`, which refused the default template's read when this was `space-admin`.
      Exactly the check working: an unreadable member fell out as a failing test rather than as an
      indicator that silently never rendered.
    */
    autoInterpret: state('space-settings'),
    extractionTargets: state('space-settings'),
    setExtractionTarget: action('space-settings'),
    shareExtractionDetail: state('space-settings'),
    setShareExtractionDetail: action('space-settings'),
    templateOverrideOptions: state('space-admin'),
    themeOverrideOptions: state('space-admin'),
    /*
      `appearance`, not `space-admin` beside its options list: this answers "is the theme you are
      looking at one you chose here", which is a fact about the current view rather than about
      configuring some other space. The theme picker in the rail needs it to know whether to offer
      a reset, and that picker lives in the appearance tier.
    */
    spaceThemePinned: state('appearance'),
    moduleInstallSettings: state('space-admin'),
    createSpace: action('space-admin'),
    initializeAsWeSpace: action('space-settings'),
    removeSpace: destructive('space-admin'),
    updateSpaceImage: hereOnly('space-settings', 2),
    updateSpaceMeta: hereOnly('space-settings', 1),
    setSpaceDefaultTemplate: hereOnly('space-settings', 1),
    setSpaceDefaultTheme: hereOnly('space-settings', 1),
    setModuleEnabled: hereOnly('space-settings', 2),
    setAutoInterpret: hereOnly('space-settings', 1),
    /*
      Which sections the space has, and in what order — the community's decision, so the same tier
      and the same arity guard as `setModuleEnabled`.

      The settings *list* — every section with both layers' answers — travels on each `spaceList`
      row rather than being a member of its own, exactly as `modules` does: the page configures the
      space you clicked, which is usually not the one you are standing in.
    */
    setViewEnabled: hereOnly('space-settings', 2),
    reorderViews: hereOnly('space-settings', 1),
    removeSpaceFromGlobal: destructive('space-admin'),

    // ── agent: this agent's own preferences, private to them ──
    installedModules: state('agent'),
    setModuleInstalled: action('agent'),
    setModuleVisible: hereOnly('space-settings', 2),
    /** Hiding a section for yourself. Private, and never removes it for anybody else. */
    setViewVisible: hereOnly('space-settings', 2),
    setSpaceTemplateOverride: hereOnly('appearance', 1),
    setSpaceThemeOverride: hereOnly('appearance', 1),
    /*
      Both are `setSpaceThemeOverride` aimed at the space on screen and nowhere else, so they sit in
      the same tier — and take no space argument at all, which is why they need no `hereOnly` arity
      guard: there is no parameter through which a template could name somebody else's space.
    */
    applyTheme: action('appearance'),
    clearSpaceThemePin: action('appearance'),

    updateSpaceInCache: WIRING,
    loadSpaces: WIRING,
  },

  shapeStore: {
    // ── the models this space carries, and both editing surfaces over them ──
    // All 'space-settings': defining what a "Sighting" is in this community is the same act as
    // renaming the space — the community shaping its own container, pinned to the space on screen.
    spaceShapes: state('space-settings'),
    shapesLoaded: state('space-settings'),
    shapeDraft: state('space-settings'),
    editingShapeId: state('space-settings'),
    draftErrors: state('space-settings'),
    savingShape: state('space-settings'),
    aiAvailable: state('space-settings'),
    generating: state('space-settings'),
    hintEntities: state('space-settings'),
    /*
      'content' rather than 'space-settings', unlike everything else on this store.

      Capability groups name what a template is being trusted with, and this is read to *render*: a
      feed showing what an extraction pass found on a call needs the list of models it could have
      found, the same way it needs `recordStore.displays` to draw one. Grouping it with the model
      wizard would make an ordinary card list ask for the capability that edits a space's vocabulary.
    */
    extractionCandidates: state('content'),
    provideExtractionEnroller: WIRING,
    extractionNeedsIdentity: state('space-settings'),
    relationshipTargets: state('space-settings'),
    identityOptions: state('space-settings'),
    hintEditor: state('space-settings'),
    hintBusy: state('space-settings'),
    openShapeWizard: action('space-settings'),
    cancelShapeWizard: action('space-settings'),
    setShapeField: action('space-settings'),
    setIdentityMember: action('space-settings'),
    setExtractable: action('space-settings'),
    addProperty: action('space-settings'),
    addRelationship: action('space-settings'),
    removeMember: action('space-settings'),
    setMemberField: action('space-settings'),
    reorderMembers: action('space-settings'),
    expandedMembers: state('space-settings'),
    memberOptions: state('space-settings'),
    confirmDiscard: state('space-settings'),
    requestCloseWizard: action('space-settings'),
    cancelDiscard: action('space-settings'),
    toggleMemberExpanded: action('space-settings'),
    commitDraft: action('space-settings'),
    replaceDraft: action('space-settings'),
    generateShapeDraft: action('space-settings'),
    generateShapeFields: action('space-settings'),
    generateIntent: state('space-settings'),
    requestGenerateFields: action('space-settings'),
    confirmReplaceFields: state('space-settings'),
    cancelReplaceFields: action('space-settings'),
    saveShapeDraft: action('space-settings'),
    // Destructive in the "expensive to reverse" sense: the record goes, and although data and SDNA
    // remain, re-creating the model needs its definition re-authored.
    deleteShape: destructive('space-settings'),
    openHintEditor: action('space-settings'),
    closeHintEditor: action('space-settings'),
    setHintDraft: action('space-settings'),
    saveHintEditor: action('space-settings'),
    resetHintEditor: action('space-settings'),
  },

  recordStore: {
    // ── 'content', not 'space-settings' ──
    // The neighbouring store defines what a "Sighting" *is*, which is the community shaping its own
    // container. Creating one is writing a record, which is the same act as posting — so it belongs
    // in the tier every template can reach, beside `spaceStore.createPost`.
    creatableEntities: state('content'),
    displays: state('content'),
    recordDraft: state('content'),
    recordDraftDirty: state('content'),
    recordErrors: state('content'),
    savingRecord: state('content'),
    lastCreatedId: state('content'),
    pendingLink: state('content'),
    openRecordForm: action('content'),
    connectNodes: action('content'),
    createOnBoard: action('content'),
    createCardOnBoard: action('content'),
    placeOnBoard: action('content'),
    removeFromBoard: action('content'),
    resizeOnBoard: action('content'),
    // Host wiring, both halves of one mechanism: the graph host reads what is pending and reports
    // the rows it read back. A template has no use for either — it writes through the actions above
    // and the optimism is applied for it.
    pendingCardStyle: WIRING,
    confirmPending: WIRING,
    // Template-facing: a control that reports while it moves previews through this and writes on
    // release, which is what makes a slider show its result before the drag ends.
    previewCardStyle: action('content'),
    setCardStyle: action('content'),
    setTypeColor: action('content'),
    setRecordEntity: action('content'),
    setRecordField: action('content'),
    relationshipKind: state('content'),
    setRelationshipKind: action('content'),
    cancelRecordForm: action('content'),
    saveRecord: action('content'),
  },

  themeStore: {
    automaticThemes: state('appearance'),
    /*
      The pairing is the agent's own, so it sits at the agent tier with `themeScope` and
      `useTemplateTheme` rather than with `appearance`.

      The distinction is worth being exact about, because the row it configures appears in two
      places that look alike. In the shell's picker "Follow system" is *my* choice about *my*
      window; in a space's settings it is the community saying "this space's default is: follow
      each member's own system". A control repointing what "Follow system" means for me, reachable
      from a template a community wrote, would let a space quietly restyle every session I open
      afterwards. That is the whole thing the tier exists to refuse.
    */
    systemThemes: state('agent'),
    systemThemeOptions: state('agent'),
    builtInThemes: state('appearance'),
    installedThemes: state('appearance'),
    spaceThemes: state('appearance'),
    allThemes: state('appearance'),
    currentThemeId: state('view-state'),
    currentTheme: state('view-state'),
    defaultThemeId: state('library'),
    themeManagementList: state('library'),
    editingTheme: state('editor'),
    operationLoading: state('appearance'),
    themeScope: state('view-state'),
    themeScopePreference: state('view-state'),
    themeScopeGlobal: state('view-state'),
    themeScopePreviewing: state('editor'),
    // Boot timing, not a preference a template should be reading — see ThemeStore.
    templateThemePending: state('editor'),
    useTemplateTheme: state('view-state'),
    activeTemplateTheme: state('view-state'),
    setCurrentTheme: action('appearance'),
    setDefaultTheme: action('library'),
    setSystemTheme: action('agent'),
    setThemeInstalled: action('library'),
    previewThemeScope: action('editor'),
    setThemeScopeGlobal: action('agent'),
    setUseTemplateTheme: action('agent'),
    /*
      Host wiring, both: the theme resolver calls them as the agent moves between spaces, and
      nothing a template could say with them is not already said by applyTheme and clearSpaceThemePin.
      They were classified as API, which listed them in the reference with a description that had to
      say "prefer something else" — the tell that a member was constrained rather than designed in.
    */
    restorePersonalTheme: WIRING,
    clearSpaceTheme: WIRING,
    startEditing: action('editor'),
    // The editor tier, with `startEditing` — this is the second half of the same gesture: open the
    // theme editor, and say which role you came for. Nothing a template has any business setting.
    focusedRole: state('editor'),
    focusRole: action('editor'),
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
    // Into the space rather than into your account, which is why it sits a tier below its neighbour.
    installToSpace: action('space-settings'),
    uninstallTheme: destructive('library'),
    deleteMarketplaceTheme: destructive('library'),
    publishToMarketplace: action('library'),
    publishToSpace: action('library'),

    replaceTheme: WIRING,
    registerHistoryCallbacks: WIRING,
    applySnapshot: WIRING,
    // Host wiring, deliberately. A template's channel for a named theme is the declarative
    // `theme: { themeName }` prop, which the renderer stamps and this store then satisfies. Exposing
    // the injector itself would let a template pull any installed theme's stylesheet into the
    // document whenever it liked, which is the surface the declarative form exists to bound.
    requestNamedThemes: WIRING,
    loadInstalledThemes: WIRING,
    refreshSpaceThemes: action('appearance'),
  },

  templateStore: {
    personalTemplates: state('appearance'),
    spaceTemplates: state('appearance'),
    builtInTemplates: state('appearance'),
    myTemplates: state('library'),
    allTemplates: state('appearance'),
    templateManagementList: state('library'),
    switcherGroups: state('appearance'),
    // Beside `switcherGroups` rather than with `currentTemplate`: it is the switcher's spelling of
    // the current id, meaningless to anything not rendering those rows.
    currentSwitcherId: state('appearance'),
    currentTemplate: state('view-state'),
    loading: state('library'),
    defaultTemplateId: state('library'),
    operationLoading: state('appearance'),
    switchTemplate: action('appearance'),
    removeTemplate: destructive('library'),
    deleteTemplate: destructive('library'),
    installTemplate: action('library'),
    uninstallTemplate: action('library'),
    installFromMarketplace: action('library'),
    installToSpace: action('space-settings'),
    /*
      The install dialog's own three members.

      `library`, and at the chrome tier only — the dialog is host chrome by design (a dialog
      vouching for a template must not be drawn by one), so nothing at the space tier has any use
      for them, and `confirmInstall` writing on a click a space template could make is exactly the
      confirmation being bypassed. See InstallPrompt.schema.ts.
    */
    pendingInstall: state('library'),
    confirmInstall: action('library'),
    cancelInstall: action('library'),
    setDefaultTemplate: action('library'),
    saveTemplate: action('editor'),
    saveTemplateAs: action('editor'),
    publishToSpace: action('library'),
    deleteMarketplaceTemplate: destructive('library'),
    publishToMarketplace: action('library'),
    // Queries that answer with a value, which $action cannot read: templateManagementList carries
    // isBuiltIn and isInstalled per row, which is the form a template can use.
    isBuiltInTemplate: WIRING,
    isInstalled: WIRING,

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
    // Install or uninstall by id, which is what the settings list's switch calls. `library`, like
    // the two actions it delegates to — marking it wiring left that switch inert.
    toggleInstalled: action('library'),
    provideSpaceLookup: WIRING,
    preloadSpaceTemplates: WIRING,
    loadSpaceTemplates: WIRING,
    refreshSpaceTemplates: action('appearance'),
    clearSpaceTemplates: WIRING,
    getTemplateRecord: WIRING,
  },

  routeStore: {
    currentPath: state('view-state'),
    segments: state('view-state'),
    params: state('view-state'),
    navigate: action('navigation'),
    setParam: action('view-state'),
    back: action('navigation'),

    setNavigateFunction: WIRING,
    setCurrentPath: WIRING,
  },

  shellStore: {
    activeShellView: state('navigation'),
    openShellView: action('navigation'),
    closeShellView: action('navigation'),
    /*
      Host wiring, not a capability. The overlay's own router calls this on every move so a remount
      can put it back; a template has no overlay to report about, and letting one write another
      surface's remembered location would be a way to redirect somebody else's page.
    */
    rememberShellPath: WIRING,
    createSpaceOpen: state('space-admin'),
    /*
      Opening the host's create-space dialog, which is not the same act as creating a space —
      `spaceStore.createSpace` stays at `space-admin`. A template asks, chrome's own dialog appears,
      and the user fills it in and presses the button. That indirection is what makes it navigation
      rather than administration: the template can request a destination, never arrive at one on the
      user's behalf.
    */
    setCreateSpaceOpen: action('navigation'),
    /*
      The host's delete confirmation.

      `wiring` for all four, deliberately, and this is the one classification in the file where
      being reachable would defeat the member's whole purpose. The dialog stands between a space
      template and every destructive action it can name; a template that could read
      `pendingDestructive` could tell whether the dialog was up, and one that could call
      `confirmDestructive` could answer its own question. `requestDestructive` is the guard itself,
      passed to `buildTemplateBag` by the host.

      Chrome reaches them the way it reaches everything else the templates may not touch: it is not
      in a bag at all. `DestructivePrompt.schema.ts` is a host slot, rendered against the chrome
      bag — so these must appear in the chrome tier too, and `wiring` would exclude them from both.
      They are `host-layout`, the group chrome-only surfaces already live in.
    */
    pendingDestructive: state('host-layout'),
    confirmDestructive: action('host-layout'),
    cancelDestructive: action('host-layout'),
    requestDestructive: WIRING,
    /*
      The space-settings panel — which host surface is open, and asking for it.

      `navigation`, on exactly the reasoning above and the reasoning behind `activeShellView`: these
      say "show me the app's own settings for this space" and nothing more. What that panel then
      permits is decided inside it, by `canAdminister`, not by whoever opened it — so a template
      offering the button is offering a destination, not a capability.

      That it is space-tier is load-bearing rather than incidental: the About *view* carries a pencil
      that opens this, and a view renders at `SPACE_TIER`. Chrome-tiering it would leave that pencil
      pointing at something it is not allowed to call.
    */
    spaceSettingsOpen: state('navigation'),
    openSpaceSettings: action('navigation'),
    closeSpaceSettings: action('navigation'),
    toggleSpaceSettings: action('navigation'),
    // Where the host should put that panel — read by the dock resolver in TypeScript, never by a
    // schema, which addresses a dock through `shellStore.dockGeometry` instead.
    spaceSettingsEdge: WIRING,
    scrollToId: action('view-state'),

    takePendingPath: WIRING,

    /*
      The app's own furniture — and `host-layout` exists because of a wrong guess here.

      These were `WIRING`, on the reasoning that dock geometry is "the host's layout arithmetic,
      driven by a resize handle it owns". The arithmetic is the host's; the handle is not code. Docks
      are built as *schema* by `dockRegistry.dockFrame` — the geometry arrives through
      `{ $: 'shellStore.dockGeometry.<id>.<field>' }` and the drag through
      `{ $action: 'shellStore.beginDockResize' }` — so marking them wiring removed them from every
      bag, chrome's included. Every docked panel rendered as empty space with no resize rail.

      That is the gap `WIRING` had: it conflated "no schema may have this" with "no *template* may
      have this". Chrome is schema too. So this is a group rather than an exemption, and it is
      chrome-tier: a space's template has no business moving the app's panels around, and its own
      view state is `view-state`.
    */
    dockGeometry: state('host-layout'),
    contentInset: state('host-layout'),
    dockResizing: state('host-layout'),
    // Read by the sidebar and the module rail, which hide while a panel is maximised.
    panelMaximised: state('host-layout'),
    // Written by the host layout, which can see the editor's widths — never by a template.
    beginDockResize: action('host-layout'),
    resizeDock: action('host-layout'),
    endDockResize: action('host-layout'),
    /*
      Moving a panel, which is the same capability as resizing one and is listed for the same reason.

      The frame reads `dockPlacement` to tick the position menu and to light the displace toggle, and
      drives the drag through `beginDockMove`/`moveDock`/`endDockMove` — plus `movingDock`,
      `activeSnap` and `snapTargets`, which are what make the eight landing spots appear under a panel
      while it is being dragged and nowhere else.
    */
    dockPlacement: state('host-layout'),
    movingDock: state('host-layout'),
    activeSnap: state('host-layout'),
    snapTargets: state('host-layout'),
    // The gaps in a strip, and which one a drop would take — what makes reordering a dock possible.
    insertSlots: state('host-layout'),
    activeInsert: state('host-layout'),
    insertDock: action('host-layout'),
    beginDockMove: action('host-layout'),
    moveDock: action('host-layout'),
    endDockMove: action('host-layout'),
    snapDock: action('host-layout'),
    toggleMaximiseDock: action('host-layout'),
    fitDock: action('host-layout'),
    toggleDockDisplace: action('host-layout'),
    // Whether a panel has been dragged away from what the interface declared, and the way back.
    layoutPinned: state('host-layout'),
    resetDockToLayout: action('host-layout'),
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

  /*
    Grouped under `presence`, not `content`.

    Everything here is transient agent-to-agent state — who is doing what, right now — which is what
    that group already means, and it rides the same ephemeral transport presence does. None of it
    survives a refresh and none of it is queryable, so classifying it with the durable content a
    template reads would be claiming a permanence it does not have.

    What crosses the wire is governed by `spaceStore.shareExtractionDetail`, which is a
    space-settings concern and classified there — this store only reports.
  */
  interpretationStore: {
    // Not `presence` like the rest: this is a fact about the node, not about who is doing what on
    // it, and a template reads it for the same reason it reads any other "can this host do X" —
    // to decide whether to offer a control at all.
    capable: state('content'),
    activity: state('presence'),
    runningCount: state('presence'),
    hasActivity: state('presence'),
    dismissSettled: action('view-state'),
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
    /*
      Where each panel opens, and how — read by the *host's* dock system rather than by a template.

      These replaced four widths and four setters. A panel's size is dragged from any edge or corner
      now and remembered by the shell beside its position, so the editor no longer holds a number for
      it — the keys left say only "open, at this edge, as this kind of panel".
    */
    aiDockEdge: state('editor'),
    codeDockEdge: state('editor'),
    themeDockEdge: state('editor'),
    visualDockEdge: state('editor'),
    editorDockSize: state('editor'),
    editorDockFloat: state('editor'),
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
    sendMessage: action('editor'),
    clearHistory: destructive('editor'),

    // The Claude API key. Written through a settings form in chrome, read by this store to make a
    // request — never a value any template needs to see.
    setApiKey: WIRING,
    onSchemaEdit: WIRING,
    pushSnapshot: WIRING,
  },

  /**
   * Record mutations — writing one instance of an entity. Reads need no entry: `$query` goes
   * through the renderer's own bindings, and a template that can render a space's data is the
   * entire point.
   */
  record: {
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
  '$getEntity',
  '$getEntitiesForPerspective',
  '$queryAdapter',
  '$identities',
  '$ephemeral',
  /*
    The host-source registry — computed rows and values a template may call on.

    Present in every bag for the same reason `$getEntity` is: it is a host-provided capability that
    templates are meant to reach, not store state anyone needs protecting from. Its members are pure
    synchronous functions the host chose to register, so there is nothing here to gate — a template
    that can call `calendarMonth` can compute a month, which is the entire point of registering it.

    Left unclassified it was simply dropped, silently, exactly as this file's own rule says an
    undecided store should be: the calendar rendered and reported "Source not registered on this
    host", which reads as a missing registration rather than a withheld one.
  */
  '$sources',
]);

/**
 * Module stores, with every function tagged so an expression can still read module state.
 *
 * **This is deliberately permissive, and the one place the boundary is not yet drawn.** A module's
 * store is a flat record whose members are a mix of raw signals, derived closures and actions, and
 * nothing distinguishes them — so tagging selectively is not possible without the module saying
 * which is which. Tagging all of them keeps `{ $: 'modules.transcribe.level' }` working and
 * leaves `modules.call.leave` callable during paint, exactly as before.
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
  /**
   * Called before a `destructive` action runs. Resolving false refuses it.
   *
   * Asynchronous, and that is the whole reason this was never wired to anything. A confirmation is
   * a question put to a person, so a guard that had to answer *synchronously* could only ever have
   * been a policy check — and there is no policy here, there is a human. The option existed, three
   * call sites passed nothing, and every destructive action a space template could name ran on one
   * unqualified click.
   *
   * Awaiting it makes a destructive action async from the template's point of view, which costs
   * nothing: `$action` already awaits, and `onSuccess`/`onError`/`onFinally` are defined in terms
   * of the returned promise. A refusal resolves `undefined` — the same nothing a blocked action
   * resolves — so `onSuccess` does not fire on a cancel.
   */
  onDestructive?: (path: string, args: unknown[]) => boolean | Promise<boolean>;
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
  // The grant that says "change settings in spaces other than this one" — so the bag holding it is
  // the bag where naming a space is the point rather than the danger. See `MemberSpec.arity`.
  const mayNameASpace = granted.has('space-admin');
  const bag: Record<string, unknown> = {};

  for (const key of Object.keys(stores)) {
    /*
      Modules, re-read on every access.

      `moduleStores` is one object the registry mutates in place as modules register and unregister,
      so copying its contents once would freeze the module set at whatever had loaded when this bag
      was built — and `{ $: 'modules.notes.open' }` is documented as the way a template depends
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

      `$getEntity`, `$currentDataset`, `$queryAdapter` and the rest are defined on the host's bag as
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
        // something to invoke — which is what stops a store read from running an action.
        filtered[name] = typeof member === 'function' ? markReactive(member) : member;
        continue;
      }

      const path = `${key}.${name}`;
      let method = member as (...args: unknown[]) => unknown;

      // Pinned to the space on screen: the trailing `spaceUuid` argument is dropped before the store
      // ever sees it, so the default — "here" — is the only thing a template can express.
      if (spec.arity !== undefined && !mayNameASpace) {
        const bound = method;
        const arity = spec.arity;
        method = (...args: unknown[]) => bound(...args.slice(0, arity));
      }

      if (spec.destructive && options.onDestructive) {
        const guard = options.onDestructive;
        const bound = method;
        method = async (...args: unknown[]) => ((await guard(path, args)) ? bound(...args) : undefined);
      }

      filtered[name] = method;
    }
    bag[key] = filtered;
  }

  return bag as T;
}

/**
 * What a template asks for, and what it would not be given.
 *
 * `buildTemplateBag` is the enforcement: a reference outside the grant resolves to nothing, and
 * that is true whatever this function says. So why read the schema at all?
 *
 * Because "resolves to nothing" is invisible. A synced space template referencing
 * `sessionStore.logout` renders a Sign out button that takes the click and does nothing, and a
 * `{ $: 'runtimeStore.trustedAgents' }` renders an empty list rather than an error — a
 * template that is quietly half-broken, in a way neither its author nor the person looking at it
 * can see. Reading the references before accepting the template turns a silent hole into a
 * sentence, at install time, naming what it wanted.
 *
 * It is also the honest place to *refuse*. A template arriving from a peer that asks to administer
 * the backend is not a template with a bug in it.
 */
export interface SurfaceReference {
  /** The store path as written — `sessionStore.logout`. */
  path: string;
  /** How it was reached: read in an expression, or called through `$action`. */
  via: 'store' | 'action';
  /** The group it belongs to, or null when the member is not classified at all. */
  group: CapabilityGroup | null;
}

export interface SurfaceInspection {
  /** References the grant covers. */
  allowed: SurfaceReference[];
  /** References that would resolve to nothing — the reason to refuse, or at least to say so. */
  blocked: SurfaceReference[];
  /** The distinct capability groups the template actually uses, for an install prompt. */
  groups: CapabilityGroup[];
}

/** Store names the bag always provides, so a reference to one is never blocked. */
const UNGATED_ROOTS = new Set([...ALWAYS_PRESENT, 'modules']);

/** Roots an expression may start from that are not stores, and so are never classified. */
const EXPRESSION_ROOTS = new Set([
  'local',
  'me',
  'currentDataset',
  'event',
  'arg',
  'result',
  'index',
  'prev',
  'surface',
  'item',
]);

function classify(path: string): { store: string; member: string; spec: Classification | undefined } | null {
  const [store, member] = path.split('.');
  if (!store || !member) return null;
  return { store, member, spec: TEMPLATE_SURFACE[store]?.[member] };
}

/**
 * Walk any schema-shaped value, collecting every store read in an expression and every `$action`.
 *
 * Structural rather than typed on `SchemaNode`, because references live in props, in nested
 * operator objects, in `$each` items, in route trees and in handler arrays — everywhere. A walk
 * that knew the node shape would have to be revised for every operator added, and the failure mode
 * of missing one is a reference nobody inspected.
 */
function collectReferences(value: unknown, into: { path: string; via: 'store' | 'action' }[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, into);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const node = value as Record<string, unknown>;
  if (typeof node.$action === 'string') into.push({ path: node.$action, via: 'action' });
  /*
    An expression names stores as bare paths — `spaceStore.members`, `modules.notes.open`. Every
    dotted root the expression reads is reported as a store reference; roots that are not stores
    (`local`, `item`, `me`) are dropped by `classify` below exactly as an ungated store root is,
    so there is no second list of names to keep in step. A source that does not parse names
    nothing, which is right: it resolves to nothing at paint too, and the validator is where the
    syntax error is reported.
  */
  if (isExpressionToken(node)) {
    try {
      for (const { root, path } of referencedPaths(parseExpression(node.$))) {
        if (path.length > 0) into.push({ path: [root, ...path].join('.'), via: 'store' });
      }
    } catch {
      // A syntax error is the validator's to report.
    }
  }
  /*
    A query's `dataset` is a store path too — `dataset: 'datasetStore.marketplaceDataset'` — and the
    renderer resolves it against the same bag expressions read from. Left out of the walk, a dataset
    the bag withholds is a query that quietly runs against nothing, which is how the marketplace
    shelf came to render empty with every check passing. A query object always carries `entity`,
    which is what tells this apart from any other prop that happens to be called `dataset`; the
    `$`-prefixed forms (`$currentDataset`) are renderer bindings, not store members.
  */
  if (typeof node.entity === 'string' && typeof node.dataset === 'string' && !node.dataset.startsWith('$')) {
    into.push({ path: node.dataset, via: 'store' });
  }

  for (const entry of Object.values(node)) collectReferences(entry, into);
}

/**
 * Inspect a template against a set of grants.
 *
 * A store path may be deeper than `store.member` (`spaceStore.currentSpace.name`); only the
 * first two segments decide access, which is exactly what the bag does — it filters members, and
 * everything below one travels with it.
 */
export function inspectTemplateSurface(schema: unknown, grants: readonly CapabilityGroup[]): SurfaceInspection {
  const granted = new Set(grants);
  const references: { path: string; via: 'store' | 'action' }[] = [];
  collectReferences(schema, references);

  const allowed: SurfaceReference[] = [];
  const blocked: SurfaceReference[] = [];
  const groups = new Set<CapabilityGroup>();
  const seen = new Set<string>();

  for (const { path, via } of references) {
    const key = `${via}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const root = path.split('.')[0];
    if (UNGATED_ROOTS.has(root)) continue;

    const parsed = classify(path);
    /*
      A root that is not a store at all — a `$each` variable, `local`, a name the expression bound.
      Only an expression can produce one here (a store path always starts with a store), and it
      is not a reference to anything the surface governs. A *typo'd* store name lands here too, and
      that is the validator's to report against the known store list, not this walker's — this
      answers "may you", not "does it exist".
    */
    if (
      !parsed ||
      (TEMPLATE_SURFACE[parsed.store] === undefined && (EXPRESSION_ROOTS.has(root) || !/Store$/.test(root)))
    )
      continue;
    if (parsed.spec === undefined || parsed.spec === WIRING) {
      // Unclassified or host wiring. Blocked either way — an undecided member is not an open one —
      // but with a null group, so a caller can word "there is no such thing" differently from
      // "you may not have that".
      blocked.push({ path, via, group: null });
      continue;
    }

    const reference: SurfaceReference = { path, via, group: parsed.spec.group };
    if (granted.has(parsed.spec.group)) {
      allowed.push(reference);
      groups.add(parsed.spec.group);
    } else {
      blocked.push(reference);
    }
  }

  return { allowed, blocked, groups: [...groups] };
}
