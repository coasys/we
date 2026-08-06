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
      passwordError: { type: 'boolean' },
      loginLoading: { type: 'boolean' },
      createAgentError: { type: 'string' },
      createAgentLoading: { type: 'boolean' },
    },
    actions: ['login', 'createAgent', 'clearPasswordError', 'finishSetup', 'logout'],
  },
  {
    name: 'accountStore',
    state: {
      canManageAccounts: { type: 'boolean' },
      accounts: { type: 'array', properties: ['id', 'name', 'avatar', 'active', 'sharedWithLauncher'] },
      activeAccount: { type: 'object', properties: ['id', 'name', 'avatar', 'active', 'sharedWithLauncher'] },
      pendingRemoval: { type: 'object', properties: ['id', 'name', 'avatar', 'active', 'sharedWithLauncher'] },
      switchingTo: { type: 'object', properties: ['id', 'name', 'avatar', 'active', 'sharedWithLauncher'] },
      creating: { type: 'boolean' },
      hasOtherAccounts: { type: 'boolean' },
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
      canConfigureExecutor: { type: 'boolean' },
      mcpEnabled: { type: 'boolean' },
      mcpPort: { type: 'number' },
      executorRestartPending: { type: 'boolean' },
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
      datasets: { type: 'array', properties: ['uuid', 'name', 'sharedUrl', 'neighbourhood'] },
      orderedDatasets: { type: 'array', properties: ['uuid', 'name', 'sharedUrl'] },
      currentDataset: { type: 'object', properties: ['uuid', 'name', 'sharedUrl'] },
      currentDatasetCid: { type: 'string' },
      currentDatasetModels: { type: 'array' },
      isWeSpace: { type: 'boolean' },
      joinedSpaceCids: { type: 'array' },
      systemDatasetUuids: { type: 'array' },
      rootDataset: { type: 'object', properties: ['uuid', 'name'] },
      globalDataset: { type: 'object', properties: ['uuid', 'name', 'sharedUrl'] },
      marketplaceDataset: { type: 'object', properties: ['uuid', 'name', 'sharedUrl'] },
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
    },
    actions: ['navigate'],
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
      themeManagementList: {
        type: 'array',
        properties: ['id', 'name', 'icon', 'isBuiltIn', 'isInstalled', 'isDefault'],
      },
    },
    actions: [
      'setCurrentTheme',
      'setDefaultTheme',
      'toggleThemeInstalled',
      'installFromMarketplace',
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
      shellTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      currentTemplate: { type: 'object', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      operationLoading: { type: 'boolean' },
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
      creatingSpace: { type: 'boolean' },
      orderedSidebarItems: { type: 'array', properties: ['uuid', 'name', 'avatar', 'spaceId'] },
      memberDids: { type: 'array', properties: ['did'] },
      members: {
        type: 'array',
        properties: ['did', 'firstName', 'lastName', 'handle', 'bio', 'avatar', 'coverImage', 'location'],
      },
      spaceDefaultTemplateId: { type: 'string' },
      currentSpace: { type: 'object', model: 'Space' },
      foreignSpacePrefill: { type: 'object', properties: ['name', 'description', 'avatar'] },
      signalTypes: {
        type: 'array',
        model: 'SignalType',
        properties: [
          'id',
          'name',
          'slug',
          'description',
          'icon',
          'iconSecondary',
          'mode',
          'rangeMin',
          'rangeMax',
          'step',
        ],
      },
      signalTypesBySlug: {
        type: 'object',
      },
      enabledModules: {
        type: 'array',
      },
      moduleSettings: {
        type: 'array',
        properties: ['id', 'name', 'description', 'icon', 'enabled'],
      },
      moduleLaunchers: {
        type: 'array',
        properties: ['id', 'icon', 'label', 'active'],
      },
    },
    actions: [
      'createSpace',
      'joinSpace',
      'initializeAsWeSpace',
      'removeSpace',
      'createPost',
      'updatePost',
      'deletePost',
      'updateSpaceImage',
      'createSignalType',
      'upsertSignal',
      'navigateToSpace',
      'setModuleEnabled',
      'launchModule',
    ],
  },
  {
    name: 'editorStore',
    state: {
      models: { type: 'array', properties: ['id', 'name'] },
      tasks: { type: 'array', properties: ['id', 'status', 'result'] },
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
      panelMode: { type: 'string' },
      schemaJson: { type: 'string' },
      operationLoading: { type: 'boolean' },
      canUndo: { type: 'boolean' },
      canRedo: { type: 'boolean' },
    },
    actions: [
      'handleSchemaPrompt',
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
      'setPanelMode',
      'onSchemaEdit',
      'undo',
      'redo',
    ],
  },
  {
    name: 'shellStore',
    state: {
      activeShellView: { type: 'string' },
    },
    actions: ['openShellView', 'closeShellView', 'scrollToId'],
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
function generateStoresText(entries: StoreEntry[]): string {
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
        passwordError: 'boolean — true after a failed unlock attempt',
        loginLoading: 'boolean',
        createAgentError: 'string — the backend message from a failed agent creation, or empty',
        createAgentLoading: 'boolean',
      },
      actions: {
        login: '(password: string): unlocks the agent and loads user data',
        createAgent:
          "(password: string): creates the agent, loads user data, and lands on the 'finishing' boot state (not 'ready')",
        clearPasswordError:
          '(): clears the failed-unlock flag. Chain it after the password field\'s $setLocal — the verdict was on the submitted password, so editing that password retracts it and a stale "Incorrect password" should not sit over the correction',
        finishSetup: "(): leaves 'finishing' for the running app — sets bootState to 'ready'",
        logout: '(): locks the agent and returns to the login screen',
      },
    },
    accountStore: {
      state: {
        canManageAccounts:
          'boolean — the host can manage local accounts (false on web). Gate every account control on this',
        accounts: 'Account[] — local accounts (id, name, active). id is the data directory',
        activeAccount:
          'Account | undefined — the account this app instance is running against. Correct at first paint: the list is seeded from a synchronous cache',
        hasOtherAccounts: 'boolean — true when there is somewhere else to switch to',
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
        canConfigureExecutor:
          'boolean — this host starts the backend, so how it starts it can be changed. False on web',
        mcpEnabled: 'boolean — whether the backend serves MCP on its next start',
        mcpPort: 'number — the port MCP is served on',
        executorRestartPending: 'boolean — settings were changed that the running backend has not picked up',
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
        systemDatasetUuids: 'string[] — uuids of the we-root/we-test system datasets',
        rootDataset: "dataset handle | null — the agent's personal root dataset (we-root models live here)",
        globalDataset: 'dataset handle | null — the seed-configured global discovery space, once joined',
        marketplaceDataset: 'dataset handle | null — the seed-configured marketplace, once joined',
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
        updateOwnLocation:
          '(update: { latitude?, longitude?, city?, country?, countryCode? }): merges the location update into the cache and publishes to the public dataset',
      },
    },
    routeStore: {
      state: {
        currentPath: 'string (the current route path)',
        segments: 'string[] (currentPath split by "/", e.g. ["/foo/bar"] → ["foo", "bar"])',
      },
      actions: { navigate: '(to: string, options?): navigates to a route' },
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
        themeManagementList:
          'ThemeManagementItem[] — flat list of all themes (built-in + all custom) with management metadata (id, name, icon, isBuiltIn, isInstalled, isDefault)',
      },
      actions: {
        setCurrentTheme: '(themeId: string): sets and persists the active theme',
        setDefaultTheme:
          '(themeId: string): sets the preferred default theme (persists to AgentSettings.defaultThemeId)',
        toggleThemeInstalled:
          '(themeId: string): toggles a custom theme visible/hidden in pickers; does not delete the theme',
        installFromMarketplace: '(marketplaceThemeId: string): installs a marketplace theme into installedThemes',
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
        shellTemplates: 'array of TemplateSchema objects (static system pages: profile, settings, tests)',
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
      },
    },
    spaceStore: {
      state: {
        mySpaces: 'array of Space objects — every space the agent holds, across all joined datasets',
        personalSpaces: 'array of Space objects (local/personal spaces; all Space fields)',
        sharedSpaces: 'array of Space objects (shared/neighbourhood spaces; all Space fields)',
        creatingSpace: 'boolean (true while a new space is being created)',
        orderedSidebarItems:
          'array of sidebar items in user-defined order (uuid, name, avatar, spaceId) — personal + shared spaces merged',
        memberDids: 'string[] — DIDs of all members in the current space (includes own DID)',
        members: 'AgentProfileSummary[] — cached profiles for all memberDids',
        spaceDefaultTemplateId:
          "string — the current space's default template ID (empty string when no space is active)",
        currentSpace:
          'Space | null — the current space model (all Space fields: uuid, url, name, description, access, discovery, avatar, coverImage, defaultTemplateId, defaultThemeId, location, plus id/author/createdAt)',
        foreignSpacePrefill:
          '{ name, description, avatar } | null — detected from a foreign app\'s own model (e.g. Flux\'s Community) for prefilling the "Initialize as WE space" gate; null once the perspective is a WE space or no recognized foreign model is found',
        signalTypes: 'array of SignalType objects (community-created reaction/vote types)',
        signalTypesBySlug:
          'Record<slug, SignalType> — computed map; access via { $store: "spaceStore.signalTypesBySlug.<slug>" }; use .id for the UUID',
        enabledModules:
          'string[] — ids of the feature modules this space has turned on. An unset value means "not decided", not "none": it falls back to every registered module, so spaces predating the setting keep the chrome they had',
        moduleSettings:
          '{ id, name, description, icon, enabled }[] — every registered module paired with whether this space has it on; the shape the settings list renders',
        moduleLaunchers:
          '{ id, icon, label, active }[] — launchers for the modules enabled here and available in this space; what the host module rail renders. Pair with { $action: "spaceStore.launchModule", args: ["$mod.id"] }',
      },
      actions: {
        createSpace:
          "(name, description, access: 'personal' | 'shared', discovery: 'hidden' | 'listed', avatarFile?, coverImageFile?, location?): creates a new space with full setup",
        joinSpace: '(id: string): joins a shared space by neighbourhood URL, CID, or focuses it if already joined',
        initializeAsWeSpace:
          "(name: string, description: string, avatarValue?: File | string | null): installs WE's Space SDNA into the current, already-joined, foreign-native dataset (e.g. one synced in from Flux) and creates a Space entity in place — access is always 'shared' since the dataset is already a published neighbourhood",
        removeSpace:
          '(uuid: string): removes a space — clears its global-discovery listing (when authored by this agent) and removes the backing dataset',
        createPost: '(editorState: unknown): creates a new post',
        updatePost:
          '(postId: string, editorState: unknown): reconciles an edited post against its existing blocks — updates/reuses blocks whose id survived the edit, creates new ones, deletes ones no longer present',
        deletePost: '(postId: string): permanently deletes a post and all of its contained blocks (recursive, atomic)',
        updateSpaceImage:
          '(field: "avatar" | "coverImage", imageFile: File): uploads and sets the space avatar or cover image',
        createSignalType:
          '(config: Partial<SignalType>): creates a new signal type in the community; slug auto-derived from name if blank',
        upsertSignal:
          '(nodeId: string, signalTypeId: string, value: number): adds or updates a signal on a node; value=0 deletes it',
        navigateToSpace:
          '(spaceId: string, view?: string): navigates to a space — accepts a perspective UUID or a neighbourhood CID (sharedUrl without the neighbourhood:// prefix); pre-loads space templates before switching so the template and data arrive together',
        setModuleEnabled:
          '(moduleId: string, enabled: boolean): turns a feature module on or off for the current space; writes the resolved list, so the first toggle also pins whatever was on by fallback',
        launchModule:
          "(moduleId: string): invokes that module's declared launcher action. Takes an id rather than a path because $action resolves a literal string, so a rail iterating over modules cannot build modules.<id>.<method> itself",
      },
    },
    editorStore: {
      state: {
        models: 'array of Model objects',
        tasks: 'array of AITask objects',
        canUndo: 'boolean (true when there are schema edits that can be undone)',
        canRedo: 'boolean (true when there are undone schema edits that can be redone)',
      },
      actions: {
        handleSchemaPrompt: '(prompt: string): generates a schema from a prompt',
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
        openShellView: '(id: string): opens a shell overlay by id',
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
    const desc = descriptions[entry.name];
    if (!desc) continue;

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

export const stores = generateStoresText(storeEntries);
