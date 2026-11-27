/**
 * The editor store over the real edit target and live documents, with the stores around it doubled.
 *
 * Plain store tests, run once under each reactivity port: Solid with its nested live documents, and
 * the test port with the plain ones, whose every read of a template wakes on every edit — so a
 * session that ended, a chat list that reloaded or a history that was trimmed on an edit fails there.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import type { TemplateSchema } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { solidLiveTemplates } from '../src/frameworks/solid/liveTemplate';
import { type LiveTemplates, plainLiveTemplates } from '../src/shared/liveTemplate';
import { createEditorStore, type EditorStore } from '../src/shared/stores/EditorStore';
import { createEditTarget, type EditTargetPort } from '../src/shared/stores/editTarget';
import type { EditingTheme } from '../src/shared/stores/ThemeStore';
import { createTemplateDrafts } from '../src/shared/templateDrafts';

const chatLoads: string[] = [];
vi.mock('../src/shared/editorChats', () => ({
  chatsAbout: async (_dataset: unknown, templateId: string) => {
    chatLoads.push(templateId);
    return { chats: [{ id: `chat-${templateId}`, name: 'Chat 1' }], latest: [] };
  },
  chatMessages: async () => [],
  startChat: async (_dataset: unknown, templateId: string, name: string) => ({ id: `new-${templateId}`, name }),
  appendMessage: async () => {},
  clearChat: async () => {},
  deleteChat: async () => {},
}));

const hosts: [string, () => { reactivity: ReactivityPort; liveTemplates: LiveTemplates }][] = [
  ['Solid', () => ({ reactivity: solidReactivity, liveTemplates: solidLiveTemplates })],
  [
    'the test port, with plain documents',
    () => {
      const reactivity = createTestReactivity();
      return { reactivity, liveTemplates: plainLiveTemplates(reactivity) };
    },
  ],
];

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const template = (id: string, text = 'Hello'): TemplateSchema =>
  ({
    schemaVersion: 1,
    id,
    type: 'Column',
    meta: { name: id, description: '', icon: 'cube' },
    children: [{ id: `${id}-text`, type: 'we-text', children: [text] }],
  }) as TemplateSchema;

const textOf = (t: TemplateSchema) => (t.children![0] as { children: string[] }).children[0];
const theme = (name: string) => ({ id: 'theme', name }) as unknown as EditingTheme;

describe.each(hosts)('the editor store under %s', (_name, host) => {
  let reactivity: ReactivityPort;
  let liveTemplates: LiveTemplates;
  const disposers: (() => void)[] = [];

  beforeEach(() => {
    ({ reactivity, liveTemplates } = host());
    chatLoads.length = 0;
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  function mount(options: { screen?: TemplateSchema; firstScreenOpen?: boolean } = {}) {
    const told: string[] = [];
    const saved: string[] = [];
    const appliedThemes: string[] = [];
    let history!: { onEntry: (snapshot: EditingTheme) => void; onClear: () => void };
    let probe!: { isEditing(t: TemplateSchema): boolean; replaced(t: TemplateSchema): void };
    const asked: string[] = [];

    const [rootDataset] = reactivity.signal<unknown>({ id: 'root', name: 'root', handle: {} });
    const [firstScreenOpen, setFirstScreenOpen] = reactivity.signal(options.firstScreenOpen ?? true);
    const [editingTheme, setEditingTheme] = reactivity.signal<EditingTheme | null>(null);
    const [currentThemeId, setCurrentThemeId] = reactivity.signal('theme');
    const languageModel = {
      converse: async () => ({ text: '' }),
      available: async () => (asked.push('available'), true),
      status: async () => ({ model: 'small', ready: true }),
    };

    let live!: ReturnType<LiveTemplates>;
    let edit!: EditTargetPort;
    let store!: EditorStore;
    disposers.push(
      reactivity.root(() => {
        live = liveTemplates(options.screen ?? template('mine'));
        const drafts = createTemplateDrafts({ reactivity, liveTemplates });
        const templateStore = {
          get currentTemplate() {
            return live.read();
          },
          updateTemplate: (next: TemplateSchema) => void live.update(next),
          ...drafts,
          persistTemplate: async (t: TemplateSchema) => void saved.push(textOf(t)),
          isBuiltInTemplateId: (id: string) => id === 'default',
          getTemplateRecord: (id: string) => (id === 'default' ? undefined : ({ id } as never)),
          provideEditingProbe: (p: typeof probe) => (probe = p),
          allTemplates: () => [],
          appTemplate: () => template('app'),
          appTemplateId: () => 'app',
          setAppTemplate: async () => true,
          saveTemplateAs: async () => true,
          storedAt: () => undefined,
          writtenElsewhere: (async <T>(_t: TemplateSchema, run: () => Promise<T>) => ({
            result: await run(),
            stored: undefined,
          })) as never,
        };
        edit = createEditTarget({ reactivity, templateStore });
        store = createEditorStore({
          reactivity,
          toasts: {
            info: (m) => told.push(m),
            success: (m) => told.push(m),
            warning: (m) => told.push(`warning: ${m}`),
            error: (m) => told.push(`error: ${m}`),
          },
          firstScreen: { open: firstScreenOpen },
          sessionStore: { backendPorts: () => ({ languageModel }) as never },
          datasetStore: {
            currentDataset: () => null,
            currentDatasetEntities: () => [],
            rootDataset: rootDataset as never,
          },
          shapeStore: { spaceShapes: () => [] },
          templateStore,
          themeStore: {
            editingTheme,
            currentThemeId,
            registerHistoryCallbacks: (callbacks) => (history = callbacks),
            applySnapshot: async (snapshot) => {
              appliedThemes.push(snapshot.name);
              setEditingTheme(snapshot);
            },
            startEditing: () => setEditingTheme(theme('Started')),
            cancelEditing: () => setEditingTheme(null),
          },
          editTarget: edit,
        });
      }),
    );
    /** An edit as every editing path makes one: a snapshot for undo, then the change. */
    const editText = (text: string) => {
      store.pushSnapshot();
      edit.update(template(reactivity.untrack(edit.template).id!, text));
    };
    return {
      store,
      edit,
      live,
      told,
      saved,
      asked,
      appliedThemes,
      history: () => history,
      probe: () => probe,
      editText,
      setFirstScreenOpen,
      setEditingTheme,
      setCurrentThemeId,
    };
  }

  it('opens a session on the template on screen and docks the chat; a built-in offers its fork instead', () => {
    const own = mount();
    expect(own.store.enterTemplateEditing()).toBe(true);
    expect(own.store.isEditingTemplate()).toBe(true);
    expect(own.store.aiDockEdge()).toBe('right');
    expect(own.store.codeDockEdge()).toBeNull();

    const builtIn = mount({ screen: template('default') });
    expect(builtIn.store.enterTemplateEditing()).toBe(false);
    expect(builtIn.store.isEditingTemplate()).toBe(false);
    expect(builtIn.store.pickerOpen()).toBe(true);
    expect(builtIn.store.pickerAction()).toBe('fork');
    expect(builtIn.store.pickerDefaultName()).toBe('default (copy)');
  });

  it('keeps the session and its chats through edits, and ends it when another template is put on screen', async () => {
    const { store, live, editText } = mount();
    await flush();
    expect(chatLoads).toEqual(['mine']);
    store.enterTemplateEditing();

    editText('One');
    editText('Two');
    await flush();
    expect(textOf(live.read())).toBe('Two');
    expect(store.isEditingTemplate()).toBe(true);
    expect(chatLoads).toEqual(['mine']);

    live.replace(template('other'));
    await flush();
    expect(store.isEditingTemplate()).toBe(false);
    expect(store.aiDockEdge()).toBeNull();
    expect(chatLoads).toEqual(['mine', 'other']);
  });

  it('undoes and redoes template and theme edits in the order they were made, saving each template step', async () => {
    const { store, live, saved, appliedThemes, history, editText, setEditingTheme } = mount();
    editText('One');
    setEditingTheme(theme('Before'));
    history().onEntry(theme('Before'));
    setEditingTheme(theme('After'));
    editText('Two');
    expect(store.canUndo()).toBe(true);

    await store.undo();
    expect(textOf(live.read())).toBe('One');
    await store.undo();
    expect(appliedThemes).toEqual(['Before']);
    await store.undo();
    expect(textOf(live.read())).toBe('Hello');
    expect(store.canUndo()).toBe(false);
    expect(saved).toEqual(['One', 'Hello']);

    await store.redo();
    expect(textOf(live.read())).toBe('One');
    await store.redo();
    expect(appliedThemes).toEqual(['Before', 'After']);
    await store.redo();
    expect(textOf(live.read())).toBe('Two');
    expect(store.canRedo()).toBe(false);
  });

  it('keeps each template’s history apart, and a theme entry survives the session going back to the same template', () => {
    const { store, edit, history, editText } = mount();
    editText('One');
    history().onEntry(theme('Before'));

    // Back to the template on screen, which it already was: the same history, theme entry and all.
    edit.leave();
    store.exitTemplateEditing();
    // Undoing the theme entry (the newest) leaves the template one.
    void store.undo();
    expect(store.canUndo()).toBe(true);

    // Another template's history is its own, and coming back finds this one's template entries.
    edit.enterApp(template('app'));
    expect(store.canUndo()).toBe(false);
    edit.leave();
    expect(store.canUndo()).toBe(true);
    void store.undo();
    expect(store.canUndo()).toBe(false);
  });

  it('starts the template history again when someone else’s version of it arrives', () => {
    const { store, editText, probe, history } = mount();
    store.enterTemplateEditing();
    editText('One');
    history().onEntry(theme('Before'));
    expect(probe().isEditing(template('mine'))).toBe(true);
    expect(probe().isEditing(template('other'))).toBe(false);

    probe().replaced(template('mine'));
    // The theme entry stays; the template one went.
    expect(store.canUndo()).toBe(true);
    void store.undo();
    expect(store.canUndo()).toBe(false);
  });

  it('applies the code panel’s JSON and saves it, and says so when it does not parse', async () => {
    const { store, live, saved } = mount();
    store.onSchemaEdit('{ not json');
    expect(textOf(live.read())).toBe('Hello');
    expect(store.messages().at(-1)?.content).toMatch(/Invalid JSON/);

    store.onSchemaEdit(JSON.stringify({ ...template('ignored', 'Typed'), id: 'ignored' }));
    await flush();
    expect(textOf(live.read())).toBe('Typed');
    // The panel does not get to change which template this is.
    expect(live.read().id).toBe('mine');
    expect(saved).toEqual(['Typed']);
    expect(store.canUndo()).toBe(true);
  });

  it('asks the node about its model only once the first screen is up', async () => {
    const { store, asked, setFirstScreenOpen } = mount({ firstScreenOpen: false });
    await flush();
    expect(asked).toEqual([]);
    expect(store.assistantAvailable()).toBe(false);

    setFirstScreenOpen(true);
    await flush();
    expect(asked).toEqual(['available']);
    expect(store.assistantAvailable()).toBe(true);
    expect(store.assistantStatus()?.model).toBe('small');
  });

  it('ends a theme session when another theme is put on screen, and toggles on what is visible', () => {
    const { store, setCurrentThemeId } = mount();
    store.enterThemeEditing();
    expect(store.isEditingTheme()).toBe(true);
    expect(store.themeDockEdge()).toBe('right');

    store.toggleThemeEditing();
    expect(store.isEditingTheme()).toBe(false);
    store.toggleThemeEditing();
    expect(store.themeDockEdge()).toBe('right');

    setCurrentThemeId('another');
    expect(store.isEditingTheme()).toBe(false);
    expect(store.themeDockEdge()).toBeNull();
  });

  it('closes the other panels when visual mode is chosen, and shows the properties panel there', () => {
    const { store } = mount();
    store.enterTemplateEditing();
    store.openCodePanel();
    expect(store.codeDockEdge()).toBe('right');

    store.setContentMode('visual');
    expect(store.aiDockEdge()).toBeNull();
    expect(store.codeDockEdge()).toBeNull();
    expect(store.visualDockEdge()).toBe('right');
    store.toggleVisualPanel();
    expect(store.visualDockEdge()).toBeNull();
  });
});
