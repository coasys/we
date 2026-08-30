/**
 * EditorStore — the editor's state: chat sessions and messages per template,
 * panel visibility and widths, preview/visual mode, unified template+theme undo/redo, pending
 * (buffered) changes for read-only templates, and the fork/fresh picker.
 *
 * The AI half of a session is deliberately elsewhere: the Anthropic client, streaming, prompt
 * assembly and tool definition live in `shared/ai/aiInfra`, and patch application in
 * `shared/ai/schemaPatches` — this store orchestrates them against its own signals. That split is
 * what keeps a future backend-executed assistant a drop-in: it would replace the infra modules
 * and the `sendViaClaude` orchestration, not the session state.
 */
import { formatExternalManifestForPrompt, sendClaudeRequest } from '@shared/ai/aiInfra';
import { applySchemaPatches, type SchemaPatch } from '@shared/ai/schemaPatches';
import { registerHostDockStore, unregisterHostDockStore } from '@shared/registries/dockRegistry';
import { EDITOR_STORE_ID } from '@shared/registries/editorDocks';
import { deepClone } from '@shared/utils';
import { type EditingTheme, useDatasetStore, useTemplateStore, useThemeStore } from '@solid/stores';
import { toastService } from '@we/components/solid';
import { ChatMessage as ChatMessageRecord, ChatSession as ChatSessionRecord } from '@we/entities';
import type { DockEdge, DockSize } from '@we/module-shared';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { contextData, setLocalWarningSink } from '@we/schema-shared';
import {
  buildValidationContext,
  ensureNodeIds,
  stripNodeIds,
  validateSemantic,
  validateStructure,
} from '@we/schema-shared';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  status?: 'sending' | 'streaming' | 'sent' | 'error';
}

type HistoryEntry = { type: 'template'; snapshot: TemplateSchema } | { type: 'theme'; snapshot: EditingTheme };

// Base validation context built once from the static generated context data.
// External perspective models are merged in reactively inside EditorStoreProvider.
const baseValidationCtx = buildValidationContext(contextData);

export interface EditorStore {
  // --- Chat state ---
  messages: Accessor<ChatMessage[]>;
  isOpen: Accessor<boolean>;
  isStreaming: Accessor<boolean>;
  streamingContent: Accessor<string>;
  apiKeyConfigured: Accessor<boolean>;

  // --- Template context ---
  templateName: Accessor<string>;
  templateIcon: Accessor<string>;
  isReadOnly: Accessor<boolean>;
  hasPendingChanges: Accessor<boolean>;

  // --- Picker state ---
  pickerOpen: Accessor<boolean>;
  pickerAction: Accessor<'fork' | 'fresh'>;
  pickerDefaultName: Accessor<string>;
  pickerDefaultIcon: Accessor<string>;
  pickerShowDestination: Accessor<boolean>;

  // --- Session management ---
  sessions: Accessor<ChatSessionRecord[]>;
  activeSessionId: Accessor<string | null>;
  newChat: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;

  // --- Content mode (preview / visual) ---
  contentMode: Accessor<'preview' | 'visual'>;
  setContentMode: (mode: 'preview' | 'visual') => void;
  schemaJson: Accessor<string>;
  onSchemaEdit: (json: string) => void;

  // --- Undo / Redo ---
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  pushSnapshot: () => void;

  // --- Template actions ---
  startFork: () => void;
  startFresh: () => void;
  confirmPicker: (name: string, icon: string, destination: 'personal' | 'space') => Promise<void>;
  cancelPicker: () => void;

  // --- Template editing mode ---
  isEditingTemplate: Accessor<boolean>;
  editAction: Accessor<'edit' | 'fork' | 'fresh' | null>;
  enterTemplateEditing: (action?: 'edit' | 'fork' | 'fresh') => void;
  exitTemplateEditing: () => void;

  // --- Panel control (AI chat) ---
  toggle: () => void;
  open: () => void;
  close: () => void;

  // --- Code panel ---
  codePanelOpen: Accessor<boolean>;
  toggleCodePanel: () => void;
  openCodePanel: () => void;
  closeCodePanel: () => void;

  // --- Theme panel ---
  themePanelOpen: Accessor<boolean>;
  toggleThemePanel: () => void;
  openThemePanel: () => void;
  closeThemePanel: () => void;

  // --- Visual properties panel ---
  visualPanelOpen: Accessor<boolean>;
  toggleVisualPanel: () => void;

  // --- Theme editing mode (independent of template editing) ---
  isEditingTheme: Accessor<boolean>;
  enterThemeEditing: () => void;
  exitThemeEditing: () => void;
  toggleThemeEditing: () => void;

  // --- Panel widths (persisted) ---
  /**
   * Where each panel should open, or `null` while it is closed — the keys the host's dock system
   * reads to place them. See `registries/editorDocks.ts`.
   *
   * All four answer `'right'`, which is an *opening bid* and nothing more: the user drags a panel
   * wherever they want it and the shell remembers, per device. The widths that used to live here went
   * with the rails that set them — a panel's size is dragged from any edge or corner now, and stored
   * beside its position rather than in four separate localStorage keys.
   */
  aiDockEdge: Accessor<DockEdge>;
  codeDockEdge: Accessor<DockEdge>;
  themeDockEdge: Accessor<DockEdge>;
  visualDockEdge: Accessor<DockEdge>;
  /** The opening size and overlay bid every editor panel shares. */
  editorDockSize: Accessor<DockSize>;
  editorDockFloat: Accessor<boolean>;

  // --- Chat actions ---
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;

  // --- Settings ---
  setApiKey: (key: string) => Promise<boolean>;
}

/**
 * A development-only console line, with the guard written once.
 *
 * The AI patch loop is the one path in the app where watching the intermediate values is the only
 * way to understand a failure — what the model asked for, what the merge produced, which validation
 * rejected it — so the lines are worth keeping. Every one of them carried its own
 * `if (import.meta.env.DEV)`, which is eight chances to forget the guard and ship the noise, and
 * eight things a reader has to check.
 *
 * `console.log` rather than `info`: this genuinely is debugging output, and the lint rule that
 * refuses it in library source is right to. The disable is here, once, where the guard is.
 */
function devLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.log(...args);
}

const EditorContext = createContext<EditorStore>();

let msgIdCounter = 0;
function createMessage(role: ChatMessage['role'], content: string, status?: ChatMessage['status']): ChatMessage {
  return {
    id: `msg-${++msgIdCounter}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    status,
  };
}

/** Minimal starter template for "Start Fresh" */
const starterTemplate: SchemaNode = {
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'page' },
  children: [
    {
      type: 'Column',
      props: { p: '600', gap: '300', bg: 'accent-muted' },
      children: [{ type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Welcome'] }],
    },
    {
      type: 'Column',
      props: { p: '600', styles: { flex: '1' } },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'text-faint' },
          children: ['Chat with AI to build your interface.'],
        },
      ],
    },
  ],
};

export function EditorStoreProvider(props: ParentProps) {
  const datasetStore = useDatasetStore();
  const templateStore = useTemplateStore();
  const themeStore = useThemeStore();

  // Reactive validation context — perspective-accurate model allowlist.
  // When a perspective is active its full manifest (WE + external) is used to
  // narrow entityNames to only what is actually registered there.  WE models
  // not present in the manifest (e.g. CollectionBlock in we-root) are excluded.
  // Falls back to the all-WE base context when no perspective is set.
  const getValidationCtx = createMemo(() => {
    const manifest = datasetStore.currentDatasetEntities();
    if (manifest.length === 0) return baseValidationCtx;
    const perspectiveEntityNames = new Set(manifest.map((m) => m.name));
    return { ...baseValidationCtx, entityNames: perspectiveEntityNames };
  });

  // --- Chat state ---
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal('');
  const [apiKey, setApiKeySignal] = createSignal('');

  const apiKeyConfigured = () => apiKey().length > 0;

  // --- Session management ---
  const [sessions, setSessions] = createSignal<ChatSessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  // Track the AD4M ChatSession model instance for the active session
  let activeSessionRecord: ChatSessionRecord | null = null;

  // --- Content mode (preview / visual / code) ---
  const [contentMode, setContentModeSignal] = createSignal<'preview' | 'visual'>('preview');
  const schemaJson = () =>
    JSON.stringify(stripNodeIds(deepClone(templateStore.currentTemplate) as SchemaNode), null, 2);

  // --- Template context (computed) ---
  const templateName = () => templateStore.currentTemplate.meta?.name || templateStore.currentTemplate.id || 'Template';
  const templateIcon = () => templateStore.currentTemplate.meta?.icon || 'cube';
  const isReadOnly = () => {
    const id = templateStore.currentTemplate.id;
    return !!id && templateStore.isBuiltInTemplate(id);
  };

  // --- Pending changes (buffered edits for read-only templates) ---
  const [pendingTemplate, setPendingTemplate] = createSignal<TemplateSchema | null>(null);
  const hasPendingChanges = () => pendingTemplate() !== null;

  // --- Unified Undo / Redo (covers template and theme edits in chronological order) ---
  const MAX_UNDO = 50;
  const [undoStack, setUndoStack] = createSignal<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = createSignal<HistoryEntry[]>([]);
  const stackCache = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();
  let prevTemplateId: string | undefined;
  const canUndo: Accessor<boolean> = () => undoStack().length > 0;
  const canRedo: Accessor<boolean> = () => redoStack().length > 0;

  function pushSnapshot() {
    const current = isReadOnly()
      ? (pendingTemplate() ?? deepClone(templateStore.currentTemplate))
      : deepClone(templateStore.currentTemplate);
    setUndoStack((prev) => {
      const next = [...prev, { type: 'template' as const, snapshot: current as TemplateSchema }];
      return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
    });
    setRedoStack([]);
  }

  async function undo() {
    const stack = undoStack();
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    if (entry.type === 'template') {
      const currentSnap = (
        isReadOnly()
          ? (pendingTemplate() ?? deepClone(templateStore.currentTemplate))
          : deepClone(templateStore.currentTemplate)
      ) as TemplateSchema;
      setRedoStack((prev) => [...prev, { type: 'template' as const, snapshot: currentSnap }]);
      if (isReadOnly()) {
        setPendingTemplate(entry.snapshot);
      } else {
        templateStore.updateTemplate(entry.snapshot);
        try {
          await templateStore.persistCurrentTemplate();
        } catch {
          /* key may already exist */
        }
      }
    } else {
      const current = themeStore.editingTheme();
      if (current) setRedoStack((prev) => [...prev, { type: 'theme' as const, snapshot: { ...current } }]);
      await themeStore.applySnapshot(entry.snapshot);
    }
  }

  async function redo() {
    const stack = redoStack();
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));

    if (entry.type === 'template') {
      const currentSnap = (
        isReadOnly()
          ? (pendingTemplate() ?? deepClone(templateStore.currentTemplate))
          : deepClone(templateStore.currentTemplate)
      ) as TemplateSchema;
      setUndoStack((prev) => [...prev, { type: 'template' as const, snapshot: currentSnap }]);
      if (isReadOnly()) {
        setPendingTemplate(entry.snapshot);
      } else {
        templateStore.updateTemplate(entry.snapshot);
        try {
          await templateStore.persistCurrentTemplate();
        } catch {
          /* key may already exist */
        }
      }
    } else {
      const current = themeStore.editingTheme();
      if (current) setUndoStack((prev) => [...prev, { type: 'theme' as const, snapshot: { ...current } }]);
      await themeStore.applySnapshot(entry.snapshot);
    }
  }

  // Wire theme history into the unified stack. ThemeStore is a parent provider and
  // cannot call back into EditorStore, so we register callbacks here after both stores
  // and the stack signals are initialised.
  themeStore.registerHistoryCallbacks({
    onEntry: (snapshot: EditingTheme) => {
      setUndoStack((prev) => {
        const next = [...prev, { type: 'theme' as const, snapshot }];
        return next.length > MAX_UNDO ? next.slice(-MAX_UNDO) : next;
      });
      setRedoStack([]);
    },
    onClear: () => {
      setUndoStack((prev) => prev.filter((e) => e.type !== 'theme'));
      setRedoStack((prev) => prev.filter((e) => e.type !== 'theme'));
    },
  });

  // --- Name + Icon picker state ---
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerAction, setPickerAction] = createSignal<'fork' | 'fresh'>('fork');
  const [pickerDefaultName, setPickerDefaultName] = createSignal('');
  const [pickerDefaultIcon, setPickerDefaultIcon] = createSignal('cube');
  const pickerShowDestination = () => !!datasetStore.currentDataset();

  // ----------------------------------------------------------------
  // Session management — load, create, switch, delete
  // ----------------------------------------------------------------

  /** Load sessions for a given template and activate the most recent one */
  async function loadSessionsForTemplate(templateId: string) {
    // Core (read-only) templates use ephemeral in-memory sessions
    if (templateStore.isBuiltInTemplate(templateId)) {
      setSessions([]);
      setActiveSessionId(null);
      activeSessionRecord = null;
      setMessages([]);
      return;
    }

    const templateRecord = templateStore.getTemplateRecord(templateId);
    if (!templateRecord) {
      setSessions([]);
      setActiveSessionId(null);
      activeSessionRecord = null;
      setMessages([]);
      return;
    }

    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return;

    try {
      // Single query: sessions for this template with messages already hydrated
      const templateSessions = await ChatSessionRecord.findAll(perspective, {
        where: { templateId: templateRecord.id },
        order: { updatedAt: 'DESC' },
        include: { messages: { order: { createdAt: 'ASC' } } },
      });

      setSessions(templateSessions);

      // Activate the most recent session
      if (templateSessions.length > 0) {
        const latest = templateSessions[0];
        setActiveSessionId(latest.id);
        activeSessionRecord = latest;
        setMessages((latest.messages as ChatMessage[]) || []);
      } else {
        setActiveSessionId(null);
        activeSessionRecord = null;
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to load sessions for template', templateId, err);
      setSessions([]);
      setActiveSessionId(null);
      activeSessionRecord = null;
      setMessages([]);
    }
  }

  /** Create a new chat session for the current template */
  async function newChat() {
    const templateId = templateStore.currentTemplate.id;
    if (!templateId || templateStore.isBuiltInTemplate(templateId)) {
      // For core templates, clear in-memory messages (ephemeral sessions)
      setMessages([]);
      setMessages((prev) => [...prev, createMessage('assistant', 'Chat cleared. Start a new conversation!')]);
      return;
    }

    const templateRecord = templateStore.getTemplateRecord(templateId);
    const perspective = datasetStore.rootDataset()?.handle;
    if (!templateRecord || !perspective) return;

    try {
      const sessionName = `Chat ${sessions().length + 1}`;
      const now = new Date().toISOString();
      const session = await ChatSessionRecord.create(perspective, {
        name: sessionName,
        templateId: templateRecord.id,
        updatedAt: now,
      });

      activeSessionRecord = session;
      setActiveSessionId(session.id);
      setMessages([]);
      setSessions((prev) => [session, ...prev]);
    } catch (err) {
      console.error('Failed to create new chat session', err);
      // The button leaves the old conversation on screen when this fails, so without a word it
      // reads as "New chat does nothing".
      toastService.error('Could not start a new chat');
    }
  }

  /** Switch to an existing session */
  async function switchSession(sessionId: string) {
    if (sessionId === activeSessionId()) return;

    const target = sessions().find((s) => s.id === sessionId);
    if (!target) return;

    activeSessionRecord = target;
    setActiveSessionId(sessionId);
    setMessages((target.messages as ChatMessage[]) || []);
  }

  /** Delete a session and its messages */
  async function deleteSession(sessionId: string) {
    const templateId = templateStore.currentTemplate.id;
    if (!templateId) return;

    const templateRecord = templateStore.getTemplateRecord(templateId);
    const perspective = datasetStore.rootDataset()?.handle;
    if (!templateRecord || !perspective) return;

    try {
      const target = sessions().find((s) => s.id === sessionId);
      if (!target) return;

      // Delete all hydrated messages in the session
      for (const msg of target.messages || []) {
        await (msg as ChatMessageRecord).delete();
      }

      await target.delete();

      // Update local state
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));

      if (activeSessionId() === sessionId) {
        const remaining = sessions();
        if (remaining.length > 0) {
          const next = remaining[0];
          activeSessionRecord = next;
          setActiveSessionId(next.id);
          setMessages((next.messages as ChatMessage[]) || []);
        } else {
          setActiveSessionId(null);
          activeSessionRecord = null;
          setMessages([]);
        }
      }
    } catch (err) {
      console.error('Failed to delete session', err);
      // A delete that fails silently leaves the row there, which reads as a stuck button — and
      // invites a second press at a delete that may have half-run.
      toastService.error('Could not delete that chat');
    }
  }

  /** Persist a message to AD4M and link it to the active session */
  async function persistMessage(role: 'user' | 'assistant', content: string) {
    if (!activeSessionRecord) return;

    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return;

    try {
      await ChatMessageRecord.create(
        perspective,
        { role, content },
        { parent: { model: ChatSessionRecord, id: activeSessionRecord.id } },
      );
    } catch (err) {
      console.error('Failed to persist message', err);
    }
  }

  // ----------------------------------------------------------------
  // Template editing mode
  // ----------------------------------------------------------------
  const [isEditingTemplate, setIsEditingTemplate] = createSignal(false);
  const [editAction, setEditAction] = createSignal<'edit' | 'fork' | 'fresh' | null>(null);

  function enterTemplateEditing(action: 'edit' | 'fork' | 'fresh' = 'edit') {
    setEditAction(action);
    setIsEditingTemplate(true);
    setIsOpen(true);
    setCodePanelOpen(false);
    setContentModeSignal('preview');
    setThemePanelOpen(false);
  }

  function exitTemplateEditing() {
    setIsEditingTemplate(false);
    setEditAction(null);
    setIsOpen(false);
    setCodePanelOpen(false);
    setContentModeSignal('preview');
    // Theme editing is independent — not closed here
  }

  // ----------------------------------------------------------------
  // Theme editing mode (independent of template editing)
  // ----------------------------------------------------------------
  // Derived from ThemeStore — single source of truth for whether a theme is being edited.
  const isEditingTheme: Accessor<boolean> = () => !!themeStore.editingTheme();

  /**
   * Open the theme editor, and make sure there is something for it to edit.
   *
   * The panel docks only when its flag *and* an editing session are both live — see `dockedWhen`.
   * That invariant used to be held by convention at four call sites, each remembering to call
   * `themeStore.startEditing()` first, and anything that hid the panel without ending the session
   * left the two disagreeing. From there the editor was unreachable: the flag was already true, so
   * setting it again changed nothing, and no amount of clicking or refreshing produced a panel.
   * Opening a *different* panel was the only way out, because that re-ran the layout with the pair
   * in agreement again.
   *
   * Starting a session here makes the function do what its name says, and makes the invariant the
   * state machine's problem rather than every caller's. Calling it with a session already open is a
   * no-op, so the existing call sites keep working unchanged.
   */
  function enterThemeEditing() {
    if (!themeStore.editingTheme()) themeStore.startEditing();
    setThemePanelOpen(true);
    setIsOpen(false);
    setCodePanelOpen(false);
    setContentModeSignal('preview');
  }

  function exitThemeEditing() {
    // Close panel first so ThemePanel.onCleanup fires and saves any pending debounced changes
    // before cancelEditing clears editingTheme (which would make saveEditingTheme bail early).
    setThemePanelOpen(false);
    themeStore.cancelEditing();
  }

  // Template-authoring warnings ($setLocal on an undeclared field, …) surface as
  // toasts only while an editing surface is open. Installing this for every viewer
  // toasted warnings from *stored* templates at people merely opening a space —
  // an authoring diagnostic aimed at whoever can act on it, so it follows the
  // editing session. The console keeps a copy either way (see schema-shared's
  // propResolvers/local.ts).
  createEffect(() => {
    const authoring = isEditingTemplate() || isEditingTheme() || isOpen();
    setLocalWarningSink(authoring ? (message) => toastService.warning(message) : null);
  });
  onCleanup(() => setLocalWarningSink(null));

  /**
   * Toggle on what is *visible*, not on whether a session happens to be open.
   *
   * Keyed on `isEditingTheme` this inverted the moment the two fell out of step: with a session
   * running and the panel hidden — which is what `enterTemplateEditing` and switching to visual mode
   * both leave behind — the first press "closed" something already closed, and the second reopened a
   * panel that could not dock. Reading the dock edge asks the question the user is actually asking,
   * which is whether they can see the thing.
   */
  function toggleThemeEditing() {
    if (themeDockEdge()) {
      exitThemeEditing();
    } else {
      enterThemeEditing();
    }
  }

  /**
   * Switching to a different theme ends the editing session on the old one.
   *
   * Untracks the guard so entering edit mode does not re-trigger this. The identity check matters:
   * `saveEditingTheme` persists the theme and *then* makes it current, so a bare "the id changed"
   * would tear down the session the user is still in the moment they saved.
   *
   * Lives here rather than in the chrome that used to own it because it is session logic, not a
   * view concern — and the picker that replaced that chrome is a schema, which has no `createEffect`.
   */
  createEffect(() => {
    const newId = themeStore.currentThemeId();
    if (!untrack(() => isEditingTheme())) return;
    if (newId !== untrack(() => themeStore.editingTheme()?.id)) exitThemeEditing();
  });

  /**
   * Undo/redo from the keyboard, for as long as an editing session is open.
   *
   * Bound to the document rather than to a surface: the thing being edited is the template filling
   * the window, so there is no element that usefully owns the shortcut. Fields are exempt — inside
   * an input, Ctrl-Z means the text, and stealing it would make the name box in a fork dialog
   * silently un-undoable.
   */
  createEffect(() => {
    if (!isEditingTemplate() && !isEditingTheme()) return;

    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key !== 'z' && event.key !== 'Z') return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      if (event.shiftKey) {
        if (canRedo()) void redo();
      } else if (canUndo()) {
        void undo();
      }
    };

    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  // ----------------------------------------------------------------
  // Panel control
  // ----------------------------------------------------------------
  function toggle() {
    setIsOpen((v) => !v);
  }
  function open() {
    setIsOpen(true);
  }
  function close() {
    setIsOpen(false);
  }

  // Code panel
  const [codePanelOpen, setCodePanelOpen] = createSignal(false);
  function toggleCodePanel() {
    setCodePanelOpen((v) => !v);
  }
  function openCodePanel() {
    setCodePanelOpen(true);
  }
  function closeCodePanel() {
    setCodePanelOpen(false);
  }

  function setContentMode(mode: 'preview' | 'visual') {
    if (mode === 'visual') {
      setIsOpen(false);
      setCodePanelOpen(false);
      setThemePanelOpen(false);
    }
    setContentModeSignal(mode);
  }

  // Theme panel
  const [themePanelOpen, setThemePanelOpen] = createSignal(false);
  function toggleThemePanel() {
    setThemePanelOpen((v) => !v);
  }
  function openThemePanel() {
    setThemePanelOpen(true);
  }
  function closeThemePanel() {
    setThemePanelOpen(false);
  }

  // Visual properties panel — open by default when entering visual mode
  const [visualPanelOpen, setVisualPanelOpen] = createSignal(true);
  function toggleVisualPanel() {
    setVisualPanelOpen((v) => !v);
  }

  /*
    What the host's dock system reads: an edge while the panel is open, and null while it is not.

    Four panels, one shape. Each is gated on the session it belongs to as well as its own flag —
    a code panel left open has nothing to show once template editing ends, and a dock whose edge went
    on answering would keep an empty frame on screen.

    The widths that used to sit here are gone with the rails that set them. Size, position, whether a
    panel displaces content and whether it covers the screen are all the shell's now, remembered per
    device beside every other panel's — which is what stopped the editor being a second, slightly
    different panel system at the same edge.
  */
  const dockedWhen = (open: Accessor<boolean>, session: Accessor<boolean>): Accessor<DockEdge> =>
    createMemo(() => (session() && open() ? 'right' : null));

  const aiDockEdge = dockedWhen(isOpen, isEditingTemplate);
  const codeDockEdge = dockedWhen(codePanelOpen, isEditingTemplate);
  const themeDockEdge = dockedWhen(themePanelOpen, isEditingTheme);
  // Properties is the one with a third condition: there is nothing to inspect outside visual mode.
  const visualDockEdge = createMemo<DockEdge>(() =>
    isEditingTemplate() && contentMode() === 'visual' && visualPanelOpen() ? 'right' : null,
  );

  // ----------------------------------------------------------------
  // API key management (persisted to AgentSettings)
  // ----------------------------------------------------------------
  // Returns the write rather than dropping it, so a schema's `onError`/`onFinally` can fire and a
  // caller can await. `updateAgentSettings` toasts a failure of its own; this is the other channel.
  function setApiKey(key: string): Promise<boolean> {
    setApiKeySignal(key);
    return datasetStore.updateAgentSettings({ claudeApiKey: key });
  }

  // Load persisted API key when agentSettings become available
  createEffect(() => {
    const settings = datasetStore.agentSettings();
    if (settings?.claudeApiKey) {
      setApiKeySignal(settings.claudeApiKey);
    }
  });

  // ----------------------------------------------------------------
  // Template actions — Fork / Start Fresh / Picker
  // ----------------------------------------------------------------
  function startFork() {
    const name = templateStore.currentTemplate.meta?.name || templateStore.currentTemplate.id || '';
    setPickerDefaultName(`${name} (copy)`);
    setPickerDefaultIcon(templateStore.currentTemplate.meta?.icon || 'cube');
    setPickerAction('fork');
    setPickerOpen(true);
  }

  function startFresh() {
    setPickerDefaultName('');
    setPickerDefaultIcon('cube');
    setPickerAction('fresh');
    setPickerOpen(true);
  }

  async function confirmPicker(name: string, icon: string, destination: 'personal' | 'space') {
    // Don't close picker yet — let it show loading state
    const action = pickerAction();
    const templateId = `${name.toLowerCase().replace(/\s+/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;

    let schema: TemplateSchema;
    if (action === 'fresh') {
      schema = {
        ...deepClone(starterTemplate),
        id: templateId,
        meta: { name, icon, description: '' },
      } as TemplateSchema;
    } else {
      // Fork: clone current state (with any pending changes)
      const base = pendingTemplate() ?? templateStore.currentTemplate;
      schema = {
        ...deepClone(base),
        id: templateId,
        meta: { ...base.meta, name, icon },
      } as TemplateSchema;
    }

    const saveDestination = destination === 'space' ? 'space' : 'root';
    const success = await templateStore.saveTemplateAs(schema, saveDestination);
    setPickerOpen(false);
    if (!success) {
      setMessages((prev) => [...prev, createMessage('assistant', `Failed to save template "${name}".`)]);
      return;
    }

    if (action === 'fresh') {
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', `Created new template "${name}". Start chatting to build your interface!`),
      ]);
    } else {
      const hadPending = pendingTemplate() !== null;
      setPendingTemplate(null);
      const suffix = hadPending ? ' Pending changes have been applied.' : '';
      setMessages((prev) => [...prev, createMessage('assistant', `Forked as "${name}".${suffix}`)]);
    }

    // Enter template editing on the newly created template
    enterTemplateEditing(action as 'fork' | 'fresh');
  }

  function cancelPicker() {
    setPickerOpen(false);
  }

  // ----------------------------------------------------------------
  // Chat — send message (Claude primary, AD4M fallback)
  // ----------------------------------------------------------------
  async function sendMessage(text: string) {
    // Lazy session creation for custom templates: if no active session, create one
    const templateId = templateStore.currentTemplate.id;
    if (templateId && !templateStore.isBuiltInTemplate(templateId) && !activeSessionRecord) {
      await newChat();
    }

    // Add user message to chat
    const userMsg = createMessage('user', text, 'sending');
    setMessages((prev) => [...prev, userMsg]);

    // Persist user message to AD4M (custom templates only)
    if (activeSessionRecord) {
      persistMessage('user', text);
    }

    setIsStreaming(true);
    setStreamingContent('<span class="shimmer">*Thinking...*</span>');

    try {
      await sendViaClaude(text);
    } catch (err) {
      console.error('[EditorStore] sendMessage caught error:', err);
      const errorText = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, createMessage('assistant', `Error: ${errorText}`)]);
    } finally {
      // Mark user message as sent
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, status: 'sent' as const } : m)));
      /*
        Resolve any placeholder still marked `streaming`.

        `sendViaClaude` creates one before the first token and clears it only on the paths that
        finish — so a 401, a 429 or a timeout appended an error message *beside* an empty bubble
        that shimmered for the life of the panel. Every escape from that function passes through
        here, which is why the cleanup belongs here and not beside each throw.
      */
      setMessages((prev) =>
        prev.map((m) =>
          m.status === 'streaming'
            ? { ...m, status: undefined, content: m.content || 'The assistant stopped before replying.' }
            : m,
        ),
      );
      setIsStreaming(false);
      setStreamingContent('');
    }
  }

  // ----------------------------------------------------------------
  // Claude API path (client + streaming live in shared/ai/aiInfra)
  // ----------------------------------------------------------------

  async function sendViaClaude(text: string) {
    const claudeMessages: Array<{ role: string; content: unknown }> = buildClaudeMessages(text);

    // Create a placeholder assistant message — shows streaming content as tokens arrive
    const streamMsg = createMessage('assistant', '', 'streaming');
    setMessages((prev) => [...prev, streamMsg]);

    let allTextContent = '';
    const maxContinuations = 5; // Safety limit to prevent infinite loops

    /**
     * The template each turn patches — carried across turns, not re-read from the store.
     *
     * ## What re-reading lost
     *
     * `accumulatedSchema` was cloned from `templateStore.currentTemplate` at the top of every
     * continuation turn, on the assumption that the previous turn's patches are in the store by
     * then. For a *read-only* template they are not: the apply branch puts them in
     * `pendingTemplate` and deliberately leaves the store alone. So each turn patched the original
     * again and the buffer was overwritten — of five tool calls across five turns, only the last
     * one's work survived to the fork, and the assistant reported all five as applied.
     *
     * Held here instead, and updated wherever a turn's patches are accepted. `pendingTemplate` is
     * the seed rather than `currentTemplate`, so a conversation resumed against a template with
     * buffered changes continues from them rather than reverting them.
     */
    let workingSchema: SchemaNode = ensureNodeIds(
      deepClone(pendingTemplate() ?? templateStore.currentTemplate) as SchemaNode,
    );

    const showInlineStatus = (status: string) => {
      const sep = allTextContent ? '\n\n' : '';
      setStreamingContent(allTextContent + sep + `<span class="shimmer">*${status}*</span>`);
    };

    for (let turn = 0; turn <= maxContinuations; turn++) {
      let streamResult;
      try {
        streamResult = await sendClaudeRequest(
          apiKey(),
          claudeMessages,
          (accumulated) => {
            const sep = allTextContent && accumulated ? '\n\n' : '';
            setStreamingContent(allTextContent + sep + accumulated);
          },
          (textSoFar) => {
            const base = allTextContent + (allTextContent && textSoFar ? '\n\n' : '') + textSoFar;
            const sep = base ? '\n\n' : '';
            setStreamingContent(base + sep + '<span class="shimmer">*Updating template...*</span>');
          },
        );
      } catch (err) {
        console.error(`[EditorStore] Turn ${turn}: sendClaudeRequest threw`, err);
        throw err;
      }
      const { textContent, toolCalls, stopReason } = streamResult;

      if (textContent) {
        allTextContent += (allTextContent ? '\n\n' : '') + textContent;
      }

      /*
        Truncated, not finished.

        `max_tokens` was falling into the branch below and being reported as a completed turn, so a
        reply cut off mid-tool-call silently dropped the edit and told the user it had worked. The
        half-written text is still worth showing — it is usually most of an answer — but it has to
        be labelled, because the difference between "here is your change" and "here is most of a
        change I did not make" is the whole message.
      */
      if (stopReason === 'max_tokens') {
        setStreamingContent('');
        updateAssistantMessage(
          streamMsg.id,
          `${allTextContent}\n\n---\n\n**This reply was cut off before it finished, so no changes were applied.** Ask again, or in smaller steps.`.trim(),
        );
        return;
      }

      // No tool calls — text-only response, we're done
      if (stopReason === 'end_turn' || toolCalls.length === 0) {
        setStreamingContent('');
        updateAssistantMessage(streamMsg.id, allTextContent || 'No response from AI');
        return;
      }

      // Show working indicator while tool calls are processed
      // (already shown via onToolUseStart callback during streaming)

      // Process tool calls (stop_reason === 'tool_use')
      // Build assistant message content blocks for conversation history
      const assistantContent: Array<Record<string, unknown>> = [];
      if (textContent) {
        assistantContent.push({ type: 'text', text: textContent });
      }
      for (const tc of toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }

      // Add assistant message to conversation history
      claudeMessages.push({ role: 'assistant', content: assistantContent });

      // Execute each tool call and collect results
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];

      // --- Atomic patching: accumulate all patches before applying ---
      // We clone the template once and apply all tool calls' patches to it.
      // Only after ALL patches succeed and validate do we apply to the store.
      // From the running total, so a turn builds on the last one's patches rather than on the
      // template as it was when the conversation started. See `workingSchema`.
      let accumulatedSchema: SchemaNode = ensureNodeIds(deepClone(workingSchema) as SchemaNode);

      // Capture baseline validation issues so we only reject patches that introduce NEW problems
      const baselineSemantic = validateSemantic(accumulatedSchema as TemplateSchema, getValidationCtx());
      const baselineIssueKeys = new Set(baselineSemantic.errors.map((e) => `${e.severity}|${e.path}|${e.message}`));
      let allPatchesValid = true;

      for (const tc of toolCalls) {
        if (tc.name === 'update_schema') {
          const patches = (tc.input as { patches: SchemaPatch[] }).patches;

          if (!patches || !Array.isArray(patches)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: 'Invalid input: patches must be an array',
              is_error: true,
            });
            allPatchesValid = false;
            continue;
          }

          devLog(`[EditorStore] Tool call ${tc.id} — ${patches.length} patch(es):`);
          for (const p of patches) {
            const op = p.node ? 'update' : p.insert ? 'insert' : 'remove';
            devLog(`  targetId: "${p.targetId}", op: ${op}`);
          }
          devLog('[EditorStore] Patch detail:', JSON.stringify(patches, null, 2));

          // Apply ID-based patches to the accumulated schema (not to the store yet) — the
          // mechanics live in shared/ai/schemaPatches.
          const result = applySchemaPatches(accumulatedSchema, patches);
          if (result.error) {
            console.warn(`[EditorStore] Patch apply failed: ${result.error}`);
            allTextContent += '\n\n<span class="warning">⚠ Template failed validation. Retrying...</span>';
            setStreamingContent(allTextContent);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `Patching failed: ${result.error}`,
              is_error: true,
            });
            allPatchesValid = false;
            continue;
          }
          accumulatedSchema = result.schema;

          // Assign IDs to any newly inserted nodes
          ensureNodeIds(accumulatedSchema);

          // Mark success for this tool call (actual store apply deferred)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: 'Patches applied.',
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `Unknown tool: ${tc.name}`,
            is_error: true,
          });
        }
      }

      // --- Atomic apply: validate + apply only if ALL tool calls succeeded ---
      if (allPatchesValid) {
        const mergedTemplate = accumulatedSchema as TemplateSchema;
        devLog('[EditorStore] merged template:', JSON.stringify(mergedTemplate, null, 2));

        // Step 1: Structural validation (Zod schema check)
        const structural = validateStructure(mergedTemplate);
        if (!structural.valid) {
          console.warn(`[EditorStore] Structural validation failed (${structural.errors.length} issues):`);
          for (const issue of structural.errors) {
            console.warn(`  [${issue.severity}] ${issue.path}: ${issue.message}`);
          }
          const top5 = structural.errors
            .slice(0, 5)
            .map((e) => `[${e.severity}] ${e.message}`)
            .join('; ');
          allTextContent += '\n\n<span class="warning">⚠ Template failed structural validation. Retrying...</span>';
          setStreamingContent(allTextContent);
          for (const tr of toolResults) {
            tr.content = `Structural validation failed (${structural.errors.length} issues). Top issues: ${top5}. Fix the schema structure and retry.`;
            tr.is_error = true;
          }
        } else {
          devLog('[EditorStore] Structural validation passed');

          // Step 2: Semantic validation (component/prop/store checks)
          // Only fail on NEW issues introduced by the patch, not pre-existing ones
          const semantic = validateSemantic(mergedTemplate, getValidationCtx());
          const newIssues = semantic.errors.filter(
            (e) => !baselineIssueKeys.has(`${e.severity}|${e.path}|${e.message}`),
          );
          const isClean = newIssues.length === 0;

          if (semantic.errors.length > 0 && newIssues.length === 0) {
            if (import.meta.env.DEV)
              devLog(`[EditorStore] Semantic validation: ${semantic.errors.length} pre-existing issue(s) ignored`);
          }

          if (!isClean) {
            console.warn(`[EditorStore] Semantic validation failed (${newIssues.length} new issues):`);
            for (const issue of newIssues) {
              console.warn(`  [${issue.severity}] ${issue.path}: ${issue.message}`);
            }
            const top5 = newIssues
              .slice(0, 5)
              .map((e) => `[${e.severity}] ${e.message}`)
              .join('; ');
            allTextContent += '\n\n<span class="warning">⚠ Template failed semantic validation. Retrying...</span>';
            setStreamingContent(allTextContent);
            for (const tr of toolResults) {
              tr.content = `Semantic validation failed (${newIssues.length} issues). Top issues: ${top5}. Fix the invalid tokens/props and retry.`;
              tr.is_error = true;
            }
          } else if (isReadOnly()) {
            if (import.meta.env.DEV)
              devLog('[EditorStore] Semantic validation passed — buffering (read-only template)');
            pushSnapshot();
            workingSchema = mergedTemplate as SchemaNode;
            setPendingTemplate(stripNodeIds(mergedTemplate) as TemplateSchema);
            for (const tr of toolResults) {
              tr.content = 'Schema changes validated and buffered. Template is read-only — user must fork to apply.';
            }
          } else {
            devLog('[EditorStore] Semantic validation passed — applying to store');
            pushSnapshot();
            workingSchema = mergedTemplate as SchemaNode;
            templateStore.updateTemplate({
              ...stripNodeIds(mergedTemplate),
              id: templateStore.currentTemplate.id,
            } as TemplateSchema);
            await templateStore.persistCurrentTemplate();
            setPendingTemplate(null);
            for (const tr of toolResults) {
              tr.content = 'Template updated successfully.';
            }
          }
        }
      }

      // Add tool results to conversation history
      claudeMessages.push({ role: 'user', content: toolResults });

      // Inject inline status if this round succeeded
      const hasErrors = toolResults.some((r) => r.is_error);
      if (!hasErrors) {
        const pended = isReadOnly() && pendingTemplate() !== null;
        const statusLine = pended
          ? '<span class="warning">⚠ Changes are ready — fork this template to apply them.</span>'
          : '<span class="success">✓ Template updated</span>';
        allTextContent += '\n\n' + statusLine;
        setStreamingContent(allTextContent);
      }

      // Continue the loop — Claude will either:
      // - send closing text (end_turn) → caught at top of next iteration
      // - send more tool_use calls → processed in next iteration
      // - retry after errors → processed in next iteration
      showInlineStatus(hasErrors ? 'Retrying...' : 'Thinking...');
    }

    // Exhausted continuations
    setStreamingContent('');
    updateAssistantMessage(
      streamMsg.id,
      allTextContent + '\n\n<span class="danger">✗ Could not apply changes after multiple attempts.</span>',
    );
  }

  /**
   * Build Claude messages array from chat history.
   * The currentSchema is included in the latest user message so the AI
   * always sees the current template state.
   */
  function buildClaudeMessages(latestText: string): Array<{ role: string; content: unknown }> {
    const history: Array<{ role: string; content: unknown }> = [];

    // Include prior conversation (skip system messages)
    for (const msg of messages()) {
      if (msg.role === 'system') continue;
      if (msg.role === 'user') {
        history.push({
          role: 'user',
          content: JSON.stringify({ request: msg.content, currentSchema: {} }),
        });
      } else {
        history.push({ role: 'assistant', content: msg.content });
      }
    }

    /*
      The schema the assistant is shown: buffered changes if there are any, else the store's.

      `currentTemplate` alone is wrong on a read-only template, where a validated patch goes to
      `pendingTemplate` and the store is deliberately untouched — so the model was shown the
      original, patched it again, and its second answer conflicted with a first it could not see.
      Same reason `workingSchema` in `sendMessage` carries across turns rather than re-reading.
    */
    const schemaWithIds = ensureNodeIds(deepClone(pendingTemplate() ?? templateStore.currentTemplate) as SchemaNode);
    const manifest = datasetStore.currentDatasetEntities();
    const payload: Record<string, unknown> = {
      request: latestText,
      currentSchema: schemaWithIds,
    };
    if (manifest.length > 0) {
      const weEntityNames = new Set(baseValidationCtx.entityNames);
      const weInPerspective = manifest.filter((m) => weEntityNames.has(m.name)).map((m) => m.name);
      const externalInPerspective = manifest.filter((m) => !weEntityNames.has(m.name));
      // WE models: send only names — AI already has their full structure in schemaContext
      if (weInPerspective.length > 0) payload.availableWeEntities = weInPerspective;
      // External models: send full property descriptions — AI has no other knowledge of them
      if (externalInPerspective.length > 0)
        payload.externalEntities = formatExternalManifestForPrompt(externalInPerspective);
    }
    history.push({
      role: 'user',
      content: JSON.stringify(payload),
    });

    return history;
  }

  /** Update or create the assistant message, then persist to AD4M */
  function updateAssistantMessage(streamMsgId: string | undefined, content: string) {
    if (streamMsgId) {
      setMessages((prev) => prev.map((m) => (m.id === streamMsgId ? { ...m, content, status: undefined } : m)));
    } else {
      setMessages((prev) => [...prev, createMessage('assistant', content)]);
    }

    // Persist to AD4M (fire-and-forget for custom templates)
    if (activeSessionRecord) {
      persistMessage('assistant', content);
    }
  }

  // ----------------------------------------------------------------
  // Schema JSON editing (Code mode)
  // ----------------------------------------------------------------
  function onSchemaEdit(json: string) {
    try {
      const parsed = JSON.parse(json);
      pushSnapshot();
      // stripNodeIds deletes the root node's id, but at the TemplateSchema level that
      // id is the template identifier, not an internal node id — restore it.
      const schema = { ...stripNodeIds(parsed as SchemaNode), id: templateStore.currentTemplate.id } as TemplateSchema;
      templateStore.updateTemplate(schema);
      templateStore.persistCurrentTemplate();
      setMessages((prev) => [...prev, createMessage('assistant', 'Schema updated from JSON editor.')]);
    } catch {
      setMessages((prev) => [...prev, createMessage('assistant', 'Invalid JSON — changes not applied.')]);
    }
  }

  // ----------------------------------------------------------------
  // Clear chat
  // ----------------------------------------------------------------
  async function clearHistory() {
    // If persisted session, delete messages from AD4M
    if (activeSessionRecord) {
      try {
        // Messages are already hydrated on the session model
        for (const msg of activeSessionRecord.messages || []) {
          await activeSessionRecord.removeMessages(msg as ChatMessageRecord);
          await (msg as ChatMessageRecord).delete();
        }
        activeSessionRecord.messages = [];
      } catch (err) {
        console.error('Failed to clear persisted messages', err);
      }
    }
    setMessages([]);
    setPendingTemplate(null);
  }

  // ----------------------------------------------------------------
  // Load sessions when template changes
  // ----------------------------------------------------------------
  createEffect(() => {
    const templateId = templateStore.currentTemplate.id;
    if (templateId && datasetStore.rootDataset()) {
      loadSessionsForTemplate(templateId);
      setContentModeSignal('preview');
      setIsEditingTemplate(false);
      setEditAction(null);
    }
  });

  // Save/restore undo/redo stacks per template.
  // Only template entries are persisted — theme entries become stale after a switch.
  createEffect(() => {
    const newId = templateStore.currentTemplate.id;
    untrack(() => {
      if (prevTemplateId) {
        const undo = undoStack().filter((e) => e.type === 'template');
        const redo = redoStack().filter((e) => e.type === 'template');
        if (undo.length || redo.length) {
          stackCache.set(prevTemplateId, { undo, redo });
        } else {
          stackCache.delete(prevTemplateId);
        }
      }
      const cached = newId ? stackCache.get(newId) : undefined;
      setUndoStack(cached?.undo ?? []);
      setRedoStack(cached?.redo ?? []);
      prevTemplateId = newId;
    });
  });

  // ----------------------------------------------------------------
  // Store object
  // ----------------------------------------------------------------
  const store: EditorStore = {
    // Chat state
    messages,
    isOpen,
    isStreaming,
    streamingContent,
    apiKeyConfigured,

    // Template context
    templateName,
    templateIcon,
    isReadOnly,
    hasPendingChanges,

    // Picker state
    pickerOpen,
    pickerAction,
    pickerDefaultName,
    pickerDefaultIcon,
    pickerShowDestination,

    // Session management
    sessions,
    activeSessionId,
    newChat,
    switchSession,
    deleteSession,

    // Content mode (preview / visual / code)
    contentMode,
    setContentMode,
    schemaJson,
    onSchemaEdit,

    // Undo / Redo
    canUndo,
    canRedo,
    undo,
    redo,
    pushSnapshot,

    // Template actions
    startFork,
    startFresh,
    confirmPicker,
    cancelPicker,

    // Template editing
    isEditingTemplate,
    editAction,
    enterTemplateEditing,
    exitTemplateEditing,

    // Theme editing
    isEditingTheme,
    enterThemeEditing,
    exitThemeEditing,
    toggleThemeEditing,

    // Panel control (AI chat)
    toggle,
    open,
    close,

    // Code panel
    codePanelOpen,
    toggleCodePanel,
    openCodePanel,
    closeCodePanel,

    // Theme panel
    themePanelOpen,
    toggleThemePanel,
    openThemePanel,
    closeThemePanel,

    // Visual properties panel
    visualPanelOpen,
    toggleVisualPanel,

    // Panel widths
    aiDockEdge,
    codeDockEdge,
    themeDockEdge,
    visualDockEdge,
    // An opening bid, shared by all four: a panel at the right edge, taking room. Everything after
    // the first open is the user's and the shell's.
    editorDockSize: () => 'md',
    editorDockFloat: () => false,

    // Chat actions
    sendMessage,
    clearHistory,

    // Settings
    setApiKey,
  };

  /*
    Publish this store where the dock system can read it.

    The editor's four panels are docks, and a dock reads its `edge` / `size` / `float` keys off the
    store named by its entry — normally a module's. The editor is not a module, so the shell registers
    it here under the id those entries name. See `hostDockStores`.
  */
  registerHostDockStore(EDITOR_STORE_ID, store as unknown as Record<string, unknown>);
  onCleanup(() => unregisterHostDockStore(EDITOR_STORE_ID));

  return <EditorContext.Provider value={store}>{props.children}</EditorContext.Provider>;
}

export function useEditorStore(): EditorStore {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorStore must be used within EditorStoreProvider');
  return ctx;
}

export default EditorStoreProvider;
