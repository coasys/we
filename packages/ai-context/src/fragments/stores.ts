/**
 * Stores fragment — documents all available stores with state keys and action signatures.
 *
 * Hand-maintained: update when stores change (infrequent — only 7 stores).
 * `storeEntries` is the structured source of truth; the `stores` text is derived from it.
 */

import type { StoreEntry } from '../types.js';

export const storeEntries: StoreEntry[] = [
  {
    name: 'sessionStore',
    state: {
      me: { type: 'object', properties: ['did', 'perspective', 'directMessageLanguage'] },
      bootState: { type: 'string' },
      bootError: { type: 'string' },
      passwordError: { type: 'boolean' },
      loginLoading: { type: 'boolean' },
      createAgentError: { type: 'string' },
      createAgentLoading: { type: 'boolean' },
      host: {
        type: 'object',
        properties: ['id', 'name', 'description', 'imageUrl', 'location', 'url', 'computeSpecs', 'aiModels', 'rates'],
      },
      hostAccount: { type: 'object', properties: ['email', 'remainingCredits', 'walletAddress', 'freeAccess'] },
      isGuest: { type: 'boolean' },
    },
    actions: ['login', 'createAgent', 'clearPasswordError', 'finishSetup', 'retryBoot', 'logout'],
  },
  {
    name: 'accountStore',
    state: {
      canManageAccounts: { type: 'boolean' },
      accounts: { type: 'array', properties: ['id', 'name', 'avatar', 'active', 'hasAgent', 'sharedWithLauncher'] },
      activeAccount: {
        type: 'object',
        properties: ['id', 'name', 'avatar', 'active', 'hasAgent', 'sharedWithLauncher'],
      },
      pendingRemoval: {
        type: 'object',
        properties: ['id', 'name', 'avatar', 'active', 'hasAgent', 'sharedWithLauncher'],
      },
      switchingTo: { type: 'object', properties: ['id', 'name', 'avatar', 'active', 'hasAgent', 'sharedWithLauncher'] },
      creating: { type: 'boolean' },
      hasOtherAccounts: { type: 'boolean' },
      accountsLoaded: { type: 'boolean' },
      isFirstRun: { type: 'boolean' },
      busy: { type: 'boolean' },
      error: { type: 'string' },
    },
    actions: [
      'refresh',
      'createAccount',
      'switchAccount',
      'removeAccount',
      'requestRemoval',
      'cancelRemoval',
      'confirmRemoval',
      'clearError',
    ],
  },
  {
    name: 'runtimeStore',
    state: {
      canAdminister: { type: 'boolean' },
      canManageTrust: { type: 'boolean' },
      canManageNetwork: { type: 'boolean' },
      canManageApps: { type: 'boolean' },
      canManageLanguages: { type: 'boolean' },
      canManageAi: { type: 'boolean' },
      canConfigureAi: { type: 'boolean' },
      canConfigureExecutor: { type: 'boolean' },
      mcpEnabled: { type: 'boolean' },
      mcpPort: { type: 'number' },
      executorRestartPending: { type: 'boolean' },
      canBackUp: { type: 'boolean' },
      logLevels: { type: 'array', properties: ['crate', 'level'] },
      backupStatus: { type: 'string' },
      aiModels: {
        type: 'array',
        properties: [
          'id',
          'name',
          'kind',
          'source',
          'isDefault',
          'kindLabel',
          'sourceLabel',
          'detail',
          'statusText',
          'ready',
        ],
      },
      aiTasks: { type: 'array', properties: ['id', 'name', 'modelId', 'systemPrompt'] },
      aiForm: {
        type: 'object',
        properties: [
          'id',
          'name',
          'kind',
          'sourceKind',
          'presetName',
          'apiBaseUrl',
          'apiKey',
          'apiModel',
          'hfRepo',
          'hfRevision',
          'hfFileName',
          'filePath',
          'useTokenizer',
          'tokenizerRepo',
          'tokenizerRevision',
          'tokenizerFileName',
        ],
      },
      aiPresetOptions: { type: 'array', properties: ['label', 'value'] },
      aiFormComplete: { type: 'boolean' },
      aiFormDirty: { type: 'boolean' },
      languages: { type: 'array', properties: ['address', 'name', 'system'] },
      trustedAgents: { type: 'array' },
      authorizedApps: {
        type: 'array',
        properties: ['id', 'name', 'description', 'url', 'iconUrl', 'capabilities', 'revoked'],
      },
      networkMetrics: { type: 'string' },
      peerInfos: { type: 'array' },
      loading: { type: 'boolean' },
      error: { type: 'string' },
      pendingConsent: { type: 'object', properties: ['kind', 'title', 'message', 'app', 'peerId'] },
      consentSecret: { type: 'string' },
    },
    actions: [
      'setMcpEnabled',
      'setMcpPort',
      'setLogLevel',
      'removeLogLevel',
      'exportDatabase',
      'importDatabase',
      'restartExecutor',
      'loadAiModels',
      'loadAiTasks',
      'newAiModel',
      'editAiModel',
      'setAiFormField',
      'closeAiForm',
      'saveAiModel',
      'removeAiModel',
      'setDefaultAiModel',
      'removeAiTask',
      'loadLanguages',
      'installLanguage',
      'removeLanguage',
      'loadTrustedAgents',
      'trustAgent',
      'untrustAgent',
      'loadAuthorizedApps',
      'revokeApp',
      'removeApp',
      'loadNetworkMetrics',
      'restartNetwork',
      'loadPeerInfos',
      'addPeerInfos',
      'approveConsent',
      'denyConsent',
      'dismissConsentSecret',
    ],
  },
  {
    name: 'datasetStore',
    state: {
      // `DatasetRef`'s actual fields. These were previously listed as uuid/sharedUrl/neighbourhood,
      // none of which exist — so a schema reading them got undefined, and the validator confirmed
      // the wrong name while rejecting the right one.
      datasets: { type: 'array', properties: ['id', 'name', 'sharedUri', 'sharedId', 'handle'] },
      orderedDatasets: { type: 'array', properties: ['id', 'name', 'sharedUri', 'sharedId', 'handle'] },
      currentDataset: { type: 'object', properties: ['id', 'name', 'sharedUri', 'sharedId', 'handle'] },
      currentDatasetCid: { type: 'string' },
      currentDatasetEntities: { type: 'array' },
      isWeSpace: { type: 'boolean' },
      joinedSpaceCids: { type: 'array' },
      datasetsLoaded: { type: 'boolean' },
      systemDatasetUuids: { type: 'array' },
      rootDataset: { type: 'object', properties: ['id', 'name', 'sharedUri', 'sharedId', 'handle'] },
      globalDataset: { type: 'object', properties: ['id', 'name', 'sharedUri', 'sharedId', 'handle'] },
      marketplaceDataset: { type: 'object', properties: ['id', 'name', 'sharedUri', 'sharedId', 'handle'] },
      globalSpaceId: { type: 'string' },
      globalSpaceConfigured: { type: 'boolean' },
      marketplaceConfigured: { type: 'boolean' },
      marketplaceJoined: { type: 'boolean' },
    },
    actions: ['switchDataset', 'reorderDatasets', 'cleanupSpaceSdna'],
  },
  {
    name: 'profileStore',
    state: {
      pendingAvatar: { type: 'string' },
      profiles: {
        type: 'array',
        properties: ['did', 'firstName', 'lastName', 'handle', 'bio', 'avatar', 'coverImage', 'location'],
      },
      ownProfile: {
        type: 'object',
        properties: ['did', 'firstName', 'lastName', 'handle', 'bio', 'avatar', 'coverImage', 'location'],
      },
      ownProfileLoaded: { type: 'boolean' },
      needsName: { type: 'boolean' },
    },
    actions: [
      'fetchProfile',
      'updateOwnProfile',
      'updateProfileImage',
      'clearProfileImage',
      'updateOwnLocation',
      'setPendingAvatar',
      'saveNameFromPrompt',
      'dismissNamePrompt',
      'completeAccountSetup',
    ],
  },
  {
    name: 'routeStore',
    state: {
      currentPath: { type: 'string' },
      segments: { type: 'array' },
      templateSegments: { type: 'array' },
      params: { type: 'object' },
    },
    actions: ['navigate', 'setParam', 'back'],
  },
  {
    name: 'themeStore',
    state: {
      builtInThemes: { type: 'array', properties: ['id', 'name', 'icon', 'origin'] },
      automaticThemes: { type: 'array', properties: ['id', 'name', 'icon', 'origin'] },
      installedThemes: { type: 'array', properties: ['id', 'name', 'icon', 'origin'] },
      spaceThemes: { type: 'array', properties: ['id', 'name', 'icon', 'origin'] },
      allThemes: { type: 'array', properties: ['id', 'name', 'icon', 'origin'] },
      currentThemeId: { type: 'string' },
      currentTheme: { type: 'object', properties: ['id', 'name', 'icon', 'origin'] },
      defaultThemeId: { type: 'string' },
      operationLoading: { type: 'string' },
      themeScope: { type: 'string' },
      themeScopePreference: { type: 'string' },
      themeScopeGlobal: { type: 'boolean' },
      themeScopePreviewing: { type: 'boolean' },
      themeManagementList: {
        type: 'array',
        properties: ['id', 'name', 'icon', 'isBuiltIn', 'isInstalled', 'isDefault'],
      },
    },
    actions: [
      'setCurrentTheme',
      'setDefaultTheme',
      'setThemeScopeGlobal',
      'previewThemeScope',
      'setThemeInstalled',
      'installFromMarketplace',
      'installToSpace',
      'uninstallTheme',
      'deleteTheme',
    ],
  },
  {
    name: 'templateStore',
    state: {
      personalTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      spaceTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      builtInTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      myTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      allTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      currentTemplate: { type: 'object', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      templateManagementList: {
        type: 'array',
        properties: ['id', 'name', 'icon', 'description', 'isBuiltIn', 'isInstalled', 'isDefault'],
      },
      switcherGroups: { type: 'array', properties: ['label', 'items'] },
    },
    actions: [
      'switchTemplate',
      'removeTemplate',
      'saveTemplate',
      'toggleInstalled',
      'installToSpace',
      'setDefaultTemplate',
      'deleteTemplate',
    ],
  },
  {
    name: 'spaceStore',
    state: {
      mySpaces: { type: 'array', model: 'Space' },
      personalSpaces: { type: 'array', model: 'Space' },
      sharedSpaces: { type: 'array', model: 'Space' },
      routeSpaceUnjoined: { type: 'boolean' },
      spacePath: { type: 'string' },
      joiningSpace: { type: 'string' },
      joinSlow: { type: 'boolean' },
      joinError: { type: 'object', properties: ['spaceId', 'message'] },
      spaceList: {
        type: 'array',
        properties: [
          'uuid',
          'name',
          'description',
          'avatar',
          'kind',
          'isWeSpace',
          'canAdminister',
          'modules',
          'shareLink',
          'guestLink',
          'defaultTemplateId',
          'defaultThemeId',
          'templateOverride',
          'themeOverride',
        ],
      },
      creatingSpace: { type: 'boolean' },
      orderedSidebarItems: { type: 'array', properties: ['uuid', 'name', 'avatar', 'spaceId'] },
      memberDids: { type: 'array', properties: ['did'] },
      members: {
        type: 'array',
        properties: ['did', 'firstName', 'lastName', 'handle', 'bio', 'avatar', 'coverImage', 'location'],
      },
      spaceDefaultTemplateId: { type: 'string' },
      spaceDefaultThemeId: { type: 'string' },
      currentSpace: { type: 'object', model: 'Space' },
      foreignSpacePrefill: { type: 'object', properties: ['name', 'description', 'avatar'] },
      enabledModules: {
        type: 'array',
      },
      installedModules: {
        type: 'array',
      },
      requiredModules: { type: 'array' },
      missingModules: { type: 'array' },
      activeModules: {
        type: 'array',
      },
      templateOverrideOptions: { type: 'array', properties: ['label', 'value'] },
      themeOverrideOptions: { type: 'array', properties: ['label', 'value'] },
      spaceThemePinned: { type: 'boolean' },
      canAdministerCurrentSpace: { type: 'boolean' },
      moduleInstallSettings: {
        type: 'array',
        properties: ['id', 'name', 'description', 'icon', 'installed'],
      },
      moduleLaunchers: {
        type: 'array',
        properties: ['id', 'icon', 'label', 'active'],
      },
      unreadNodeIds: { type: 'array' },
      myMentions: { type: 'array', properties: ['id', 'author', 'createdAt'] },
    },
    actions: [
      'createSpace',
      'uploadFile',
      'joinSpace',
      'initializeAsWeSpace',
      'removeSpace',
      'createPost',
      'updatePost',
      'deleteCollection',
      'updateSpaceImage',
      'updateSpaceMeta',
      'setSpaceDefaultTemplate',
      'setSpaceDefaultTheme',
      'createSignalType',
      'setSignalTypeRetired',
      'upsertSignal',
      'navigateToSpace',
      'openRecordRef',
      'canAdministerSpace',
      'copyShareLink',
      'copyGuestLink',
      'getSubgroupMessages',
      'exportCallTranscript',
      'setModuleEnabled',
      'setModuleInstalled',
      'setModuleVisible',
      'setSpaceTemplateOverride',
      'setSpaceThemeOverride',
      'applyTheme',
      'clearSpaceThemePin',
      'launchModule',
    ],
  },
  {
    name: 'shapeStore',
    state: {
      spaceShapes: {
        type: 'array',
        properties: [
          'id',
          'name',
          'description',
          'icon',
          'shapeId',
          'version',
          'forkedFrom',
          'propertyCount',
          'problems',
        ],
      },
      shapesLoaded: { type: 'boolean' },
      shapeDraft: {
        type: 'object',
        properties: ['name', 'description', 'icon', 'classHint', 'identityMember', 'members'],
      },
      editingShapeId: { type: 'string' },
      draftErrors: { type: 'array' },
      savingShape: { type: 'boolean' },
      aiAvailable: { type: 'boolean' },
      generating: { type: 'boolean' },
      hintEntities: { type: 'array', properties: ['entity', 'source'] },
      extractionCandidates: { type: 'array' },
      extractionNeedsIdentity: { type: 'boolean' },
      relationshipTargets: { type: 'array', properties: ['label', 'value'] },
      identityOptions: { type: 'array', properties: ['label', 'value'] },
      hintEditor: {
        type: 'object',
        properties: ['entity', 'classHint', 'defaultClassHint', 'rows', 'customized'],
      },
      hintBusy: { type: 'boolean' },
      expandedMembers: { type: 'array' },
      memberOptions: { type: 'array', properties: ['rowId', 'options'] },
      confirmDiscard: { type: 'boolean' },
      confirmReplaceFields: { type: 'boolean' },
      generateIntent: { type: 'string' },
    },
    actions: [
      'openShapeWizard',
      'cancelShapeWizard',
      'setShapeField',
      'setIdentityMember',
      'addProperty',
      'addRelationship',
      'removeMember',
      'setMemberField',
      'reorderMembers',
      'toggleMemberExpanded',
      'commitDraft',
      'requestCloseWizard',
      'cancelDiscard',
      'replaceDraft',
      'generateShapeDraft',
      'generateShapeFields',
      'requestGenerateFields',
      'cancelReplaceFields',
      'saveShapeDraft',
      'deleteShape',
      'openHintEditor',
      'closeHintEditor',
      'setHintDraft',
      'saveHintEditor',
      'resetHintEditor',
    ],
  },
  {
    name: 'editorStore',
    state: {
      isOpen: { type: 'boolean' },
      messages: { type: 'array' },
      isStreaming: { type: 'boolean' },
      streamingContent: { type: 'string' },
      apiKeyConfigured: { type: 'boolean' },
      templateName: { type: 'string' },
      templateIcon: { type: 'string' },
      isReadOnly: { type: 'boolean' },
      hasPendingChanges: { type: 'boolean' },
      pickerOpen: { type: 'boolean' },
      pickerAction: { type: 'string' },
      pickerDefaultName: { type: 'string' },
      pickerDefaultIcon: { type: 'string' },
      pickerShowDestination: { type: 'boolean' },
      sessions: { type: 'array' },
      activeSessionId: { type: 'string' },
      schemaJson: { type: 'string' },
      canUndo: { type: 'boolean' },
      canRedo: { type: 'boolean' },
    },
    actions: [
      'sendMessage',
      'close',
      'toggle',
      'startFork',
      'startFresh',
      'confirmPicker',
      'cancelPicker',
      'newChat',
      'switchSession',
      'deleteSession',
      'undo',
      'redo',
    ],
  },
  {
    name: 'shellStore',
    state: {
      activeShellView: { type: 'string' },
      createSpaceOpen: { type: 'boolean' },
    },
    actions: ['openShellView', 'closeShellView', 'setCreateSpaceOpen', 'scrollToId'],
  },
  {
    name: 'appStore',
    state: {
      apps: { type: 'array', properties: ['id', 'name', 'image'] },
      appsWithWe: { type: 'array', properties: ['id', 'name', 'icon', 'image'] },
      activeAppId: { type: 'string' },
    },
    actions: ['activateApp', 'deactivateApp'],
  },
  // Pseudo-store for record.create / record.update / record.delete $action tokens.
  // Not a real store (no `descriptions` entry below, so it's omitted from the
  // generated "## Stores" doc section) — it's already documented separately
  // under "Record mutations via $action" in rules.ts. Wired at runtime in
  // TemplateProvider.tsx as `recordActions`, not through the store registry.
  {
    name: 'record',
    state: {},
    actions: ['create', 'update', 'delete'],
  },
];

/** Generate the stores text fragment from structured data */
export function generateStoresText(entries: StoreEntry[]): string {
  const lines: string[] = [
    '## Stores',
    '',
    'Stores provide state (readable values) and actions (methods) for dynamic logic in schemas.',
    'Read state in an expression ({ "$": "storeName.member" }) and call actions with $action.',
    'For ephemeral/form state, use $localState with local.* reads and $setLocal writes instead of stores (see Dynamic Logic).',
  ];

  const descriptions: Record<string, { state: Record<string, string>; actions: Record<string, string> }> = {
    sessionStore: {
      state: {
        client: 'the backend client handle | undefined',
        me: 'Agent | undefined — the authenticated identity; prefer the $me token in schemas',
        bootState: "string — 'initialising' | 'login' | 'createAgent' | 'finishing' | 'ready' | 'error'",
        bootError: "string — why the boot failed, when bootState is 'error'. Empty otherwise",
        passwordError: 'boolean — true after a failed unlock attempt',
        loginLoading: 'boolean',
        createAgentError: 'string — the backend message from a failed agent creation, or empty',
        createAgentLoading: 'boolean',
        host: 'BackendHostInfo | undefined — the node this session runs against when it is somebody\'s hosting rather than this machine (id, name, description, imageUrl, location, url, computeSpecs, aiModels, rates). Undefined on desktop and on a local executor, so its presence is also the answer to "am I a guest here?" — gate any "connected to" UI on it. `aiModels` comes from the host directory and needs no capability, so it answers "can this node transcribe?" even where the executor refuses to list its models',
        hostAccount:
          'BackendAccountInfo | undefined — this agent\'s account with that node (email, remainingCredits, walletAddress, freeAccess). Check freeAccess before showing a balance: on a free node the credit figure means nothing and "0" reads as an account that has run dry',
        isGuest:
          'boolean — this identity was minted for somebody who arrived on a guest invite link rather than chosen by them. NOT the same question as `host`: an ordinary member of a hosted deployment has a host and is not a guest. Read it where the app explains itself to the person using it — why it is asking for a name, what "log out" would mean for an identity with no other way back',
        isDevelopment:
          'boolean — whether this is a development build. A fact about the build. Do NOT gate developer-only UI on it; gate on devTools, which is the same answer plus a switch',
        devTools:
          'boolean — whether developer affordances should be VISIBLE. True in a development build unless a developer has thrown the Settings → Developer switch to see what a shipped app looks like. Reactive, so a control gated on it appears and disappears on the press. Gate any developer-only control on this — a schema-test page, a fixture toggle — and wrap it in $if rather than hiding it, since a hidden row is still in the accessibility tree and still found by find-in-page. Never true in a production build, whatever the switch says',
        setDevTools:
          'shows or hides developer affordances for this device. Takes the value a switch emits, so pass `event.detail` bare — wrapping it in another token would resolve at render time and send a constant. Cannot turn them ON in a production build; the build is the ceiling. Gate the control that calls this on isDevelopment, NOT on devTools — gating the way to the switch on the switch makes turning it off a one-way door',
      },
      actions: {
        login: '(password: string): unlocks the agent and loads user data',
        createAgent:
          "(password: string): creates the agent, loads user data, and lands on the 'finishing' boot state (not 'ready')",
        clearPasswordError:
          '(): clears the failed-unlock flag. Chain it after the password field\'s $setLocal — the verdict was on the submitted password, so editing that password retracts it and a stale "Incorrect password" should not sit over the correction',
        retryBoot:
          '(): starts the whole boot again from the failure screen, by reloading. A failed boot can have got anywhere before it threw, so retrying in place would race the remains of the first attempt',
        finishSetup: "(): leaves 'finishing' for the running app — sets bootState to 'ready'",
        logout: '(): locks the agent and returns to the login screen',
        setDevTools:
          '(on: boolean): shows or hides developer affordances for this session. Takes the value the control shows, so a we-switch can pass `event.detail` bare. Cannot turn developer UI on in a production build',
      },
    },
    accountStore: {
      state: {
        canManageAccounts:
          'boolean — the host can manage local accounts (false on web). Gate every account control on this',
        accounts:
          'Account[] — local accounts (id, name, avatar, active, hasAgent, sharedWithLauncher). id is the data directory; hasAgent is false for one scaffolded but never set up',
        activeAccount:
          'Account | undefined — the account this app instance is running against. Correct at first paint: the list is seeded from a synchronous cache',
        hasOtherAccounts: 'boolean — true when there is somewhere else to switch to',
        accountsLoaded:
          'boolean — the host has answered. Without it an empty list reads as a first run and flashes a welcome at a returning user',
        isFirstRun:
          'boolean — nothing has ever been set up on this machine: the host has answered and no account holds an identity yet',
        busy: 'boolean — a mutation is in flight; a successful one ends in a relaunch',
        error: 'string — the last account error, for display',
        pendingRemoval: 'Account | null — the account a removal was requested for, awaiting confirmation',
        switchingTo: 'Account | null — the account being switched to, from the click until the process goes away',
        creating: 'boolean — true from the moment a create is requested until the process goes away',
      },
      actions: {
        refresh: '(): re-reads the account list from the host',
        createAccount:
          '(): creates an account under a provisional name and switches into it — the setup screen names it. Does not return on success',
        switchAccount: '(id: string): switches to another account. Does not return on success',
        removeAccount: '(id: string): deletes an account and its data. Refuses the active one',
        requestRemoval: '(id: string): opens the removal confirmation for that account',
        cancelRemoval: '(): closes the removal confirmation without deleting',
        confirmRemoval: '(): deletes the account awaiting confirmation',
        clearError: '(): clears the error slot',
      },
    },
    runtimeStore: {
      state: {
        canAdminister: 'boolean — this backend exposes runtime administration at all',
        canManageTrust: 'boolean — gate the trusted-agents section on this',
        canManageNetwork: 'boolean — gate the peer-network section on this',
        canManageApps: 'boolean — gate the authorized-apps section on this',
        canManageLanguages: 'boolean — gate the languages section on this',
        canManageAi: 'boolean — gate the AI section on this',
        canConfigureAi:
          "boolean — the models can be changed, not just listed. False for a guest on somebody else's node, where AD4M grants AI READ but refuses UPDATE/DELETE. Gate add/edit/remove/set-default controls on this and the section itself on canManageAi",
        canConfigureExecutor:
          'boolean — this host starts the backend, so how it starts it can be changed. False on web',
        mcpEnabled: 'boolean — whether the backend serves MCP on its next start',
        mcpPort: 'number — the port MCP is served on',
        executorRestartPending: 'boolean — settings were changed that the running backend has not picked up',
        canBackUp:
          'boolean — a database export/import can be offered: the backend writes the file and the host can name one. False on web',
        logLevels:
          '{ crate, level }[] — per-crate log levels the user has set, sorted. Empty means the backend own defaults are in use',
        backupStatus: 'string — what the last export or import did, for display. Empty until one runs',
        aiModels:
          'AiModelView[] — installed models, each carrying its display strings (kindLabel, sourceLabel, detail, statusText, ready) alongside id/name/kind/source/isDefault. Empty until loadAiModels() runs',
        aiTasks: 'AiTask[] — named prompts apps registered against a model (id, name, modelId, systemPrompt)',
        aiForm:
          'AiModelForm | null — the model form while it is open, null when closed. One flat field per input; read with runtimeStore.aiForm.<field>',
        aiPresetOptions: '{ label, value }[] — model names the backend can fetch itself, for the open form kind',
        aiFormComplete: 'boolean — the open form has every field its chosen source needs',
        aiFormDirty:
          "boolean — the open form has been edited since it opened. What a discard guard reads; compared against a snapshot taken on open, so looking at a model's settings and closing again asks nothing",
        languages:
          'InstalledLanguage[] — language plugins installed in this backend (address, name, system). Empty until loadLanguages() runs',
        trustedAgents: 'string[] — trusted peer ids. Empty until loadTrustedAgents() runs',
        authorizedApps:
          'AuthorizedApp[] — external apps holding credentials (id, name, description, url, iconUrl, capabilities, revoked). Empty until loadAuthorizedApps() runs',
        networkMetrics: 'string — backend diagnostic blob, displayed verbatim. Empty until requested',
        peerInfos: 'string[] — this node peer-discovery records, for out-of-band exchange',
        loading: 'boolean — true while any runtime call is in flight',
        error: 'string — the last runtime error, for display',
        pendingConsent:
          "ConsentRequest | null — a request awaiting the user's decision (kind: 'capability' | 'trust', title, message, app, peerId)",
        consentSecret: 'string — a code an approval returned, to be relayed to the asking app',
      },
      actions: {
        setMcpEnabled: '(enabled: boolean): turns MCP on or off for the backend next start',
        setMcpPort: '(port: number): sets the MCP port. The host refuses one outside 1024-65535',
        setLogLevel:
          '(crate: string, level: string): sets one crate log level — adds it when not already set, so there is no separate add. Levels: error, warn, info, debug, trace',
        removeLogLevel: '(crate: string): drops an override, returning that crate to the backend default',
        exportDatabase: '(): asks for a file, then has the backend write everything to it',
        importDatabase: '(): asks for a file, then has the backend read it back in',
        restartExecutor: '(): starts the backend over so written settings take effect. Does not return',
        loadAiModels: '(): fetches the installed AI models and their load status',
        loadAiTasks: '(): fetches the prompts apps registered against a model',
        newAiModel: '(): opens the model form empty, for a new model',
        editAiModel: '(id: string): opens the model form on an existing model',
        setAiFormField:
          '(field: string, value: string | boolean): sets one field of the open model form. Takes the field name so one action serves every input',
        closeAiForm: '(): closes the model form, discarding it',
        saveAiModel: '(): saves the open form — adds or updates depending on whether it has an id',
        removeAiModel: '(id: string): deletes a model',
        setDefaultAiModel: '(id: string): makes this the model apps get when they ask for its kind',
        removeAiTask: '(id: string): deletes a registered prompt',
        loadLanguages: '(): fetches the installed languages',
        installLanguage: '(address: string): installs a language by content address, then reloads the list',
        removeLanguage: '(address: string): removes an installed language. Refuses the backend own system languages',
        loadTrustedAgents: '(): fetches the trusted-agent list',
        trustAgent: '(id: string): trusts a peer, then reloads the list',
        untrustAgent: '(id: string): untrusts a peer, then reloads the list',
        loadAuthorizedApps: '(): fetches apps holding credentials against this agent',
        revokeApp: "(id: string): invalidates an app's tokens, keeping the grant listed",
        removeApp: '(id: string): forgets the grant entirely',
        loadNetworkMetrics: '(): fetches the diagnostic blob',
        restartNetwork: '(): restarts the peer-networking layer',
        loadPeerInfos: '(): fetches this node peer-discovery records',
        addPeerInfos: '(text: string): adds pasted peer records (JSON array or one per line)',
        approveConsent: '(): grants the pending request',
        denyConsent: '(): declines the pending request',
        dismissConsentSecret: '(): clears the confirmation code display',
      },
    },
    datasetStore: {
      state: {
        datasets: 'array of dataset handles (all joined datasets; AD4M perspectives in this backend)',
        orderedDatasets: 'datasets sorted by user-defined sidebar order, system datasets excluded',
        currentDataset: 'dataset handle | null (the dataset currently being viewed)',
        currentDatasetCid: 'string | undefined — the neighbourhood CID of the current dataset (prefix stripped)',
        currentDatasetEntities:
          'EntityManifestEntry[] (non-WE SHACL models from the current dataset; injected as externalEntities into AI messages)',
        isWeSpace:
          "boolean — true once the current dataset is confirmed to have WE's Space SDNA installed (false for a joined-but-foreign dataset, e.g. one synced in from Flux)",
        joinedSpaceCids: 'string[] — CIDs of every joined shared dataset',
        datasetsLoaded:
          'boolean — the backend has answered with the dataset list. An empty list is otherwise indistinguishable from "not fetched yet", so anything asking "have I joined this?" reads the boot frame as "no". The same reason accountStore.accountsLoaded exists',
        systemDatasetUuids: 'string[] — uuids of the we-root/we-test system datasets',
        rootDataset: "dataset handle | null — the agent's personal root dataset (we-root models live here)",
        globalDataset: 'dataset handle | null — the seed-configured global discovery space, once joined',
        marketplaceDataset: 'dataset handle | null — the seed-configured marketplace, once joined',
        globalSpaceId:
          'string | null — the dataset id of the seed-configured global discovery space, or null when it is not configured or not joined. Compare a route segment against it to tell "the user is in the global space" from "the user is in a space of their own"',
        globalSpaceConfigured: 'boolean — the seed declares a global space',
        marketplaceConfigured: 'boolean — the seed declares a marketplace',
        marketplaceJoined: 'boolean — the marketplace dataset is joined locally',
        currentDatasetUri:
          'string | undefined — the shared URL of the current dataset with its scheme (neighbourhood://…), or undefined for a personal one. Prefer currentDatasetCid for comparisons; this is the form a share link carries',
        marketplaceId:
          'string | null — the dataset id of the seed-configured marketplace, or null when it is not configured or not joined. The marketplace counterpart of globalSpaceId',
      },
      actions: {
        removeDataset:
          '(uuid: string): removes a dataset from the backend and from local state. The low-level half of spaceStore.removeSpace, which also clears the global-discovery listing — call that from a template, and this only for a dataset that is not a space',
        switchDataset:
          '(uuid: string): switches to a dataset by UUID, registers its SHACL models as dynamic model classes, and populates currentDatasetEntities',
        reorderDatasets: '(newOrder: string[]): reorders the sidebar items by UUID array',
        cleanupSpaceSdna:
          '(uuid?: string): one-time remediation for a space that accumulated duplicate SDNA installs — removes the redundant duplicate link copies. Defaults to the current dataset. Returns a display-ready summary string naming how many links were removed and the DIDs that authored them (your own DID annotated with "(you)"), or an empty string if nothing needed cleaning up',
      },
    },
    profileStore: {
      state: {
        profiles:
          'AgentProfileSummary[] — cache of all fetched profiles (did, firstName, lastName, handle, bio, avatar, coverImage, location)',
        ownProfile:
          'AgentProfileSummary | undefined — reactive accessor for the current user\'s own profile (derived from the cache). Note `name` is assembled for display and falls back to "Anonymous", so it is never empty — test firstName/lastName/handle to ask whether somebody has a name',
        ownProfileLoaded:
          'boolean — the own-profile fetch has answered. An empty profile is otherwise indistinguishable from an unfetched one, so anything asking "has this person set a name?" reads every boot frame as "no". Same reason as datasetStore.datasetsLoaded',
        needsName:
          'boolean — this agent has no name of any kind and has not waved the question away this session, as a settled fact (false until the app is ready and the profile fetch has answered). What the name prompt mounts on; also the right gate for any "finish setting up" nudge of your own',
        pendingAvatar:
          'File | null — a picture chosen before the agent exists, held until completeAccountSetup uploads it. Read it to preview the choice on the setup screen; null once uploaded or when nothing was picked',
      },
      actions: {
        setPendingAvatar:
          '(file: File): holds a picture chosen before an agent exists; uploaded by completeAccountSetup',
        saveNameFromPrompt:
          '(name: string): sets the name and stops asking. Dismisses before publishing, so a failed write cannot re-raise the prompt on top of the toast explaining it — which is why this exists rather than calling updateOwnProfile from the schema',
        dismissNamePrompt:
          "(): stops asking for a name until the next launch. Not persisted: a nameless agent degrades every other member's experience, so the only permanent exit is setting a name",
        completeAccountSetup:
          '(name: string, password: string): the whole of first-run setup — creates the agent, then publishes the name and picture, then lets the app appear',
        fetchProfile: "(did: string): fetches and caches an agent's profile from their public dataset",
        updateOwnProfile:
          '(fields: { firstName?, lastName?, handle?, bio? }): updates own profile text fields and publishes to the public dataset',
        updateProfileImage:
          '(field: "avatar" | "coverImage", imageFile: File): uploads the image and publishes its expression URL to the public dataset',
        clearProfileImage: '(field: "avatar" | "coverImage"): removes that image from the published profile',
        updateOwnLocation:
          '(update: { latitude?, longitude?, city?, country?, countryCode? }): merges the location update into the cache and publishes to the public dataset',
      },
    },
    routeStore: {
      state: {
        currentPath: 'string (the current route path)',
        segments: 'string[] (currentPath split by "/", e.g. ["/foo/bar"] → ["foo", "bar"])',
        templateSegments:
          'string[] — the segments BELOW the space prefix, which is a template\'s own coordinate space. A template mounted at /space/<id> reading its own route params wants this: at /space/abc/photo/xyz it is ["photo", "xyz"], so a `/photo/:postId` route reads templateSegments[1] and keeps reading it wherever the host mounts the template. Reading `segments` by index pins a template to the host\'s prefix and breaks when it moves.',
        params:
          "Record<string, string> — the URL's query parameters, reactive; read one as { $: 'routeStore.params.<name>' }. Prefer $localState with syncParam for fields a view owns; read params directly only for parameters something else writes",
      },
      actions: {
        navigate:
          "(to: string, options?): navigates to a route (a bare path restores that route's remembered query string)",
        setParam:
          '(name: string, value: string | null, options?: { push?: boolean }): writes one query parameter (null removes); replaceState by default, push: true for changes that deserve a Back entry. Prefer $localState syncParam over calling this directly',
        back: "(): goes back one entry, the browser's own way. Use it on a page reached from several places — a record page is opened from a list, from a search and from a link somebody sent, and only one of those has a parent worth guessing. Does nothing at the start of the session's history",
      },
    },
    themeStore: {
      state: {
        builtInThemes: 'array of ThemeData objects — built-in registry themes (origin: "built-in", always available)',
        automaticThemes:
          'array of ThemeData objects — modes that *resolve to* a theme rather than being one, currently just "Follow system". Listed separately because they carry no parameters: the id is answered at the point of use (by asking the OS) and resolves to one of the built-ins. Render them under their own heading, after the themes',
        installedThemes:
          'array of ThemeData objects — user-installed themes from root perspective (origin: "custom" | "marketplace")',
        spaceThemes: 'array of ThemeData objects — themes stored in the current space perspective (origin: "custom")',
        allThemes:
          'array of ThemeData objects — union of builtInThemes + visible installedThemes + spaceThemes (hidden themes filtered out)',
        currentThemeId: 'string — id of the currently active theme',
        currentTheme: 'ThemeData — the currently active theme object (id, name, icon, origin)',
        defaultThemeId:
          "string — id of the user's preferred default theme (used for bootscreen, shell, and future space-override). Persisted to AgentSettings.defaultThemeId",
        operationLoading:
          "string | null — the id of the theme operation currently in flight, namespaced by kind (e.g. 'marketplace-install:<themeId>'), or null when idle. A key rather than a boolean so one row's spinner does not appear on every row — compare it against the row you are rendering",
        themeManagementList:
          'ThemeManagementItem[] — flat list of all themes (built-in + all custom) with management metadata (id, name, icon, isBuiltIn, isInstalled, isDefault)',
        themeScope:
          "'global' | 'scoped' — what actually applies right now: the theme editor's session preview if one is active, else the agent's preference",
        themeScopePreference: "'global' | 'scoped' — the agent's persisted choice",
        themeScopeGlobal: 'boolean — the preference as a boolean, for a switch to bind to',
        themeScopePreviewing:
          'boolean — a theme being edited is previewing a different scope, so the preference is temporarily masked. Worth saying so beside the setting',
        editingTheme:
          'EditingTheme | null — the theme being edited (id, name, icon, overrides, css, basePreset) or null when no theme editing session is open. Its non-nullness is what mounts the theme editor',
        focusedRole:
          "string — the kebab-case role the theme editor should scroll to ('surface-sunken'), or empty. Set by whatever sent somebody to the panel — the inspector's role readout — and re-announced on every set, so pressing the same chip twice scrolls twice",
        systemThemes:
          "{ light, dark, resolved } — which two themes 'Follow system' chooses between. light/dark are the ids as chosen, empty for a side left at the built-in; resolved is 'light' | 'dark', whichever the OS is asking for now",
        systemThemeOptions:
          '{ label, value }[] — options for either side of the Follow-system pair, with a "Built-in" entry a schema could not prepend itself',
        templateThemePending:
          "boolean — the template's suggested theme cannot be resolved yet and might still arrive. Hold what is on screen rather than painting a fallback while it is true",
        useTemplateTheme:
          'boolean — whether a template may bring the theme it was designed for (meta.themeId). Defaults on; one condition in the resolver rather than a setting to unwind, so turning it off restores whatever would otherwise apply immediately',
        activeTemplateTheme:
          "ThemeData | null — the theme the scoped template wrapper renders: the theme being edited if there is one, else the space's. Null in global mode, where the template inherits the document's theme",
      },
      actions: {
        setCurrentTheme: '(themeId: string): sets and persists the active theme',
        focusRole:
          '(role: string): asks the theme editor to reveal a role, kebab-case as a schema spells it. Pair with editorStore.openThemePanel so there is a panel to scroll',
        setSystemTheme:
          "(polarity: 'light' | 'dark', themeId: string): sets one side of the Follow-system pair. An empty id returns that side to the built-in",
        setUseTemplateTheme:
          '(enabled: boolean): persists whether templates may bring their own theme. Boolean, so a switch can pass `event.detail` bare',
        startEditing:
          '(themeId?: string): opens a theme editing session on that theme, or on the current one. Prefer editorStore.enterThemeEditing, which also opens the panel',
        changeBasePreset:
          "(preset: string | undefined): while editing, swaps the base preset the theme builds on — takes its polarity and lightness range and repopulates the controls from the preset's computed CSS",
        updateEditingOverrides:
          '(overrides: Partial<ThemeOverrides>): while editing, merges parameter changes (hues, saturation, lightness range, role pins) into the draft. Applied live',
        updateEditingCss: '(css: string): while editing, replaces the draft’s raw CSS layer. Applied live',
        updateEditingMeta: '(fields: { name?, icon? }): while editing, renames or re-icons the draft',
        cancelEditing:
          '(): ends the editing session and discards the draft, restoring what was applied before. Note the theme *panel* autosaves on unmount, so closing the panel keeps the draft — this is the explicit throw-away, and the only path that does',
        createAndStartEditing:
          "(name: string, icon: string, sourceId?: string, destination?: 'personal' | 'space'): creates a new theme — copied from sourceId when given — and opens an editing session on it. Resolves true on success",
        saveEditingTheme:
          '(): writes the draft over the theme being edited and keeps editing. Resolves to the saved theme, or null when nothing was being edited',
        saveEditingThemeAs:
          '(name: string, icon: string): writes the draft as a new theme under that name, leaving the original untouched',
        deleteMarketplaceTheme:
          '(themeId: string): removes a theme this agent published from the marketplace. Only its author may',
        publishToMarketplace:
          '(options: { name, description, icon?, slug?, screenshots: File[] }): publishes the current theme to the marketplace under those details. Resolves true on success',
        publishToSpace:
          '(perspectiveUuid: string, spaceName: string): copies the current theme into that space, so its members get it. Resolves true on success',
        refreshSpaceThemes:
          "(): re-reads the current space's themes. The list follows the space on its own; call this after a publish the subscription might have missed",
        setDefaultTheme:
          '(themeId: string): sets the preferred default theme (persists to AgentSettings.defaultThemeId)',
        setThemeScopeGlobal:
          "(global: boolean): persists whether a space's theme covers the whole window (true) or only the space's own content (false, the default). Takes a boolean because a switch emits one; an expression over event in the args is evaluated when the switch fires, so pass `event.detail` bare",
        previewThemeScope:
          "(scope: 'global' | 'scoped' | null): previews a scope for the current theme-editing session without writing the preference; null drops the preview. Cleared when editing ends",
        setThemeInstalled:
          '(themeId: string, visible: boolean): shows or hides a custom theme in the pickers; does not delete it. Takes the value rather than toggling, so a `we-switch` can pass `event.detail` straight through',
        installFromMarketplace:
          '(marketplaceThemeId: string): installs a marketplace theme into your own library (installedThemes). A personal act — use installToSpace to give the community a theme',
        installToSpace:
          '(marketplaceThemeId: string): copies a marketplace theme into the current space, so every member of that community gets it. The counterpart to templateStore.installToSpace. Pair with themeStore.operationLoading to show progress on the row being installed',
        uninstallTheme: '(themeId: string): removes an installed theme (deletes the model)',
        deleteTheme: '(themeId: string): permanently deletes a custom theme',
      },
    },
    templateStore: {
      state: {
        personalTemplates:
          "array of TemplateSchema objects — core templates plus user's installed custom templates (excludes space templates)",
        spaceTemplates: 'array of TemplateSchema objects — templates loaded from the current space perspective',
        pendingInstall:
          'the template an install dialog is showing ({ marketplaceId, destination, name, icon, version, capabilities, blocked }), or null when none is open. `capabilities` is already in the words a person reads. Host chrome renders it: a dialog vouching for a template must not be drawn by a template',
        builtInTemplates: 'array of TemplateSchema objects — built-in system templates (always available)',
        myTemplates:
          "array of TemplateSchema objects — user's installed custom templates only (excludes built-in and space templates)",
        allTemplates: 'array of TemplateSchema objects — union of built-in + personal + space templates',
        currentTemplate: 'TemplateSchema (the active template)',
        templateManagementList:
          'TemplateManagementItem[] — flat list of all templates with management metadata (id, name, icon, description, isBuiltIn, isInstalled, isDefault)',
        switcherGroups:
          'TemplateSwitcherGroup[] — pre-grouped flat items for the template switcher UI; each group has { label: string, items: { id, name, icon, editable }[] }. Groups: "Space templates", "My templates", "Built-in". Use filter(group.items, { name: { contains: local.search } }) for search since items have a flat name field. `editable` says whether editing THAT row would open a session that can be saved — gate a per-row edit control on it rather than on editorStore.isReadOnly, which answers for whichever template is currently rendered and so gives every row the same verdict.',
        currentSwitcherId:
          "string — the id the template switcher should show as selected. The switcher's own spelling of the current template: it differs from currentTemplate.id while a space override or a preview is in effect",
        loading: 'boolean — the template lists are still being read. Gate empty states on it',
        defaultTemplateId:
          "string — id of the agent's preferred default template, used where no space or override decides. Persisted to AgentSettings.defaultTemplateId",
        operationLoading:
          "string | null — the id of the template operation in flight, namespaced by kind ('marketplace-install:<id>', 'space-install:<id>'), or null. A key rather than a boolean so one row's spinner does not appear on every row",
      },
      actions: {
        deleteTemplate: '(templateId: string): permanently deletes a custom template from the library',
        installTemplate: '(templateId: string): marks an installed custom template visible in the pickers',
        uninstallTemplate:
          '(templateId: string): hides a custom template from the pickers without deleting it. The counterpart of installTemplate',
        installFromMarketplace:
          '(marketplaceTemplateId: string): copies a marketplace template into your own library. A personal act — use installToSpace to give the community a template. Asks first: the template is fetched and inspected, and the host raises a dialog naming what it will be able to do. Nothing is written until that is confirmed, so treat this as "start an install", not "install"',
        confirmInstall:
          '(): installs what the dialog is showing. Host chrome only, for the same reason pendingInstall is: a template able to call this is the disclosure being skipped',
        cancelInstall: '(): closes the install dialog without installing',

        toggleInstalled:
          '(templateId: string): installs or uninstalls by id — what the settings list’s switch calls. Prefer installTemplate/uninstallTemplate where the switch can pass its value',
        setDefaultTemplate:
          "(templateId: string): sets the agent's preferred default template (persists to AgentSettings.defaultTemplateId)",
        saveTemplateAs:
          "(schema: TemplateSchema, destination?: 'root' | 'space'): saves a schema as a new template in your library or in the current space. Resolves true on success. The editor's fork path; prefer editorStore.startFork from chrome",
        publishToSpace:
          '(perspectiveUuid: string, spaceName: string): copies the current template into that space, so its members get it. Resolves true on success',
        deleteMarketplaceTemplate:
          '(templateId: string): removes a template this agent published from the marketplace. Only its author may',
        publishToMarketplace:
          '(options: { name, description, icon?, themeId?, slug?, screenshots: File[] }): publishes the current template to the marketplace under those details. Resolves true on success',
        refreshSpaceTemplates:
          "(): re-reads the current space's templates. The list follows the space on its own; call this after a publish the subscription might have missed",
        switchTemplate: '(newTemplateId: string): switches to another template',
        removeTemplate: '(): removes the current template',
        saveTemplate: '(name: string): saves the current template',
        installToSpace:
          '(marketplaceTemplateId: string): copies a marketplace template into the current space, so every member of that community gets it — as opposed to installing it for yourself. Asks first, exactly as installFromMarketplace does. Pair with templateStore.operationLoading to show progress on the row being installed',
      },
    },
    spaceStore: {
      state: {
        mySpaces: 'array of Space objects — every space the agent holds, across all joined datasets',
        spaceViews:
          "ResolvedView[] — this space's sections resolved: which view renders at which segment, in the space's order, each carrying its schema. The host builds the route tree from it; a nav strip reads viewNav, which is this without the payload",
        routableViews:
          'ResolvedView[] — every view that could render here, at its permanent segment — what routes are built from. Separate from spaceViews because it changes when a view is installed, not when a switch is flicked',
        enabledViewIds:
          "string[] — ids of the sections the community has turned on here. What a route body is gated on; not the nav list, which also drops this agent's hidden ones — hiding a section for yourself must not make its URL refuse you",
        viewNav:
          '{ id, segment, label, icon, path }[] — the sections as a nav strip reads them: enabled by the community, minus those this agent hid, in order. One source with the routes, so nav and routes cannot disagree',
        mutedDids:
          "string[] — DIDs this agent has muted, everywhere. Private, held in the root dataset. A feed filters on it before rendering: { $: '!(post.author in spaceStore.mutedDids)' }. Hides on this screen only — a neighbourhood is writable by every member, so nothing here removes anything for anyone else",
        mutedAgents:
          'MutedAgent[] — the full mute records (did, description), for a settings list that wants the note as well as the DID',
        readMarkers:
          '{ nodeId, lastReadAt }[] — when this agent last read each node. No row means never read, so everything is unread. Read with find(spaceStore.readMarkers, { nodeId: item.id }); a keyed map would not be indexable by a row',
        unreadNodeIds:
          "string[] — ids of the containers in this space holding something newer than this agent's marker for them, or never read. What an unread dot reads: { $: 'channel.id in spaceStore.unreadNodeIds' }. Ids rather than counts, since a count needs every child's timestamp",
        myMentions:
          '{ id, author, createdAt }[] — nodes in this space that mention this agent, newest first. createdAt is the backend’s comparable timestamp. Filtered client-side, so right for a space and wrong for an inbox across many',
        autoInterpret:
          'boolean — whether this space has calls interpreted (extracted into records) as they happen. A community decision, off by default. Readable by every member; writing it is space-settings',
        spaceModuleSettings:
          "SettingRow[] — what each capability that declares settings is set to FOR THIS COMMUNITY, as rows a screen renders directly: { group, groupLabel, key, label, description, type, options, value, source, set, locked, lockedBy }. `value` is already resolved across every level that had an opinion; `source` names the level that decided it ('default' when nobody did); `set` says whether THIS level holds an opinion, so a reset has something to undo; `locked` says a level that BINDS this one has forced it and the control must be disabled rather than springing back — a member's private refusal does not bind the community, so it never locks this list. Built from what modules declare, so a module that adds a setting gets a control with nothing to register",
        myModuleSettings:
          'SettingRow[] — the same rows, for what THIS AGENT has decided in THIS space. Private, held in the root dataset. The most specific of the four levels',
        agentModuleSettings:
          'SettingRow[] — the same rows, for what THIS AGENT has decided everywhere. Private. Render it in global settings, where the question is what you want in every space',
        extractionTargets:
          "string[] — the models a call in this space starts out extracting. The middle of three layers: shapeStore.extractionCandidates says what COULD be extracted, this says which of them a call begins with, and the call's own participants add or remove from there (modules.transcribe.extractionTargets). Unset falls back to the two classes that were hardcoded before the setting existed, so no space silently stops extracting. Writing it is space-settings",
        shareExtractionDetail:
          'boolean — whether extraction passes in this space broadcast their prompt and response to every member, so interpretationStore.activity rows carry detail for everyone. A community decision, off by default',
        personalSpaces: 'array of Space objects (local/personal spaces; all Space fields)',
        sharedSpaces: 'array of Space objects (shared/neighbourhood spaces; all Space fields)',
        spacePath:
          "string — the path a space's own pages hang off (`/space/<segment>`), empty outside a space. What a link to one record is built from: an href has to be absolute, since a browser resolves a relative one against the current URL rather than against the route tree, and the segment is the neighbourhood CID for a shared space and the dataset id for a personal one — only the URL says which",
        routeSpaceUnjoined:
          'boolean — the current route points at a space this agent has not joined, as a settled fact. What a join gate should read: `currentDataset` being null is also true for the first frames of a refresh, so gating on that flashes a join prompt at someone already inside. False while the answer is still unknown',
        spaceList:
          "{ uuid, name, description, avatar, kind: 'shared' | 'personal' | 'foreign', isWeSpace, canAdminister }[] — one row per joined dataset the agent can act on, ordered like the sidebar and excluding the system datasets. Includes datasets that are not WE spaces (kind 'foreign', isWeSpace false), which are waiting to be initialized. `uuid` is the dataset id, so it keys navigation and settings whether or not a Space record exists",
        creatingSpace: 'boolean (true while a new space is being created)',
        joiningSpace:
          "string — the shared id of the space a join is running for, '' when none is. The id rather than a flag so a list can spin only the row being joined; a gate compares it against its own route segment. Stays set for the whole join, which outlives the network call that starts it",
        joinSlow:
          'boolean — that join has been going long enough to be worth mentioning. Joining a shared space has to fetch and install it before it exists anywhere, so a first join routinely takes a minute; pair with joiningSpace to say so instead of spinning in silence',
        joinError:
          '{ spaceId, message } | null — the last join failure, ready to display. Carries the space so a gate can tell whether the failure is its own: compare joinError.spaceId against the route segment, or a bare message follows the user to the next unjoined space they open',
        orderedSidebarItems:
          'array of sidebar items in user-defined order (uuid, name, avatar, spaceId) — personal + shared spaces merged',
        memberDids: 'string[] — DIDs of all members in the current space (includes own DID)',
        members: 'AgentProfileSummary[] — cached profiles for all memberDids',
        spaceDefaultTemplateId:
          "string — the current space's default template ID (empty string when no space is active)",
        spaceDefaultThemeId:
          "string — the current space's default theme ID (empty string when no space is active). The counterpart to spaceDefaultTemplateId; compare against it to mark which theme a space is currently on",
        currentSpace:
          'Space | null — the current space model (all Space fields: uuid, url, name, description, access, discovery, avatar, coverImage, defaultTemplateId, defaultThemeId, location, plus id/author/createdAt)',
        foreignSpacePrefill:
          '{ name, description, avatar } | null — detected from a foreign app\'s own model (e.g. Flux\'s Community) for prefilling the "Initialize as WE space" gate; null once the perspective is a WE space or no recognized foreign model is found',
        enabledModules:
          'string[] — ids of the feature modules THIS SPACE has turned on: the community\u2019s decision, shared with every member. An unset value means "not decided", not "none": it falls back to every registered module, so spaces predating the setting keep the chrome they had',
        installedModules:
          'string[] — ids of the feature modules THIS AGENT wants available anywhere. Personal, held in the root dataset; unset means "not decided" and falls back to every registered module',
        templateOverrideOptions:
          '{ label, value }[] — options for the per-space template override picker: "Use the space\u2019s default" (space-default), "Use my default" (agent-default), then every template. Each of the first two names what it resolves to. Pre-built because a schema can map a store array into options but cannot prepend one, and without those entries overriding would be one-way',
        themeOverrideOptions: '{ label, value }[] — the same, for themes',
        canAdministerCurrentSpace:
          'boolean — whether this agent may change what every member of the space on screen sees. The readable form of canAdministerSpace, which an expression cannot call. Gate an admin-only control on this rather than on `x.author == me.did`, which asks who made the row and not who runs the space',
        spaceThemePinned:
          'boolean — this agent has pinned a theme for the space on screen that differs from what would otherwise apply, so there is something for a reset to undo. False outside a space, and false for a pin that happens to name what the space resolves to anyway. Gate a "pinned here / reset" affordance on it rather than on the pin merely existing',
        requiredModules:
          'string[] — module ids the template on screen mounts components from, derived by walking the schema rather than read from meta.components (which no template fills in). What makes uninstalling a capability module refusable',
        missingModules:
          'string[] — of those, the ones this agent has not installed. Non-empty means the template is mounting a component nothing provides, so part of the page silently renders nothing. Empty in the ordinary case',
        activeModules:
          'string[] — what actually renders here for this agent: registered \u2229 installed \u2229 enabled, less the modules muted in this space. Module chrome and the launcher rail gate on this; enabledModules alone is not sufficient',
        moduleInstallSettings:
          "{ id, name, description, icon, installed, surface, switchable }[] — every registered module and whether this agent wants it anywhere. The global Settings → Modules list, and the only place an 'app' or 'capability' module is decided about: a contribution is gated at the layer where it renders, and only 'chrome' renders inside a space. `surface` is derived from what the module contributes. Its per-space counterpart is `modules` on each spaceList row, which carries enabled/installed/visible/active together and lists chrome modules only",
        moduleLaunchers:
          '{ id, icon, label, active }[] — launchers for the modules enabled here and available in this space; what the host module rail renders. Pair with { $action: "spaceStore.launchModule", args: [{ $: "mod.id" }] }',
      },
      actions: {
        moveChild:
          '(childId: string, fromId: string, toId: string): moves a child between two collections — a card between kanban columns. Relinks the two children edges; the child itself is untouched',
        setAttending:
          "(nodeId: string, attending: boolean): joins or leaves a node's participant roster — an RSVP. Writes only this agent's own entry, so the roster stays conflict-free. Boolean, so a switch can pass `event.detail` bare",
        setAgentMuted:
          '(did: string, muted: boolean, description?: string): mutes or unmutes an agent for this agent everywhere, with an optional note. Positively phrased so a switch can pass `event.detail` bare',
        markRead:
          '(nodeId: string, spaceUuid?): marks a node read as of now, so it leaves unreadNodeIds. Silent on failure — a lost marker is a stale dot, not an error',
        setAutoInterpret:
          '(enabled: boolean, spaceUuid?): turns automatic call interpretation on or off for a space. Omit spaceUuid for the space on screen',
        autoInterpretForCall:
          "(collectionId): whether ONE CALL is extracted as it happens — its participants' answer if they gave one, else the space's. A function rather than a value because the answer is per call, like canAdministerSpace",
        setAutoInterpretForCall:
          "(collectionId, on) => turns automatic extraction on or off for ONE CALL, for everyone in it. A participant's decision, unlike setAutoInterpret, which administers the space — and it leaves the space's default alone. Does not stop a pass already running: those tokens are spent",
        setSpaceModuleSetting:
          "(group: string, key: string, value?, spaceUuid?): sets one of a capability's settings for everyone in a space — `group` is the module id and `key` the setting's key, both off the row. **Omit `value` to clear it**, which returns the level to having no opinion: a stored value that happens to equal the default goes on overruling everything less specific while its control reads as untouched. Omit spaceUuid for the space on screen",
        setMyModuleSetting:
          '(group: string, key: string, value?, spaceUuid?): the same, for this agent in one space. Private — written to the root dataset, never to the space. Omitting `value` clears it',
        setAgentModuleSetting:
          '(group: string, key: string, value?): the same, for this agent in every space. Private, and global, so there is no space to name. Omitting `value` clears it',
        setShareExtractionDetail:
          '(enabled: boolean, spaceUuid?): turns broadcasting of extraction prompts and responses on or off for a space. Omit spaceUuid for the space on screen',
        setExtractionTarget:
          "(entity: string, on: boolean, spaceUuid?): adds or removes one model from what this space's calls start out extracting. Writes the resolved list, so the first toggle also pins whatever was on by fallback. The community's decision; a call's participants override it per call",
        setViewEnabled:
          '(viewId: string, enabled: boolean, spaceUuid?): adds or removes a section from a space. The community’s decision — every member sees it. Omit spaceUuid for the space on screen',
        reorderViews:
          "(viewIds: string[], spaceUuid?): sets the whole section order at once — what a drag-reorder writes. Pair with we-sortable's onReorder",
        setViewVisible:
          '(viewId: string, visible: boolean, spaceUuid?): shows or hides a section for this agent in one space, without changing what the community has. Private. Positively phrased so a switch can pass `event.detail` bare',
        createRelationshipType:
          '(config: Partial<RelationshipType>): names a kind of connection this community makes — "contradicts", "came out of". The counterpart to createSignalType; slug derived from name if blank',
        removeSpaceFromGlobal:
          "(spaceUuid: string): withdraws a space's listing from the global discovery space, leaving the space itself alone. Only its author may; removeSpace does this for you",
        createSpace:
          "(name, description, access: 'personal' | 'shared', discovery: 'hidden' | 'listed', avatarFile?, coverImageFile?, location?): creates a new space with full setup",
        joinSpace:
          '(id: string, focus = true): joins a shared space by share link, neighbourhood URL or CID, or focuses it if already joined. Pass focus: false to join without navigating there — for a caller that needs the dataset present rather than open, which is how the marketplace reads its own dataset without moving you out of the space you are in. Rejects when the join could not be completed, so onSuccess means what it says; watch joiningSpace/joinSlow/joinError for what to show while it runs. A join whose network call times out keeps going: the backend usually finishes anyway, and this waits for that before believing the failure',
        initializeAsWeSpace:
          "(name: string, description: string, avatarValue?: File | string | null): installs WE's Space SDNA into the current, already-joined, foreign-native dataset (e.g. one synced in from Flux) and creates a Space entity in place — access is always 'shared' since the dataset is already a published neighbourhood",
        removeSpace:
          '(uuid: string): removes a space — clears its global-discovery listing (when authored by this agent) and removes the backing dataset',
        createPost: '(editorState: unknown): creates a new post',
        updatePost:
          '(postId: string, editorState: unknown): reconciles an edited post against its existing blocks — updates/reuses blocks whose id survived the edit, creates new ones, deletes ones no longer present',
        deleteCollection:
          '(collectionId: string): permanently deletes a CollectionBlock and everything inside it, recursively. Kind-agnostic — a post, a call record and a notes collection are the same shape, so this is the one delete for all of them',
        updateSpaceImage:
          '(field: "avatar" | "coverImage", imageFile: File, spaceUuid?): uploads and sets the space avatar or cover image',
        createSignalType:
          '(config: Partial<SignalType>): creates a new signal type in the community; slug auto-derived from name if blank',
        setSignalTypeRetired:
          '(signalTypeId: string, retired: boolean): withdraws a signal type from use, or brings it back. Never deletes the signals given with it — a signal names its type by record id while templates resolve it by slug, so DELETING a type strands every reaction ever given and re-creating one with the same slug does not restore them. Retiring is the reversible version: the type stops being offered, existing counts keep working, and un-retiring brings everything back. Filter the offered list with OFFERED_SIGNAL_TYPES from @we/template-kit; leave find()-by-slug unfiltered so history still resolves',
        unreadNodeIds:
          'string[] — ids of containers in this space holding something newer than your read marker. The read side of `ReadMarker`: use it for unread dots with `{ "$": "channel.id in spaceStore.unreadNodeIds" }` rather than recomputing a `$latestChild` projection and a comparison per row',
        myMentions:
          '{ id, author, createdAt }[] — nodes in this space that name you, newest first. The read side of `WeNode.mentions`, which the composer writes from the @mentions in a post',
        uploadFile:
          '(file: File, name?: string): stores a file and returns the URL to reference it by, or null. Images are compressed on the way through. For a template doing its own media UI — without it, only the block composer could accept an upload',
        upsertSignal:
          '(nodeId: string, signalTypeId: string, value: number): adds or updates a signal on a node; value=0 deletes it',
        navigateToSpace:
          '(spaceId: string, view?: string): navigates to a space — accepts a perspective UUID or a neighbourhood CID (sharedUrl without the neighbourhood:// prefix); pre-loads space templates before switching so the template and data arrive together',
        openRecordRef:
          "(ref: string): goes to whatever a record reference names — the space, and the record's own page within it. Takes the whole `we:…` reference rather than its parts, so nothing outside the host restates where a record's page lives. A reference naming only a dataset opens the space; a relative one (`we:./…`) resolves against the space on screen; a person has no page, so nothing happens",
        updateSpaceMeta:
          '(updates: { name?, description?, discovery?, location? }, spaceUuid?): updates the space everyone sees. Omit spaceUuid to target the space on screen; pass one to configure a space from the spaces list without navigating to it',
        setSpaceDefaultTemplate:
          '(templateId: string, spaceUuid?): sets the template members see when they enter that space. Only repaints the app when the target is the space currently on screen',
        setSpaceDefaultTheme: '(themeId: string, spaceUuid?): sets the theme members see when they enter that space',
        copyShareLink:
          "(uuid: string): copies that space's share link to the clipboard, with a toast either way. No-op for a personal space, which has no global id and so no shareable link — read `spaceList[].shareLink` to decide whether to offer the control at all",
        copyGuestLink:
          "(uuid: string): copies that space's guest invite link — a URL that creates an account on the space's host and joins, with no sign-up and no download. Empty, and the control hidden, unless BOTH this app's origin and the node's URL are addresses a recipient could reach: a loopback address on either half resolves to the reader's own machine. Read `spaceList[].guestLink` to decide whether to offer it; `shareLink` is the one for somebody who already has WE",
        canAdministerSpace:
          '(uuid: string): whether this agent may change what every member of that space sees — true for a personal space, and for a shared one they authored. A UI affordance for deciding whether to offer the controls, NOT enforcement: a shared space is a neighbourhood every member can write to. Ask by name rather than comparing author to me.did, so the answer can grow (multiple admins, roles) without every template changing',
        getSubgroupMessages:
          "(subgroupId: string): messages belonging to one of Flux's conversation subgroups, fetched on demand. A dialect query against a foreign schema rather than a WE model, so it goes through the backend's interop surface instead of $query — which is why it is a store method and not a relation you can drill into",
        exportCallTranscript:
          "(callId: string): writes the call's transcript to a .txt file (one line per utterance: name, timestamp, text) and downloads it. Read-only and client-side — it reads the shared record and writes to the caller's own device",
        setModuleInstalled:
          '(moduleId: string, installed: boolean): turns a module on or off for this agent in every space. Personal — writes AgentSettings.installedModules in the root dataset, so no other member sees it',
        setModuleVisible:
          '(moduleId: string, visible: boolean, spaceUuid?): shows or hides a module for this agent in one space, without changing what the community runs. Private: written to the root dataset, never to the space. Phrased positively so a switch can pass `event.detail` bare \u2014 wrapping it in another token would evaluate at render time and send a constant',
        setSpaceTemplateOverride:
          "(templateId: string, spaceUuid?): sets the template THIS AGENT sees in one space, overriding the community's default. Three values: 'space-default' follows the space, 'agent-default' follows your own global default (tracking later changes to it), or a concrete template id pins that one. Private, and applied immediately when that space is the one on screen. The sentinels are named values rather than '' because they are three distinct meanings, and only one of them is no value at all",
        setSpaceThemeOverride:
          '(themeId: string, spaceUuid?): sets the theme THIS AGENT sees in one space. Same three values as setSpaceTemplateOverride. Private',
        applyTheme:
          '(themeId: string): applies a theme where the agent is — pinned to the space on screen, or set as their global default when there is no space. What a theme picker in chrome should call: it persists, where setCurrentTheme only sets a signal that the next resolution overwrites. Which of the two it does is decided at click time, against state a schema cannot see',
        clearSpaceThemePin:
          '(): drops this agent\u2019s theme pin for the space on screen, returning it to whatever would otherwise apply. The way back out of applyTheme, so the picker need not spell the FOLLOW_SPACE sentinel as a literal. Pair with spaceThemePinned',
        setModuleEnabled:
          '(moduleId: string, enabled: boolean, spaceUuid?): turns a feature module on or off for a space; writes the resolved list, so the first toggle also pins whatever was on by fallback. Omit spaceUuid for the space on screen',
        launchModule:
          "(moduleId: string): invokes that module's declared launcher action. Takes an id rather than a path because $action resolves a literal string, so a rail iterating over modules cannot build modules.<id>.<method> itself",
      },
    },
    recordStore: {
      state: {
        creatableEntities:
          "{ label, value, icon, group }[] — models a person can create an instance of here, ready for a we-select: this space's own models first, then WE's built-in content types. A model appears here by declaring `authoring` in the manifest, or by being a shape this community defined",
        displays:
          "Record<entity, RecordDisplay> — how to show an instance of each creatable model, keyed by entity name and derived from its declaration: { entity, label, icon, title, summary, media, fields[] }, where title/summary/media name the properties playing those roles ('' when none does) and each field is { name, label, kind, role }. kind is one of text, longText, number, boolean, date, datetime, color, url, image, file, json; role is title, summary, media or detail. Index it by a row's type — { $: 'recordStore.displays[row.type]' } — and render the fields with $each; see \"A record of any type\" in the patterns",
        recordDraft:
          "the open form's draft ({ entity, label, icon, fields[] }) or null while closed — its non-nullness is what mounts the modal. Each field is { name, label, control, required, options, placeholder, value }, derived from the model's own declaration, so a form exists for a model nobody wrote a form for",
        recordDraftDirty:
          "boolean — the open form holds something worth keeping. What a discard guard reads: the fields come from the model, so a shape this community defined has properties no schema was written against and there is no set of local names an expression could test. Pass it to discardGuard's `dirty`",
        recordErrors: 'string[] — validation errors from the last save attempt, plus any backend failure',
        savingRecord: 'boolean — a create is in flight',
        lastCreatedId:
          "string — the id of the last record created, empty before the first. Read it to act on what was just made; kept in the store because an $action's onSuccess can read a store and cannot hold a value",
        pendingLink:
          'the two records a pending connection joins ({ sourceId, sourceType, sourceLabel, targetId, targetType, targetLabel }), or null when the open form is an ordinary one. Read it to name what is being connected',
        relationshipKind:
          'string — which named RelationshipType the pending connection is, or empty for one carrying only a label. Held beside the draft because the kinds are a list to pick from, which a generated form cannot render',
      },
      actions: {
        setRelationshipKind: '(id): sets which named kind the pending connection is; an empty value clears it',
        placeOnBoard:
          '(board: string, nodeId: string, nodeType: string, x: number, y: number): puts a record at a position on a board, or moves one already there. An upsert, so dragging twice leaves one coordinate. Pair with the graph’s onNodeDragEnd',
        removeFromBoard:
          '(board: string, nodeId: string): takes a record off a board, leaving the record itself alone. A card the board owns survives as an unplaced one in the tray',
        resizeOnBoard:
          "(board: string, payload): resizes a card on a board. Takes the graph's onNodeResize payload as it arrives; the size lives on the placement, so the same post on another board is unaffected",
        setCardStyle:
          "(board: string, nodeId: string, field: string, value): sets one presentation property of one card on one board — 'color', 'cardShape', 'contentScale'. Takes the field name so one action serves a swatch, a picker and a slider. Undone by taking the card off the board",
        previewCardStyle:
          '(nodeId: string, field: string, value): shows a presentation change without writing it — for a slider that reports while it moves. Pair with setCardStyle on release; both go through the same pending map so the card never jumps',
        setTypeColor:
          "(board: string, nodeType: string, color): sets the colour every card of one type is drawn in, on one board — the board's key, made writable. An empty colour clears it",
        createOnBoard:
          '(board: string, x?: number, y?: number): opens the create form and places whatever it makes onto that board, at the point given. Pair with the graph’s onCanvasDoubleClick',
        createCardOnBoard:
          "(editorState, { board, at? }): composes a card onto a board and records where it sits, as one write. Without `at` the card lands in the board's tray. The composer's counterpart to createOnBoard",
        openRecordForm:
          '(entity?): opens the create form — on that model, or on the first offered one. Clears any pending connection',
        connectNodes:
          "(link): opens the form on a Relationship joining two records. Takes the graph's onEdgeCreate payload as it arrives",
        setRecordEntity: '(entity): switches which model is being created, discarding what was typed',
        setRecordField:
          '(name, value): sets one field. Takes the field name, so one action serves every control — which is the only shape that works when the fields come from data',
        cancelRecordForm: '(): closes the form, discarding it',
        saveRecord:
          '(): validates and creates. Errors land in recordErrors and the form stays open holding what was typed; success closes it and sets lastCreatedId',
      },
    },

    shapeStore: {
      state: {
        spaceShapes:
          'SpaceShapeView[] — the content models THIS SPACE defines (id, name, description, icon, shapeId, version, forkedFrom, propertyCount, problems). A shape with a non-empty problems array failed validation or adoption and its entity is not queryable; render the problems rather than hiding the row',
        shapesLoaded:
          'boolean — the space has been asked for its shapes. An empty list is otherwise indistinguishable from "not fetched yet"; gate empty states on it',
        shapeDraft:
          "the model wizard's draft (name, description, icon, classHint, identityMember, members[]) or null while the wizard is closed — its non-nullness is what mounts the wizard modal. Each member is { rowId, kind: 'property' | 'relationship', name, … }: a property carries type/required/hint/options/defaultValue, a relationship carries target/many. Form state lives here rather than $localState because rows are structured and validated as a whole, and the LLM flow fills the same draft",
        editingShapeId: 'string | null — the Shape record being edited; null means the draft is a new model',
        draftErrors: 'string[] — wizard-facing validation errors from the last save attempt',
        savingShape: 'boolean — a save is in flight',
        aiAvailable: 'boolean — AI model generation is available (the agent has a Claude API key configured)',
        generating: 'boolean — an AI generation is in flight',
        extractionCandidates:
          "string[] — entity names an extraction pass COULD write here: core vocabulary that declares itself extractable, plus every adopted shape that does. Candidacy, not a decision — which of these a call actually looks for is two layers down (spaceStore.extractionTargets, then the call's own participants). Read it to offer a choice, and to display findings: a card should show a record somebody extracted an hour ago even if the target has since been switched off",
        extractionNeedsIdentity:
          'boolean — the open draft would be extracted into and has no field to recognise what it already wrote, so every pass duplicates everything. A warning to put beside the switch, not a refusal: the wizard saves either way',
        hintEditorDirty:
          'whether the open hint editor holds edits that closing would lose. What a discard guard reads: the rows come from the model’s declaration, so a schema has no set of local names it could test. Compares against the state the editor opened in, so an editor somebody only read closes without a question',
        hintEntities:
          "{ entity, source: 'core' | 'shape' }[] — entities offering AI-hint tuning in this space: core interpretable vocabulary (TaskBlock, EventBlock) plus the space's own shapes",
        extractionTargets:
          'string[] — entity names an AI extraction pass may write in this space: core vocabulary marked extractable (TaskBlock, EventBlock) plus every adopted shape that is. What COULD be found here, not what a given pass will look for — a call may narrow it and the space may have auto-extraction off. Drive a findings list off this rather than off any per-call selection, so a card shows a record another member extracted',
        relationshipTargets:
          "{ label, value }[] — what a relationship may point at here, ready for a we-select: this space's own models, then block types, then other apps' models. Core infrastructure entities are deliberately absent",
        identityOptions:
          '{ label, value }[] — "None" plus every named property of the open draft, for the identity picker. Built in the store because a schema can map options but cannot prepend one',
        hintEditor:
          'the hint editor state ({ entity, classHint, defaultClassHint, rows: { name, predicate, hint, defaultHint }[], customized }) or null while closed — non-nullness mounts the hint editor modal',
        hintBusy: 'boolean — the hint editor is loading or saving',
        memberOptions:
          "{ rowId, options }[] — each member's default-value picker entries. Read with find(shapeStore.memberOptions, { rowId: member.rowId }) rather than off member: rows are mutated in place while typing, so values hanging off the row cannot be reactive",
        confirmDiscard: 'boolean — the "discard this model?" confirmation is showing',
        confirmReplaceFields:
          'boolean — the "replace the fields below?" confirmation is showing. Only ever raised for a generation over hand-written rows; a generated proposal nobody touched re-runs on the click',
        generateIntent:
          "'none' | 'generate' | 'regenerate' | 'replace' — what the generate button would do right now, given what the draft holds. Label it \"Regenerate\" on 'regenerate' and 'replace' and \"Generate\" otherwise — 'none' is an empty draft, which has nothing to re-run, so testing for 'generate' alone labels a fresh form wrongly. Disable only on 'none', and route the click through requestGenerateFields, which decides whether to ask first",
        expandedMembers:
          "string[] — rowIds whose detail panel is open. Read with { $: 'member.rowId in shapeStore.expandedMembers' }; a new row and any row an error names open themselves. Generation leaves rows closed — a collapsed row shows its hint, so what was generated is readable without opening anything",
      },
      actions: {
        openShapeWizard:
          '(shapeRecordId?): opens the model wizard — empty for a new model, or pre-filled from a stored shape to edit it',
        cancelShapeWizard: '(): closes the wizard, discarding the draft',
        setShapeField: "(field: 'name' | 'description' | 'icon' | 'classHint', value): sets one top-level draft field",
        setIdentityMember:
          "(rowId): chooses which member identifies duplicates for AI extraction; 'none' clears it. At most one, which is why it is a picker rather than a per-row flag",
        setExtractable:
          '(on: boolean): allows or refuses an AI extraction pass writing instances of the open draft. Its own action rather than a setShapeField case, because the value is a boolean and that field takes strings',
        addProperty: '(): appends an empty property (scalar field) row to the draft',
        addRelationship: '(): appends an empty relationship (edge to another model) row to the draft',
        removeMember: '(rowId): removes one member row',
        setMemberField:
          "(rowId, field, value): sets one field of one member row. 'options' takes the comma-separated string as typed",
        toggleMemberExpanded: "(rowId): opens or closes one member's detail panel (hint, default, allowed values)",
        requestCloseWizard:
          "(): closes the wizard, asking first when there is work to lose. Wire the modal's own close to this so a backdrop click is guarded too",
        cancelDiscard: '(): dismisses the discard confirmation and keeps the wizard open',
        commitDraft:
          '(): publishes in-place edits to the draft signal. Typed fields are mutated without touching it so inputs keep focus, which leaves derived values stale — pair with onBlur on a field something else is computed from',
        reorderMembers:
          '(rowIds: string[]): applies a drag-reorder. Pair with we-sortable\'s onReorder and pass { $: "arg.detail" } — order is the stored declaration order, not decoration',
        replaceDraft:
          '(draft): replaces the whole draft — how the LLM flow hands a generated model to the same review path',
        generateShapeDraft:
          '(description: string): generates a draft from a plain-language description and lands it in the open wizard for review. Proposes only — nothing is stored until the user saves. Gate the control on aiAvailable',
        generateShapeFields:
          "(): generates the draft's fields from what the author actually wrote — the name, description and AI hint they typed — and answers whatever they left blank, including anything a previous run had filled in (that being the machine's own output, which would otherwise steer the next prompt and return a model half about the last subject). Replaces the member list wholesale, so call requestGenerateFields from a button instead, and this from the confirmation it raises",
        requestGenerateFields:
          "(): the generate button's own entry point — generates now, or raises confirmReplaceFields when the click would discard hand-written rows. The store makes that choice because only it can tell a proposal nobody touched from rows somebody wrote",
        cancelReplaceFields: '(): dismisses the replace confirmation, keeping the fields as they are',
        saveShapeDraft:
          '(): validates, stores and adopts the draft. Errors land in draftErrors; success closes the wizard and the new entity becomes queryable via $query in this space',
        deleteShape:
          '(shapeRecordId): removes a model definition from the space. Existing entries keep their data; only the definition goes',
        openHintEditor: '(entity): opens per-space AI-hint tuning for an entity (core or space-defined)',
        closeHintEditor:
          '(): closes the hint editor, discarding unsaved edits. Pair it with hintEditorDirty in a discardGuard rather than wiring it to a modal’s close directly',
        hintEditorDirty:
          'whether the open hint editor holds edits that closing would lose. What a discard guard reads: the rows come from the model’s declaration, so a schema has no set of local names it could test. Compares against the state the editor opened in, so an editor somebody only read closes without a question',
        setHintDraft: "(key, value): sets one hint in the open editor — key is 'class' or a property predicate",
        saveHintEditor:
          '(): writes the hints to this space and marks them customized, so schema refreshes stop reverting them',
        resetHintEditor: "(): back to the declaration's hints; release improvements flow again",
      },
    },
    editorStore: {
      state: {
        canUndo: 'boolean (true when there are schema edits that can be undone)',
        canRedo: 'boolean (true when there are undone schema edits that can be redone)',
        messages:
          "ChatMessage[] — the active AI session's messages (id, role: 'user' | 'assistant' | 'system', content, createdAt, status). Empty for a new chat",
        isOpen: 'boolean — the AI chat panel is open',
        isStreaming: 'boolean — an assistant reply is arriving; streamingContent holds what has arrived so far',
        streamingContent: 'string — the partial assistant reply while isStreaming, empty otherwise',
        apiKeyConfigured:
          'boolean — the agent has an API key set, so sendMessage can work. Gate the composer on it and say what is missing rather than hiding it',
        templateName: 'string — the name of the template being edited, for the editor’s own header',
        templateIcon: 'string — its icon',
        isReadOnly:
          "boolean — the template on screen cannot be saved in place (a built-in, or somebody else's). Edits buffer as pending changes; offer Fork rather than Save. Answers for the template rendered, so do not use it to gate per-row controls in a list — switcherGroups carries `editable` per row",
        hasPendingChanges: 'boolean — buffered edits exist against a read-only template, waiting for a fork to land in',
        pickerOpen: 'boolean — the fork/fresh naming dialog is showing',
        pickerAction: "'fork' | 'fresh' — which the open picker is for",
        pickerDefaultName: 'string — what the picker’s name field starts with',
        pickerDefaultIcon: 'string — what its icon field starts with',
        pickerShowDestination:
          'boolean — the picker offers a personal-or-space destination, which it can only do while a space is open to save into',
        sessions: "ChatSession[] — this template's saved AI sessions (id, name, templateId), newest first",
        activeSessionId: 'string | null — the session whose messages are shown',
        contentMode:
          "'preview' | 'visual' — whether the editor shows the rendered template or the visual editing surface",
        schemaJson: 'string — the template being edited, serialised — what the code panel shows and edits',
        isEditingTemplate: 'boolean — a template editing session is open',
        editAction: "'edit' | 'fork' | 'fresh' | null — how the current template session began, null outside one",
        codePanelOpen: 'boolean — the code panel is open',
        themePanelOpen: 'boolean — the theme panel is open',
        visualPanelOpen: 'boolean — the visual properties panel is open',
        isEditingTheme: 'boolean — a theme editing session is open, independently of template editing',
        aiDockEdge:
          "DockEdge — where the AI panel opens ('left' | 'right' | 'top' | 'bottom'), or null while it is closed. An opening bid: the shell remembers wherever the user drags it",
        codeDockEdge: 'DockEdge — the same, for the code panel',
        themeDockEdge: 'DockEdge — the same, for the theme panel',
        visualDockEdge: 'DockEdge — the same, for the visual panel',
        editorDockSize: "DockSize — the opening size every editor panel shares ('sm' | 'md' | 'lg' | 'full')",
        editorDockFloat: 'boolean — editor panels open floating over the content rather than pushing it aside',
      },
      actions: {
        toggle: '(): toggles the AI chat panel open/closed',
        undo: '(): undoes the last schema edit',
        redo: '(): redoes the last undone schema edit',
        open: '(): opens the AI chat panel',
        close: '(): closes it',
        newChat: '(): starts a new AI session for this template and switches to it',
        switchSession: '(sessionId: string): shows another saved session',
        deleteSession: '(sessionId: string): deletes a saved session and its messages',
        setContentMode:
          "(mode: 'preview' | 'visual'): switches the editor between the rendered preview and the visual editing surface",
        startFork: '(): opens the picker to copy the current template into one you own',
        startFresh: '(): opens the picker to start an empty template',
        confirmPicker:
          "(name: string, icon: string, destination: 'personal' | 'space'): creates the fork or fresh template and enters editing on it",
        cancelPicker: '(): closes the picker without creating anything',
        enterTemplateEditing:
          "(action?: 'edit' | 'fork' | 'fresh'): opens a template editing session on the template on screen. Omit action to edit in place; a read-only template buffers its edits",
        exitTemplateEditing: '(): ends the template session. Buffered changes to a read-only template are dropped',
        toggleCodePanel: '(): opens or closes the code panel',
        openCodePanel: '(): opens the code panel',
        closeCodePanel: '(): closes it',
        toggleThemePanel: '(): opens or closes the theme panel',
        openThemePanel: '(): opens the theme panel. Pair with themeStore.focusRole to land on a role',
        closeThemePanel: '(): closes it',
        toggleVisualPanel: '(): opens or closes the visual properties panel',
        enterThemeEditing: '(): opens a theme editing session on the current theme, and the theme panel with it',
        exitThemeEditing: '(): ends the theme session, discarding an unsaved draft',
        toggleThemeEditing: '(): enters or exits theme editing — what a single button in chrome should call',
        sendMessage:
          '(text: string): sends a message to the assistant. Patches it proposes are applied to the template and land in undo history; the reply streams into streamingContent',
        clearHistory: "(): deletes the active session's messages",
      },
    },
    shellStore: {
      state: {
        activeShellView:
          "string | null — id of the currently open shell overlay ('profile' | 'settings' | 'schema-tests' | 'landing-page'), or null",
        spaceSettingsOpen:
          'boolean — the space-settings panel is open. It configures whichever space is open, so it needs no id; bind a launcher\u2019s active state to this',
        spaceSettingsTab:
          "string — the tab the space-settings panel opens on ('about' | 'features' | 'vocabulary'). A starting position read once as the panel mounts, not a controlled value: somebody who then walks to another tab stays there. Set it by passing a tab to openSpaceSettings",
        pendingDestructive:
          "the destructive action a space template just asked for ({ path, title, body }), or null. The host raises its own confirmation in front of every one of them — a space template arrives from a stranger, so whether it asks before deleting is not the stranger's decision. Host chrome renders it; a template writing its own dialog for a destructive store action would be a second question about one click",
        layoutPinned:
          'Record<string, boolean> keyed by panel id — whether that panel has been dragged away from where meta.panels declared it. False for a panel no layout mentions, since there is nothing to go back to. Gate a "reset to layout" affordance on it rather than on a placement merely existing',
        createSpaceOpen:
          'boolean — the create-space modal is open. Shell state because more than one place opens it; bind the modal’s open prop to this and close it with setCreateSpaceOpen',
        dockGeometry:
          "Record<dockId, DockGeometry> — every registered panel's resolved box (top, left, width, height, edge, mode). Read a field as { $: \"shellStore.dockGeometry['<id>'].<field>\" } — by index, since a dock id holds a colon; the frame a panel is wrapped in binds its geometry this way so a move rewrites props rather than remounting",
        contentInset:
          '{ top, right, bottom, left } in pixels — what the content viewport gives up to panels that displace it. Read it to keep your own fixed chrome clear of docked panels',
        coveredInset:
          '{ top, right, bottom, left } in pixels — what FLOATING panels are covering. They take no room, so they leave contentInset at zero while still sitting over the content: this is the part of your own box the reader cannot see. Read it to keep something in the clear where contentInset would say there is nothing in the way',
        dockResizing:
          'boolean — a panel is being dragged or resized right now. Suspend transitions while it is true so the edge tracks the cursor',
        panelMaximised:
          "boolean — some panel covers the whole window. The app's own chrome — sidebar, module rail — hides while it is true; a template's fixed chrome should too",
        dockPlacement:
          'Record<dockId, { snap, displace, canDisplace, … }> — where each panel is parked, for its frame to read: which of the eight snaps it is at, whether it displaces content, and whether it may. The state a position menu ticks; dockGeometry is the resulting box',
        movingDock: 'string | null — the id of the panel being dragged, or null. What mounts the snap-target overlay',
        activeSnap:
          "SnapPoint | null — the snap the moving panel would take if dropped now ('top-left' | 'top' | … | 'left'), so that target can light up",
        snapTargets:
          '{ id, top, left, width, height }[] — every snap target’s box while a panel is being dragged, measured against the room left for it. Empty otherwise',
        insertSlots:
          "{ key, index, edge, lane, mode: 'band' | 'lane' | 'tab', top, left, width, height }[] — every place a dragged panel could land, while one is being dragged. 'band' offers a new lane at that distance inboard, 'lane' a new seat beside the panels in the lane it names, 'tab' the seat itself, to stack behind whatever is showing there. Empty otherwise",
        activeInsert:
          "string | null — the slot a drop would take right now, as that slot's `key`. Compare it against slot.key rather than rebuilding the string, which names four things",
        dragGhost:
          '{ top, left, width, height, title } | null — the outline following the cursor while one TAB is dragged out of a stack. A panel is moved instead, and so is a whole stack — whose other tabs ride along hidden — so this is null for both of those and between drags',
        panelSupplied:
          "Record<moduleId, boolean> — modules whose panel this interface supplies itself, by declaring a `meta.panels` entry that names the module and carries a `node`. What a module's dock frame asks before drawing its own contents; the module still owns whether the panel is open and how big it is",
        layoutNames:
          'string[] — the arrangements saved for the interface on screen, by name, sorted. The three-rung chain has one user slot; these are how to keep more than one — a “recording” and a “reviewing” for the same template. Empty for an interface with none',
        activeLayout:
          "string — the saved layout the arrangement on screen is, or '' once anything has been moved since. Mark the matching row as selected",
        layoutDirty:
          'boolean — the interface on screen has been rearranged: one of its panels moved, resized or closed. What a whole-arrangement "reset layout" control is gated on, and not the same question as any layoutPinned entry — a closed panel has no placement, and a panel declared for another route is not among the docks at all. False for an interface declaring no panels',
      },
      actions: {
        beginDockResize:
          "(id: string): remembers a panel's current size so the drag that follows is measured from it. Wire it to we-resize-handle's resizestart. For a divider between lane-mates it first makes every member's stored size what is on screen, so the boundary can then travel the whole lane",
        resizeDock:
          "(id: string, side: 'left' | 'right' | 'top' | 'bottom' | 'top-left' | …, dx: number, dy: number): applies a resize drag from that side or corner, in screen pixels since it began. Wire it to resize with { $: 'arg.detail.delta' }",
        endDockResize: '(): ends the drag and persists the size',
        resizeColumn:
          "(id, delta): moves the boundary between this panel and the next one in its lane, giving one what the other loses. What the earlier panel's trailing grip calls when it has a lane-mate — its bottom in a side lane, its right-hand edge in a top or bottom one. A boundary belongs to both panels, so only one of them draws it",
        fitDock:
          '(id: string): shrinks a panel to the shape its content wants, keeping the width the user chose — only when the module declares an aspect for its panel',
        beginDockMove:
          '(id: string, pointerX: number, pointerY: number): begins moving a panel, remembering where it and the pointer started. A maximised panel shrinks back under the cursor',
        moveDock: '(id: string, dx: number, dy: number): applies a move, in pixels from where beginDockMove was called',
        beginTabDrag:
          '(id: string, pointerX: number, pointerY: number): a press on one tab of a stack. Records only — a tab is a click until the pointer travels, and the panel does not leave its seat until the drop',
        moveTab:
          '(id: string, dx: number, dy: number): past the drag threshold, shows where the tab would land. The tab itself stays put; only the guides follow',
        endTabDrag:
          '(id: string, pointerX: number, pointerY: number): a press that went nowhere brings the tab forward; one that travelled lands it, or leaves it as a card under the pointer',
        raiseDock:
          '(id: string): brings a panel in front of the others — what a pointer landing on its frame does, and what a drag or maximising does on its own. The most recently raised panel is the one on top; nothing else decides stacking',
        endDockMove:
          '(id: string): drops the panel — onto the snap or insert slot it is over, or where it is if that is nowhere',
        snapDock:
          "(id: string, snap: SnapPoint): parks a panel at one of the eight positions from a menu — the keyboard's way to move it",
        insertDock:
          "(id: string, edge: 'left' | 'right' | 'top' | 'bottom', position: number, mode?: 'band' | 'lane' | 'tab', lane?: number | 'float'): puts a panel on that edge, renumbering what it lands among — what a drop does. 'band' opens a lane of its own at that distance inboard; 'lane' takes a new seat at that position along the lane named by `lane` (a distance inboard, or 'float' for the floating one); 'tab' joins the seat at that position, stacking behind whatever is showing there",
        toggleMaximiseDock:
          '(id: string): covers the content region with the panel, or goes back to being a card. Nothing about where the panel was is overwritten while it is on',
        toggleDockDisplace:
          '(id: string): makes the panel push the content aside, or stop. A toggle rather than a setter because a menu item reports only that it was clicked',
        toggleCollapseDock:
          '(id: string): folds a panel down to its titlebar, or opens it again. It keeps its place in its lane and its lane-mates take the room; the content is hidden, never unmounted. Refused where there is nowhere for that room to go — a sidebar alone on its edge, or the last open member of a lane. Read dockPlacement[id].canCollapse',
        breakOut:
          "(panelId: string, x?: number, y?: number): takes a section out of the template and makes it a panel — floating under the pointer when given one, else at the snap its meta.panels entry named. Refused for a section declared `fixed`. Takes the panel's own id, not the dock id",
        returnHome:
          '(panelId: string): puts a broken-out section back in the template at the outlet it came from. What the placeholder’s "Bring back" and the position menu’s "Return to page" call',
        stackDock:
          'stackDock(id: string, position: number): stacks a panel onto a floating one so the two share a seat and a tab strip — what a drop into the middle of a float does. Two panels in open space are in no lane, so `position` indexes the floating panels a drop could land on rather than naming one',
        insertHome:
          "(id: string, lane: string, position: number): drops a panel into a home lane at that position along it, renumbering the lane. Only a template's own sections land in one, and only where the lane's `accepts` allows",
        saveArrangementAsTemplate:
          '(): saves the arrangement on screen as a template of your own — a copy of the schema with the resolved placements written into its meta.panels and nothing else changed. The explicit bridge from arranging to authoring. Resolves true on success. Pair with layoutDirty',
        confirmDestructive:
          '(): runs the destructive action the host is asking about. Host chrome only, for the reason pendingDestructive is: an action able to answer its own confirmation is the confirmation being skipped',
        cancelDestructive: '(): refuses it. The waiting action resolves as though it had been blocked',
        openShellView:
          '(id: string, path?: string): opens a shell overlay by id, optionally at a route inside it — the overlay keeps its own memory router, so this never touches the browser URL',
        setCreateSpaceOpen:
          '(open: boolean): opens or closes the create-space modal. Shell state rather than a page\u2019s $localState because more than one place opens it — the settings page and the sidebar\u2019s spaces group — and a page-scoped flag could only be set from inside that page',
        closeShellView: '(): closes the currently open shell overlay',
        toggleSpaceSettings:
          '(): opens or closes the settings panel for the space on screen. What a gear in chrome should call \u2014 a control that is always present toggles, so a second press puts back what the first press changed',
        resetDockToLayout:
          '(panelId: string): puts a panel back where meta.panels asked for it, forgetting where it was dragged. Forgets rather than rewrites, so the panel keeps following the layout afterwards \u2014 including when the template changes it. Pair with layoutPinned',
        closeTemplatePanel:
          "(panelId: string): dismisses a panel the interface declared in meta.panels, by that panel's id. What its titlebar's close button calls",
        openTemplatePanel:
          '(panelId: string): puts a closed one back. The only way back to a panel that has been closed — it has no titlebar left to ask from — so a template offering a close should offer this too',
        resetTemplateLayout:
          '(): puts every panel of the interface on screen back the way meta.panels declared them, and reopens the ones that were closed. The whole-arrangement counterpart of resetDockToLayout, and the only way back for a closed panel, which has no titlebar to reset itself from. Scoped to the template rather than the route, so a declaration that varies by route is reset once. Pair with layoutDirty',
        saveLayout:
          '(name: string): saves the arrangement on screen under a name — its panels’ placements, which tab of each seat is showing, and which panels are closed. Scoped to the template, as placements are. Replaces a layout of that name',
        applyLayout:
          '(name: string): puts the arrangement back to a saved layout. What the layout does not mention returns to what meta.panels declared, exactly as a reset would leave it',
        deleteLayout: '(name: string): forgets a saved layout',
        openSpaceSettings:
          '(): opens that panel without closing it again. For a control that sits on the very fields it leads to (the About view\u2019s pencil), where a toggle would break the promise to show them',
        closeSpaceSettings: '(): closes the space-settings panel',
        scrollToId: '(id: string): smooth-scrolls the element with that DOM id into view',
      },
    },
    appStore: {
      state: {
        apps: 'RegisteredApp[] — list of registered external apps (id, name, image)',
        activeAppId: 'string | null — id of the currently active app, or null if none',
        appsWithWe:
          'RegisteredApp[] — the apps list with a WE entry prepended, for an app switcher that offers the way back to templates as one more row. Prepended here because a schema can map a list but cannot add to it',
      },
      actions: {
        activateApp: '(id: string): activates an app and switches to its view',
        deactivateApp: '(): deactivates the current app and returns to the template view',
      },
    },
    presenceStore: {
      state: {
        peers:
          'PresentAgent[] — every peer known in the current space, offline included, each joined to its cached profile (did, name, avatar, tone, focus, activities, availability). Sorted by liveness',
        online: 'PresentAgent[] — peers in the current space who are not offline — the "who is here" list',
        onlineHere: "PresentAgent[] — peers at this agent's exact route path, for a per-page presence strip",
        calls: 'Map<callId, PresentAgent[]> — the calls running in this space right now and who is in each',
        available:
          'boolean — a presence transport exists. False in a personal space, where there is nobody to be present to; gate presence UI on it rather than rendering an empty roster',
        focusDepth:
          "FocusDepth — how much of this agent's location peers are shown: the space only, the section, or the exact path",
      },
      actions: {
        setFocusDepth: '(depth: FocusDepth): sets how much of your location peers see',
        setAvailability:
          "(availability: 'available' | 'busy' | 'away' | 'invisible'): sets the status published with your presence. 'invisible' stops publishing entirely rather than asking peers not to look",
        setActivity:
          '(activity: Activity): adds or replaces a published activity — a call, an edit, a work claim — keyed by its type and id',
        clearActivity:
          '(type: string, id?: string): withdraws a published activity; omit id to withdraw every one of that type',
      },
    },
    record: {
      state: {},
      actions: {
        create:
          '(entity: string, fields: object, options?: { perspective?: string }): creates a record in the current space, or in the dataset a store path names (\'datasetStore.rootDataset\' for we-root entities). See "Record mutations via $action" above',
        update:
          '(entity: string, id: string, fields: object, options?: { perspective?: string }): updates the named fields of one record, leaving the rest',
        delete: '(entity: string, id: string, options?: { perspective?: string }): deletes one record. Irreversible',
      },
    },
    interpretationStore: {
      state: {
        activity:
          'InterpretationActivityView[] — every extraction pass this agent knows about, its own and its peers’, running first then most recent. Each row carries display-ready strings: `label` is a whole clause ("Anna is waiting on the model", "Extracted 3 records"), `elapsed` is `m:ss` while running and empty once settled, `name`/`avatar`/`runner` identify who is running it, and `mine` says whether it is this agent’s. Only a row with `mine` can carry `prompt`/`response` — the exchange never left the runner’s machine — so gate a details affordance on `hasDetail` and explain the refusal rather than hiding it',
        runningCount:
          'number — how many passes are still in flight. What a collapsed "N extractions running" summary counts',
        hasActivity:
          'boolean — whether there is anything to show at all. Counts settled rows too, so a bar gated on it does not vanish the instant a pass finishes and take its result with it',
        runningPasses: 'InterpretationActivityView[] — the passes still in flight, for a readout that lists them',
        settledPasses: 'InterpretationActivityView[] — the passes that have finished, newest first',
        settledCount: 'number — how many have finished. What a collapsed "N extractions processed" line counts',
        detailWithheld:
          "boolean — a peer's settled pass is on screen whose exchange this agent cannot open, because the space does not share it. Gate a footnote explaining the absence on this rather than on a row's own hasDetail, which is false for a pass that simply has not reached the model yet",
        capable:
          'boolean — whether this node can interpret AT ALL, as distinct from being able to and having no model configured. Answered by asking the backend rather than by testing the client library, so it is false against a node whose executor predates the extraction stack. False means no fix exists from inside the app — say so rather than offering a control that cannot work',
      },
      actions: {
        dismissSettled:
          '(): forgets every finished row, leaving anything still running. A running pass is not this agent’s to dismiss',
      },
    },
  };

  for (const entry of entries) {
    /*
      A store with no description block is still listed, with bare member names.

      Skipping it used to be the behaviour, and it hid the thing worth knowing: the store is legal in
      a schema whether or not anybody has written it up, so omitting it left the reference asserting
      — by silence — that it does not exist. `presenceStore` was in exactly that position. Thin
      documentation is a smaller problem than absent documentation that reads as absent capability.
    */
    const desc = descriptions[entry.name] ?? { state: {}, actions: {} };

    const storeName = entry.name.charAt(0).toUpperCase() + entry.name.slice(1).replace(/Store$/, 'Store');
    lines.push('');
    lines.push(`${storeName}:`);

    lines.push('- State:');
    for (const key of Object.keys(entry.state)) {
      const typeDesc = desc.state[key];
      if (typeDesc === undefined) undescribedMembers.push(`${entry.name}.${key}`);
      lines.push(`  - ${key}: ${typeDesc ?? 'unknown'}`);
    }

    lines.push('- Actions:');
    for (const key of entry.actions) {
      const sig = desc.actions[key];
      if (sig === undefined) undescribedMembers.push(`${entry.name}.${key}()`);
      lines.push(`  - ${key}${sig ?? '(): unknown'}`);
    }
  }

  return lines.join('\n');
}

/**
 * Members that rendered as `unknown` — reachable from a schema, and with nothing saying what they do.
 *
 * ## Why this is a build failure rather than a note
 *
 * The architecture plan's rule is that an undescribed member fails the build, and the generator's
 * own count was the wrong measure of one: it counted members missing from `storeEntries`, which is
 * a merge input, while what an author actually reads is this — the description table, whose misses
 * render as the literal word `unknown` in the reference an LLM is handed.
 *
 * The consequence of it being a count is on the record. Three `ShapeStore` members regressed to
 * `unknown` after the PR that reported "zero unknown remain"; the count went up by three and nobody
 * looked.
 *
 * Wiring never reaches here — `mergeStoreEntries` drops it against `templateSurface.ts` first — so
 * everything on this list is vocabulary a template can name.
 *
 * Populated by {@link generateStoresText}, which the module runs once below. Reading it before that
 * would give an empty array, which is why it is not a function.
 */
export const undescribedMembers: string[] = [];

/**
 * The prose block for the reference, built from whatever entries it is given.
 *
 * Kept as a default export for consumers that only want the hand-authored view; `generate.ts` calls
 * `generateStoresText` again over the *merged* entries instead, so the documented list and the list
 * the validator enforces are the same one. They used to be two — the docs showed what was written
 * down, the validator checked what the source declared — which is how a store could exist, be legal
 * in a schema, and be absent from every document describing it.
 */
export const stores = generateStoresText(storeEntries);
