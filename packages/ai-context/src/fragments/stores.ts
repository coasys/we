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
      personalSpaces: { type: 'array', properties: ['uuid', 'name', 'description', 'url', 'visibility'] },
      sharedSpaces: { type: 'array', properties: ['uuid', 'name', 'description', 'url', 'visibility'] },
      bootState: { type: 'string' },
      passwordError: { type: 'string' },
      loginLoading: { type: 'boolean' },
      agentProfile: {
        type: 'object',
        properties: ['firstName', 'lastName', 'handle', 'bio', 'location', 'profileImage', 'coverImage'],
      },
    },
    actions: [
      'navigate',
      'addNewSpace',
      'createSpace',
      'removePerspective',
      'login',
      'logout',
      'updateAgentProfile',
      'updateProfileImage',
      'updateCoverImage',
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
      themes: { type: 'array', properties: ['id', 'name', 'icon'] },
      currentTheme: { type: 'object', properties: ['id', 'name', 'icon'] },
    },
    actions: ['setThemes', 'setCurrentTheme'],
  },
  {
    name: 'templateStore',
    state: {
      templates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      shellTemplates: { type: 'array', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      currentTemplate: { type: 'object', properties: ['id', 'meta', 'type', 'props', 'children', 'routes'] },
      operationLoading: { type: 'boolean' },
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
      spaceId: { type: 'string' },
      perspective: { type: 'object', properties: ['uuid', 'name', 'sharedUrl', 'neighbourhood'] },
      space: {
        type: 'object',
        properties: ['uuid', 'name', 'description', 'url', 'visibility', 'image', 'thumbnail'],
      },
      posts: { type: 'array', properties: ['id', 'author', 'timestamp', 'content'] },
      loading: { type: 'boolean' },
    },
    actions: ['setSpaceId', 'getSpace', 'getPosts', 'createPost', 'updateSpaceImage', 'updateSpaceCoverImage'],
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
      sessions: { type: 'array' },
      activeSessionId: { type: 'string' },
      panelMode: { type: 'string' },
      schemaJson: { type: 'string' },
      operationLoading: { type: 'boolean' },
    },
    actions: [
      'handleSchemaPrompt',
      'sendMessage',
      'close',
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
    ],
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
        personalSpaces: 'array of Space objects (local/personal spaces)',
        sharedSpaces: 'array of Space objects (shared/neighbourhood spaces)',
        bootState: 'string',
        passwordError: 'string | undefined',
        loginLoading: 'boolean',
        agentProfile: 'AgentProfile | null (the current agent profile with name, bio, images, etc.)',
      },
      actions: {
        navigate: '(to: string, options?): navigates to a route',
        addNewSpace: '(space: Space): adds a new space',
        createSpace:
          '(name: string, description: string, shared: boolean, imageFile?: File): creates a new space with full setup',
        login: '(password: string): logs in the agent with password',
        logout: '(): locks the agent and returns to login screen',
        updateAgentProfile:
          '(updates: Partial<AgentProfile>): updates profile fields (firstName, lastName, handle, bio, location)',
        updateProfileImage: '(imageFile: File): uploads and sets the profile image',
        updateCoverImage: '(imageFile: File): uploads and sets the cover image',
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
        themes: 'array of ThemeWithId objects',
        currentTheme: 'ThemeWithId (the active theme)',
      },
      actions: {
        setThemes: '(themes: ThemeWithId[]): sets available themes',
        setCurrentTheme: '(theme: ThemeWithId): sets the active theme',
      },
    },
    templateStore: {
      state: {
        templates: 'array of TemplateSchema objects (user-facing templates)',
        shellTemplates: 'array of TemplateSchema objects (static system pages: profile, settings, tests)',
        currentTemplate: 'TemplateSchema (the active template)',
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
        spaceId: 'string (current space id)',
        perspective: 'PerspectiveProxy | null',
        space: 'Partial<Space> (current space object)',
        posts: 'array of Post objects',
        loading: 'boolean',
      },
      actions: {
        setSpaceId: '(id: string): sets the current space id',
        getSpace: '(): loads space data',
        getPosts: '(perspective: PerspectiveProxy): loads posts for a space',
      },
    },
    aiStore: {
      state: {
        models: 'array of Model objects',
        tasks: 'array of AITask objects',
      },
      actions: { handleSchemaPrompt: '(prompt: string): generates a schema from a prompt' },
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
