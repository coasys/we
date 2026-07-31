/**
 * Stores fragment — documents all available stores with state keys and action signatures.
 *
 * Hand-maintained: update when stores change (infrequent — only 7 stores).
 * `storeEntries` is the structured source of truth; the `stores` text is derived from it.
 */

import type { StoreEntry } from '../types.js';

export const storeEntries: StoreEntry[] = [
  {
    name: 'adamStore',
    state: {
      adamClient: { type: 'object' },
      me: { type: 'object', properties: ['did', 'perspective', 'directMessageLanguage'] },
      allPerspectives: { type: 'array', properties: ['uuid', 'name', 'sharedUrl', 'neighbourhood'] },
      currentPerspective: { type: 'object', properties: ['uuid', 'name', 'sharedUrl'] },
      currentPerspectiveModels: { type: 'array' },
      isWeSpace: { type: 'boolean' },
      personalSpaces: { type: 'array', model: 'Space' },
      sharedSpaces: { type: 'array', model: 'Space' },
      bootState: { type: 'string' },
      passwordError: { type: 'string' },
      loginLoading: { type: 'boolean' },
      creatingSpace: { type: 'boolean' },
      agents: {
        type: 'array',
        properties: ['did', 'firstName', 'lastName', 'handle', 'bio', 'avatar', 'coverImage', 'location'],
      },
      ownAgent: {
        type: 'object',
        properties: ['did', 'firstName', 'lastName', 'handle', 'bio', 'avatar', 'coverImage', 'location'],
      },
      orderedSidebarItems: {
        type: 'array',
        properties: ['uuid', 'name', 'avatar', 'spaceId'],
      },
    },
    actions: [
      'navigate',
      'addNewSpace',
      'createSpace',
      'initializeAsWeSpace',
      'switchPerspective',
      'removePerspective',
      'reorderPerspectives',
      'login',
      'logout',
      'fetchAgent',
      'updateOwnProfile',
      'updateProfileImage',
      'updateAgentLocation',
      'cleanupSpaceSdna',
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
      activeShellView: { type: 'string' },
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
      'openShellView',
      'closeShellView',
    ],
  },
  {
    name: 'spaceStore',
    state: {
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
    },
    actions: [
      'createPost',
      'updatePost',
      'deletePost',
      'updateSpaceImage',
      'createSignalType',
      'upsertSignal',
      'navigateToSpace',
    ],
  },
  {
    name: 'aiStore',
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
    adamStore: {
      state: {
        adamClient: 'Ad4mClient | undefined',
        me: 'Agent | undefined',
        allPerspectives: 'array of PerspectiveProxy objects (all AD4M perspectives)',
        currentPerspective: 'PerspectiveProxy | null (the perspective currently being viewed)',
        currentPerspectiveModels:
          'ModelManifestEntry[] (non-WE SHACL models from the current perspective; injected as externalModels into AI messages)',
        isWeSpace:
          "boolean — true once the current perspective is confirmed to have WE's Space SDNA installed (false for a joined-but-foreign perspective, e.g. one synced in from Flux)",
        personalSpaces: 'array of Space objects (local/personal spaces; all Space fields)',
        sharedSpaces: 'array of Space objects (shared/neighbourhood spaces; all Space fields)',
        bootState: 'string',
        passwordError: 'string | undefined',
        loginLoading: 'boolean',
        agents:
          'AgentProfileSummary[] — cache of all fetched agent profiles (did, firstName, lastName, handle, bio, avatar, coverImage, location)',
        ownAgent:
          "AgentProfileSummary | undefined — reactive accessor for the current user's own profile (derived from agents cache)",
        creatingSpace: 'boolean (true while a new space is being created)',
        orderedSidebarItems:
          'array of sidebar items in user-defined order (uuid, name, avatar, spaceId) — personal + shared spaces merged',
      },
      actions: {
        navigate: '(to: string, options?): navigates to a route',
        addNewSpace: '(space: Space): adds a new space',
        createSpace:
          '(name: string, description: string, shared: boolean, imageFile?: File): creates a new space with full setup',
        initializeAsWeSpace:
          "(name: string, description: string, avatarValue?: File | string | null): installs WE's Space SDNA into the current, already-joined, foreign-native perspective (e.g. one synced in from Flux) and creates a Space entity in place — access is always 'shared' since the perspective is already a published neighbourhood",
        switchPerspective:
          '(uuid: string): switches to a perspective by UUID, registers its SHACL models as dynamic model classes, and populates currentPerspectiveModels',
        removePerspective: '(uuid: string): removes a perspective by UUID',
        reorderPerspectives: '(newOrder: string[]): reorders the sidebar items by UUID array',
        login: '(password: string): logs in the agent with password',
        logout: '(): locks the agent and returns to login screen',
        fetchAgent: "(did: string): fetches and caches an agent's profile from their public AD4M perspective",
        updateOwnProfile:
          '(fields: { firstName?, lastName?, handle?, bio? }): updates own profile text fields and publishes to public perspective',
        updateProfileImage:
          '(field: "avatar" | "coverImage", imageFile: File): uploads image to FILE_STORAGE_LANGUAGE and publishes expression URL to public perspective',
        updateAgentLocation:
          '(update: { latitude?, longitude?, city?, country?, countryCode? }): merges location update into cache and publishes to public perspective',
        cleanupSpaceSdna:
          '(uuid?: string): one-time remediation for a perspective that accumulated duplicate SDNA installs (e.g. from before joinSpace checked for existing SDNA before installing) — removes the redundant duplicate link copies. Defaults to the current perspective. Returns a display-ready summary string naming how many links were removed and the DIDs that authored them (your own DID annotated with "(you)"), or an empty string if nothing needed cleaning up',
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
        activeShellView:
          "string | null (id of the currently open shell overlay: 'profile' | 'settings' | 'schema-tests' | 'landing-page' | null)",
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
        openShellView:
          "(id: string): opens a shell overlay by id ('profile' | 'settings' | 'schema-tests' | 'landing-page')",
        closeShellView: '(): closes the currently open shell overlay',
      },
    },
    spaceStore: {
      state: {
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
      },
      actions: {
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
      },
    },
    aiStore: {
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
