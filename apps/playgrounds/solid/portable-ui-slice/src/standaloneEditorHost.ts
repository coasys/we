import type { EditorHost, EditorTheme } from '@we/editor';
import type { TemplateSchema } from '@we/schema-shared';
import { createSignal } from 'solid-js';

/**
 * A complete `EditorHost` built from plain signals and an array.
 *
 * This exists to be *proof rather than documentation*. `@we/editor` claims to reach its application
 * only through ports; the way to know that is true is to satisfy those ports with something that has
 * no WE shell, no stores, no perspective and no `@coasys/*` anywhere in its dependency graph, and
 * see the surface mount and run.
 *
 * It is also the honest answer to "what would adopting this cost?" — the file below is the whole
 * integration for an application that already has templates of its own. Everything unimplemented
 * throws or no-ops loudly rather than pretending, because a port that silently does nothing is worse
 * than one that is obviously absent.
 */
export function createStandaloneEditorHost(initial: TemplateSchema): {
  host: EditorHost;
  template: () => TemplateSchema;
} {
  const [template, setTemplate] = createSignal<TemplateSchema>(initial);
  const [schemaJson, setSchemaJson] = createSignal(JSON.stringify(initial, null, 2));

  const [editingTemplate, setEditingTemplate] = createSignal(false);
  const [editingTheme, setEditingTheme] = createSignal(false);
  const [contentMode, setContentMode] = createSignal<'preview' | 'visual'>('preview');

  const [aiOpen, setAiOpen] = createSignal(false);
  const [codeOpen, setCodeOpen] = createSignal(false);
  const [themeOpen, setThemeOpen] = createSignal(false);
  const [visualOpen, setVisualOpen] = createSignal(false);

  const themes: EditorTheme[] = [{ id: 'default', name: 'Default', icon: 'paint-bucket', origin: 'built-in' }];
  const [currentThemeId, setCurrentThemeId] = createSignal('default');

  const notImplemented = (what: string) => () => {
    throw new Error(`standalone host: ${what} is not implemented`);
  };

  const host: EditorHost = {
    template: {
      get currentTemplate() {
        return template();
      },
      switcherGroups: () => [{ label: 'Local', items: [{ id: 'demo', name: 'Demo feed', icon: 'list' }] }],
      updateTemplate: (next) => {
        setTemplate(next);
        setSchemaJson(JSON.stringify(next, null, 2));
      },
      switchTemplate: () => {},
      persistCurrentTemplate: async () => {},
      operationLoading: () => null,
      installFromMarketplace: async () => {},
      deleteMarketplaceTemplate: async () => {},
      publishToSpace: async () => false,
      publishToMarketplace: async () => undefined,
    },

    theme: {
      allThemes: () => themes,
      builtInThemes: () => themes,
      installedThemes: () => [],
      spaceThemes: () => [],
      currentTheme: () => themes[0],
      currentThemeId,
      setCurrentTheme: setCurrentThemeId,
      editingTheme: () => null,
      startEditing: () => {},
      createAndStartEditing: () => false,
      changeBasePreset: () => {},
      updateEditingOverrides: () => {},
      updateEditingCss: () => {},
      updateEditingMeta: () => {},
      saveEditingTheme: async () => null,
      themeScope: () => 'global',
      // `toggleThemeScope` was renamed to a preference plus an explicit preview when scoping grew a
      // third state; this stand-in host still implemented the old one, which nothing called.
      themeScopePreference: () => 'global',
      previewThemeScope: () => {},
      publishToSpace: async () => false,
      publishToMarketplace: async () => undefined,
    },

    session: {
      isEditingTemplate: editingTemplate,
      isEditingTheme: editingTheme,
      editAction: () => null,
      enterTemplateEditing: () => setEditingTemplate(true),
      exitTemplateEditing: () => setEditingTemplate(false),
      enterThemeEditing: () => setEditingTheme(true),
      exitThemeEditing: () => setEditingTheme(false),
      toggleThemeEditing: () => setEditingTheme((v) => !v),

      contentMode,
      setContentMode,
      schemaJson,
      onSchemaEdit: (json) => {
        setSchemaJson(json);
        try {
          setTemplate(JSON.parse(json) as TemplateSchema);
        } catch {
          // Invalid JSON while typing — keep the last good template, exactly as WE does.
        }
      },
      canUndo: () => false,
      canRedo: () => false,
      undo: async () => {},
      redo: async () => {},
      pushSnapshot: () => {},

      templateName: () => 'Demo feed',
      templateIcon: () => 'list',
      isReadOnly: () => false,
      hasPendingChanges: () => false,
      startFork: () => {},
      startFresh: () => {},
      pickerOpen: () => false,
      pickerAction: () => 'fork',
      pickerDefaultName: () => '',
      pickerDefaultIcon: () => '',
      pickerShowDestination: () => false,
      confirmPicker: async () => {},
      cancelPicker: () => {},

      isOpen: aiOpen,
      toggle: () => setAiOpen((v) => !v),
      open: () => setAiOpen(true),
      close: () => setAiOpen(false),
      codePanelOpen: codeOpen,
      toggleCodePanel: () => setCodeOpen((v) => !v),
      openCodePanel: () => setCodeOpen(true),
      closeCodePanel: () => setCodeOpen(false),
      themePanelOpen: themeOpen,
      toggleThemePanel: () => setThemeOpen((v) => !v),
      openThemePanel: () => setThemeOpen(true),
      closeThemePanel: () => setThemeOpen(false),
      visualPanelOpen: visualOpen,
      toggleVisualPanel: () => setVisualOpen((v) => !v),

      // No assistant in this harness — the editor's AI entry is simply not mounted.
      messages: () => [],
      isStreaming: () => false,
      streamingContent: () => '',
      apiKeyConfigured: () => false,
      setApiKey: () => {},
      sendMessage: notImplemented('sendMessage'),
      clearHistory: () => {},
      sessions: () => [],
      activeSessionId: () => null,
      newChat: () => {},
      switchSession: () => {},
      deleteSession: async () => {},
    },

    identity: {
      me: () => ({ did: 'did:example:local' }),
      currentPerspective: () => null,
      orderedSidebarItems: () => [],
      marketplaceJoined: () => false,
      spaceDefaultTemplateId: () => '',
      spaceDefaultThemeId: () => '',
      agents: () => [],
      fetchAgent: () => {},
    },

    // No image port: the background picker degrades to its URL tab, which is the designed behaviour
    // for a host without image storage.
  };

  return { host, template };
}
