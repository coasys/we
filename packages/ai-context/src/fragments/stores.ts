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
      client: { type: 'object' },
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
      'syncDisplay',
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
      currentDatasetModels: { type: 'array' },
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
    actions: ['switchDataset', 'reorderDatasets', 'updateAgentSettings', 'cleanupSpaceSdna'],
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
    },
    actions: [
      'fetchProfile',
      'updateOwnProfile',
      'updateProfileImage',
      'clearProfileImage',
      'updateOwnLocation',
      'setPendingAvatar',
      'completeAccountSetup',
    ],
  },
  {
    name: 'routeStore',
    state: {
      currentPath: { type: 'string' },
      segments: { type: 'array' },
      params: { type: 'object' },
    },
    actions: ['navigate', 'setParam'],
  },
  {
    name: 'themeStore',
    state: {
      builtInThemes: { type: 'array', properties: ['id', 'name', 'icon', 'origin'] },
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
      'updateTemplate',
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
      'upsertSignal',
      'navigateToSpace',
      'canAdministerSpace',
      'copyShareLink',
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
      'setApiKey',
      'startFork',
      'startFresh',
      'confirmPicker',
      'cancelPicker',
      'newChat',
      'switchSession',
      'deleteSession',
      'onSchemaEdit',
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
  // Pseudo-store for model.create / model.update / model.delete $action tokens.
  // Not a real store (no `descriptions` entry below, so it's omitted from the
  // generated "## Stores" doc section) — it's already documented separately
  // under "Model mutations via $action" in rules.ts. Wired at runtime in
  // TemplateProvider.tsx as `modelStore`, not through the store registry.
  {
    name: 'model',
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
    'Access state with $store and call actions with $action.',
    'For ephemeral/form state, use $localState/$local/$setLocal instead of stores (see Dynamic Logic).',
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
        syncDisplay:
          '({ name?, avatar? }): mirrors the profile onto the running account, so the locked sign-in screen has a name and picture. Never throws',
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
        currentDatasetModels:
          'ModelManifestEntry[] (non-WE SHACL models from the current dataset; injected as externalModels into AI messages)',
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
      },
      actions: {
        switchDataset:
          '(uuid: string): switches to a dataset by UUID, registers its SHACL models as dynamic model classes, and populates currentDatasetModels',
        reorderDatasets: '(newOrder: string[]): reorders the sidebar items by UUID array',
        updateAgentSettings: '(updates: Partial<AgentSettings>): merges and persists root-dataset agent settings',
        cleanupSpaceSdna:
          '(uuid?: string): one-time remediation for a space that accumulated duplicate SDNA installs — removes the redundant duplicate link copies. Defaults to the current dataset. Returns a display-ready summary string naming how many links were removed and the DIDs that authored them (your own DID annotated with "(you)"), or an empty string if nothing needed cleaning up',
      },
    },
    profileStore: {
      state: {
        profiles:
          'AgentProfileSummary[] — cache of all fetched profiles (did, firstName, lastName, handle, bio, avatar, coverImage, location)',
        ownProfile:
          "AgentProfileSummary | undefined — reactive accessor for the current user's own profile (derived from the cache)",
      },
      actions: {
        setPendingAvatar:
          '(file: File): holds a picture chosen before an agent exists; uploaded by completeAccountSetup',
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
        params:
          "Record<string, string> — the URL's query parameters, reactive; read one as { $store: 'routeStore.params.<name>' }. Prefer $localState with syncParam for fields a view owns; read params directly only for parameters something else writes",
      },
      actions: {
        navigate:
          "(to: string, options?): navigates to a route (a bare path restores that route's remembered query string)",
        setParam:
          '(name: string, value: string | null, options?: { push?: boolean }): writes one query parameter (null removes); replaceState by default, push: true for changes that deserve a Back entry. Prefer $localState syncParam over calling this directly',
      },
    },
    themeStore: {
      state: {
        builtInThemes: 'array of ThemeData objects — built-in registry themes (origin: "built-in", always available)',
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
      },
      actions: {
        setCurrentTheme: '(themeId: string): sets and persists the active theme',
        themeScope:
          "'global' | 'scoped' — what actually applies right now: the theme editor's session preview if one is active, else the agent's preference",
        themeScopePreference: "'global' | 'scoped' — the agent's persisted choice",
        themeScopeGlobal: 'boolean — the preference as a boolean, for a switch to bind to',
        themeScopePreviewing:
          'boolean — a theme being edited is previewing a different scope, so the preference is temporarily masked. Worth saying so beside the setting',
        setDefaultTheme:
          '(themeId: string): sets the preferred default theme (persists to AgentSettings.defaultThemeId)',
        setThemeScopeGlobal:
          "(global: boolean): persists whether a space's theme covers the whole window (true) or only the space's own content (false, the default). Takes a boolean because a switch emits one and a schema cannot map it to a string — `$if` in an action's args resolves at render time, before the event exists",
        previewThemeScope:
          "(scope: 'global' | 'scoped' | null): previews a scope for the current theme-editing session without writing the preference; null drops the preview. Cleared when editing ends",
        setThemeInstalled:
          '(themeId: string, visible: boolean): shows or hides a custom theme in the pickers; does not delete it. Takes the value rather than toggling, so a `we-switch` can pass `$event.detail` straight through',
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
        builtInTemplates: 'array of TemplateSchema objects — built-in system templates (always available)',
        myTemplates:
          "array of TemplateSchema objects — user's installed custom templates only (excludes built-in and space templates)",
        allTemplates: 'array of TemplateSchema objects — union of built-in + personal + space templates',
        currentTemplate: 'TemplateSchema (the active template)',
        templateManagementList:
          'TemplateManagementItem[] — flat list of all templates with management metadata (id, name, icon, description, isBuiltIn, isInstalled, isDefault)',
        switcherGroups:
          'TemplateSwitcherGroup[] — pre-grouped flat items for the template switcher UI; each group has { label: string, items: { id, name, icon }[] }. Groups: "Space templates", "My templates", "Built-in". Use $filter where: { name: { contains: ... } } for search since items have a flat name field.',
      },
      actions: {
        updateTemplate: '(newTemplate: TemplateSchema): updates the current template',
        switchTemplate: '(newTemplateId: string): switches to another template',
        removeTemplate: '(): removes the current template',
        saveTemplate: '(name: string): saves the current template',
        installToSpace:
          '(marketplaceTemplateId: string): copies a marketplace template into the current space, so every member of that community gets it — as opposed to installing it for yourself. Pair with templateStore.operationLoading to show progress on the row being installed',
      },
    },
    spaceStore: {
      state: {
        mySpaces: 'array of Space objects — every space the agent holds, across all joined datasets',
        personalSpaces: 'array of Space objects (local/personal spaces; all Space fields)',
        sharedSpaces: 'array of Space objects (shared/neighbourhood spaces; all Space fields)',
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
          '{ label, value }[] — options for the per-space template override picker: "Use the space\u2019s default" (space-default), "Use my default" (agent-default), then every template. Each of the first two names what it resolves to. Pre-built because a schema can $map a store array into options but cannot prepend one, and without those entries overriding would be one-way',
        themeOverrideOptions: '{ label, value }[] — the same, for themes',
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
          '{ id, icon, label, active }[] — launchers for the modules enabled here and available in this space; what the host module rail renders. Pair with { $action: "spaceStore.launchModule", args: ["$mod.id"] }',
      },
      actions: {
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
        unreadNodeIds:
          'string[] — ids of containers in this space holding something newer than your read marker. The read side of `ReadMarker`: use it for unread dots with `{ "$in": ["$channel.id", { "$store": "spaceStore.unreadNodeIds" }] }` rather than recomputing a `$latestChild` projection and a `$gt` per row',
        myMentions:
          '{ id, author, createdAt }[] — nodes in this space that name you, newest first. The read side of `WeNode.mentions`, which the composer has always written and nothing could read',
        uploadFile:
          '(file: File, name?: string): stores a file and returns the URL to reference it by, or null. Images are compressed on the way through. For a template doing its own media UI — without it, only the block composer could accept an upload',
        upsertSignal:
          '(nodeId: string, signalTypeId: string, value: number): adds or updates a signal on a node; value=0 deletes it',
        navigateToSpace:
          '(spaceId: string, view?: string): navigates to a space — accepts a perspective UUID or a neighbourhood CID (sharedUrl without the neighbourhood:// prefix); pre-loads space templates before switching so the template and data arrive together',
        updateSpaceMeta:
          '(updates: { name?, description?, discovery?, location? }, spaceUuid?): updates the space everyone sees. Omit spaceUuid to target the space on screen; pass one to configure a space from the spaces list without navigating to it',
        setSpaceDefaultTemplate:
          '(templateId: string, spaceUuid?): sets the template members see when they enter that space. Only repaints the app when the target is the space currently on screen',
        setSpaceDefaultTheme: '(themeId: string, spaceUuid?): sets the theme members see when they enter that space',
        copyShareLink:
          "(uuid: string): copies that space's share link to the clipboard, with a toast either way. No-op for a personal space, which has no global id and so no shareable link — read `spaceList[].shareLink` to decide whether to offer the control at all",
        canAdministerSpace:
          '(uuid: string): whether this agent may change what every member of that space sees — true for a personal space, and for a shared one they authored. A UI affordance for deciding whether to offer the controls, NOT enforcement: a shared space is a neighbourhood every member can write to. Ask by name rather than comparing author to $me.did, so the answer can grow (multiple admins, roles) without every template changing',
        getSubgroupMessages:
          "(subgroupId: string): messages belonging to one of Flux's conversation subgroups, fetched on demand. A dialect query against a foreign schema rather than a WE model, so it goes through the backend's interop surface instead of $query — which is why it is a store method and not a relation you can drill into",
        exportCallTranscript:
          "(callId: string): writes the call's transcript to a .txt file (one line per utterance: name, timestamp, text) and downloads it. Read-only and client-side — it reads the shared record and writes to the caller's own device",
        setModuleInstalled:
          '(moduleId: string, installed: boolean): turns a module on or off for this agent in every space. Personal — writes AgentSettings.installedModules in the root dataset, so no other member sees it',
        setModuleVisible:
          '(moduleId: string, visible: boolean, spaceUuid?): shows or hides a module for this agent in one space, without changing what the community runs. Private: written to the root dataset, never to the space. Phrased positively so a switch can pass `$event.detail` bare \u2014 wrapping it in an operator such as `$not` would evaluate at render time and send a constant',
        setSpaceTemplateOverride:
          "(templateId: string, spaceUuid?): sets the template THIS AGENT sees in one space, overriding the community's default. Three values: 'space-default' follows the space, 'agent-default' follows your own global default (tracking later changes to it), or a concrete template id pins that one. Private, and applied immediately when that space is the one on screen. Note the sentinels are named values, not '' — the ORM skips empty strings on update, so '' cannot clear a property",
        setSpaceThemeOverride:
          '(themeId: string, spaceUuid?): sets the theme THIS AGENT sees in one space. Same three values as setSpaceTemplateOverride. Private',
        applyTheme:
          '(themeId: string): applies a theme where the agent is — pinned to the space on screen, or set as their global default when there is no space. What a theme picker in chrome should call: it persists, where setCurrentTheme only sets a signal that the next resolution overwrites. Which of the two it does is decided at click time, so a schema cannot express it with $if (whose args resolve at render time)',
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
        recordDraft:
          "the open form's draft ({ entity, label, icon, fields[] }) or null while closed — its non-nullness is what mounts the modal. Each field is { name, label, control, required, options, placeholder, value }, derived from the model's own declaration, so a form exists for a model nobody wrote a form for",
        recordErrors: 'string[] — validation errors from the last save attempt, plus any backend failure',
        savingRecord: 'boolean — a create is in flight',
        lastCreatedId:
          "string — the id of the last record created, empty before the first. Read it to act on what was just made; kept in the store because an $action's onSuccess can read a store and cannot hold a value",
        pendingLink:
          'the two records a pending connection joins ({ sourceId, sourceType, sourceLabel, targetId, targetType, targetLabel }), or null when the open form is an ordinary one. Read it to name what is being connected',
      },
      actions: {
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
        hintEntities:
          "{ entity, source: 'core' | 'shape' }[] — entities offering AI-hint tuning in this space: core interpretable vocabulary (TaskBlock, EventBlock) plus the space's own shapes",
        relationshipTargets:
          "{ label, value }[] — what a relationship may point at here, ready for a we-select: this space's own models, then block types, then other apps' models. Core infrastructure entities are deliberately absent",
        identityOptions:
          '{ label, value }[] — "None" plus every named property of the open draft, for the identity picker. Built in the store because a schema can $map options but cannot prepend one',
        hintEditor:
          'the hint editor state ({ entity, classHint, defaultClassHint, rows: { name, predicate, hint, defaultHint }[], customized }) or null while closed — non-nullness mounts the hint editor modal',
        hintBusy: 'boolean — the hint editor is loading or saving',
        memberOptions:
          "{ rowId, options }[] — each member's default-value picker entries. Read with $find on rowId rather than off $member: rows are mutated in place while typing, so values hanging off the row cannot be reactive",
        confirmDiscard: 'boolean — the "discard this model?" confirmation is showing',
        confirmReplaceFields:
          'boolean — the "replace the fields below?" confirmation is showing. Only ever raised for a generation over hand-written rows; a generated proposal nobody touched re-runs on the click',
        generateIntent:
          "'none' | 'generate' | 'regenerate' | 'replace' — what the generate button would do right now, given what the draft holds. Label it \"Regenerate\" on 'regenerate' and 'replace' and \"Generate\" otherwise — 'none' is an empty draft, which has nothing to re-run, so testing for 'generate' alone labels a fresh form wrongly. Disable only on 'none', and route the click through requestGenerateFields, which decides whether to ask first",
        expandedMembers:
          "string[] — rowIds whose detail panel is open. Read with { $in: ['$member.rowId', { $store: 'shapeStore.expandedMembers' }] }; a new row and any row an error names open themselves. Generation leaves rows closed — a collapsed row shows its hint, so what was generated is readable without opening anything",
      },
      actions: {
        openShapeWizard:
          '(shapeRecordId?): opens the model wizard — empty for a new model, or pre-filled from a stored shape to edit it',
        cancelShapeWizard: '(): closes the wizard, discarding the draft',
        setShapeField: "(field: 'name' | 'description' | 'icon' | 'classHint', value): sets one top-level draft field",
        setIdentityMember:
          "(rowId): chooses which member identifies duplicates for AI extraction; 'none' clears it. At most one, which is why it is a picker rather than a per-row flag",
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
          '(rowIds: string[]): applies a drag-reorder. Pair with we-sortable\'s onReorder and pass "$arg.detail" — order is the stored declaration order, not decoration',
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
        closeHintEditor: '(): closes the hint editor, discarding unsaved edits',
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
      },
      actions: {
        toggle: '(): toggles the AI chat panel open/closed',
        undo: '(): undoes the last schema edit',
        redo: '(): redoes the last undone schema edit',
      },
    },
    shellStore: {
      state: {
        activeShellView:
          "string | null — id of the currently open shell overlay ('profile' | 'settings' | 'schema-tests' | 'landing-page'), or null",
      },
      actions: {
        openShellView:
          '(id: string, path?: string): opens a shell overlay by id, optionally at a route inside it — the overlay keeps its own memory router, so this never touches the browser URL',
        setCreateSpaceOpen:
          '(open: boolean): opens or closes the create-space modal. Shell state rather than a page\u2019s $localState because more than one place opens it — the settings page and the sidebar\u2019s spaces group — and a page-scoped flag could only be set from inside that page',
        closeShellView: '(): closes the currently open shell overlay',
        scrollToId: '(id: string): smooth-scrolls the element with that DOM id into view',
      },
    },
    appStore: {
      state: {
        apps: 'RegisteredApp[] — list of registered external apps (id, name, image)',
        activeAppId: 'string | null — id of the currently active app, or null if none',
      },
      actions: {
        activateApp: '(id: string): activates an app and switches to its view',
        deactivateApp: '(): deactivates the current app and returns to the template view',
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
      const typeDesc = desc.state[key] ?? 'unknown';
      lines.push(`  - ${key}: ${typeDesc}`);
    }

    lines.push('- Actions:');
    for (const key of entry.actions) {
      const sig = desc.actions[key] ?? '(): unknown';
      lines.push(`  - ${key}${sig}`);
    }
  }

  return lines.join('\n');
}

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
