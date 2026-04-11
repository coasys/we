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
    state: ['adamClient', 'me', 'mySpaces', 'bootState', 'passwordError', 'loginLoading'],
    actions: ['navigate', 'addNewSpace', 'createSpace', 'login'],
  },
  {
    name: 'routeStore',
    state: ['currentPath'],
    actions: ['navigate'],
  },
  {
    name: 'themeStore',
    state: ['themes', 'currentTheme'],
    actions: ['setThemes', 'setCurrentTheme'],
  },
  {
    name: 'templateStore',
    state: ['templates', 'currentTemplate'],
    actions: ['updateTemplate', 'switchTemplate', 'removeTemplate', 'saveTemplate'],
  },
  {
    name: 'spaceStore',
    state: ['spaceId', 'perspective', 'space', 'posts', 'loading'],
    actions: ['setSpaceId', 'getSpace', 'getPosts'],
  },
  {
    name: 'aiStore',
    state: ['models', 'tasks'],
    actions: ['handleSchemaPrompt'],
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
        mySpaces: 'array of Space objects',
        bootState: 'string',
        passwordError: 'string | undefined',
        loginLoading: 'boolean',
      },
      actions: {
        navigate: '(to: string, options?): navigates to a route',
        addNewSpace: '(space: Space): adds a new space',
        createSpace:
          '(name: string, description: string, shared: boolean, imageFile?: File): creates a new space with full setup',
        login: '(password: string): logs in the agent with password',
      },
    },
    routeStore: {
      state: { currentPath: 'string (the current route path)' },
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
        templates: 'array of TemplateSchema objects',
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
    for (const key of entry.state) {
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
