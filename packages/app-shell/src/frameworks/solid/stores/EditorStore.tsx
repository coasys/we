/**
 * EditorStore — the editor's state: chat sessions and messages per template,
 * panel visibility and widths, preview/visual mode, unified template+theme undo/redo, pending
 * (buffered) changes for read-only templates, and the fork/fresh picker.
 *
 * The AI half of a session is deliberately elsewhere: the model runs on the node, reached through
 * `LanguageModelPort.converse`; prompt assembly and the tool definition live in `shared/ai/aiInfra`,
 * and patch application in `shared/ai/schemaPatches` — this store orchestrates them against its own
 * signals, and never learns which model or provider answered.
 */
import { chatContext, formatExternalManifestForPrompt, requestMessage, updateSchemaTool } from '@shared/ai/aiInfra';
import { countedPatches, runEditSession } from '@shared/ai/editSession';
import { registerHostDockStore, unregisterHostDockStore } from '@shared/registries/dockRegistry';
import { EDITOR_STORE_ID } from '@shared/registries/editorDocks';
import { deepClone } from '@shared/utils';
import {
  type EditingTheme,
  useDatasetStore,
  useSessionStore,
  useShapeStore,
  useTemplateStore,
  useThemeStore,
} from '@solid/stores';
import type { ConversationTurn, LanguageModelStatus, NewRecord } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { ChatMessage as ChatMessageRecord, ChatSession as ChatSessionRecord } from '@we/entities';
import type { DockEdge, DockSize } from '@we/module-shared';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { contextData, setLocalWarningSink } from '@we/schema-shared';
import {
  buildValidationContext,
  compactDefinitions,
  ensureNodeIds,
  expandDefinitions,
  stripNodeIds,
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
  /**
   * The node has a language model this editor can hold a conversation with. What the composer
   * gates on — and says so, rather than hiding — when it is false.
   */
  assistantAvailable: Accessor<boolean>;
  /**
   * Which model answers the chat and whether it can right now — checked when the panel opens and
   * after a failed send, without spending tokens. Null until the first check.
   */
  assistantStatus: Accessor<LanguageModelStatus | null>;
  /** Check again — after changing models in settings, or to see whether a failure has cleared. */
  refreshAssistant: () => Promise<void>;

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
  /** The saved sessions, to name and address — never to read messages off. See the signal's note. */
  sessions: Accessor<NewRecord<ChatSessionRecord>[]>;
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
  /**
   * Keep the edit just made — persisted where it can be, buffered where it cannot.
   *
   * The visual editor and the code panel called `templateStore.persistCurrentTemplate` directly,
   * which no-ops on a template with no record of its own. So editing a built-in in the visual editor
   * changed the canvas, wrote nothing, buffered nothing, and lost the lot on the next switch —
   * silently, since a no-op has nothing to report. `isReadOnly` says those edits should become
   * pending changes, which the AI path and undo/redo both already do; this is the same branch, in
   * one place, for the surfaces that were missing it.
   */
  commitEdit: () => Promise<void>;

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
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const templateStore = useTemplateStore();
  const themeStore = useThemeStore();

  const shapeStore = useShapeStore();

  /*
    The models a template edited here may query: WE's own and the modules', plus what the space on
    screen adds — the models other apps synced into it, and the ones its community defined.

    It used to *replace* the WE names with the dataset's, on the belief that the dataset's list was
    its full manifest. It is not: `currentDatasetEntities` is the foreign models only, since WE's own
    are filtered out as native. So in any space holding one synced or community-defined model, every
    `$query` on a `TaskBlock` read as an unknown model — and in a space with none, a query on the
    community's own `Sighting` did, which is the case a validator is most needed for.
  */
  const getValidationCtx = createMemo(() => {
    const foreign = datasetStore.currentDatasetEntities().map((m) => m.name);
    const shapes = shapeStore.spaceShapes().map((s) => s.name);
    if (foreign.length === 0 && shapes.length === 0) return baseValidationCtx;
    return { ...baseValidationCtx, entityNames: new Set([...baseValidationCtx.entityNames, ...foreign, ...shapes]) };
  });

  // --- Chat state ---
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal('');

  /*
    Asked of the node rather than read off the agent. This used to be "the agent pasted an Anthropic
    key", which made the editor the one AI surface that ignored the models its node runs — and
    handed a secret to the browser to send from there.
  */
  const languageModel = () => session.backendPorts()?.languageModel;
  const [nodeHasModel, setNodeHasModel] = createSignal(false);
  const [assistantStatus, setAssistantStatus] = createSignal<LanguageModelStatus | null>(null);
  const assistantAvailable = () => nodeHasModel() && !!languageModel()?.converse;

  /*
    Asked again rather than once at boot: models are added and swapped in settings while the app
    runs, and a chat panel that only learned about the node on startup went on saying "no model"
    after one was added.
  */
  async function refreshAssistant(): Promise<void> {
    const port = languageModel();
    if (!port?.converse) {
      setNodeHasModel(false);
      setAssistantStatus(null);
      return;
    }
    const [available, status] = await Promise.all([
      port.available().catch(() => false),
      port.status?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    setNodeHasModel(available);
    setAssistantStatus(status);
  }

  createEffect(() => {
    // When the port arrives — so the answer is ready before anyone opens the chat — and each time
    // the panel opens, since that is when a stale answer would be read.
    languageModel();
    if (isOpen() || !assistantStatus()) void refreshAssistant();
  });

  /*
    --- Session management ---

    `NewRecord`, and that is the whole of the fix below: these rows are here to be named, addressed
    and deleted, never to be read for their messages. A session's `messages` is a relation, so it
    holds whatever it held at the moment the record was read — nothing for one this run created, and
    the state at load for one it loaded — and `persistMessage` appends without touching it.

    Reading it back off a held row was why leaving a conversation and returning to it showed an empty
    one, and why deleting a chat walked an empty list and left every message behind with nothing
    pointing at it. Both cleared on reload, which is what kept them. Messages now come from
    `messagesFor`, which asks.
  */
  const [sessions, setSessions] = createSignal<NewRecord<ChatSessionRecord>[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  // Track the AD4M ChatSession model instance for the active session
  let activeSessionRecord: NewRecord<ChatSessionRecord> | null = null;

  // --- Content mode (preview / visual / code) ---
  const [contentMode, setContentModeSignal] = createSignal<'preview' | 'visual'>('preview');
  const schemaJson = () =>
    JSON.stringify(stripNodeIds(deepClone(templateStore.currentTemplate) as SchemaNode), null, 2);

  // --- Template context (computed) ---
  const templateName = () => templateStore.currentTemplate.meta?.name || templateStore.currentTemplate.id || 'Template';
  const templateIcon = () => templateStore.currentTemplate.meta?.icon || 'cube';
  const isReadOnly = () => {
    const id = templateStore.currentTemplate.id;
    return !!id && templateStore.isBuiltInTemplateId(id);
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

  /**
   * See `commitEdit` on the interface.
   *
   * Deliberately *not* the AI path's shape. That one buffers **instead of** updating, so a proposed
   * patch does not silently alter what is on screen — but the visual editor's caller has already
   * applied the edit to the working copy, because direct manipulation that does not move the thing
   * being manipulated is not an edit at all. So the working copy is what gets buffered.
   */
  async function commitEdit() {
    if (!isReadOnly()) {
      await templateStore.persistCurrentTemplate();
      return;
    }
    setPendingTemplate(deepClone(templateStore.currentTemplate) as TemplateSchema);
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

  /**
   * One session's messages, asked for rather than read off a held record.
   *
   * The session row is re-read with its `messages` included — the same query `loadSessionsForTemplate`
   * makes for all of them — because a relation on a held instance is a snapshot of when that instance
   * was read, and every message written since is missing from it. See the note on `sessions`.
   *
   * Answers `[]` for a session that has gone, which is what a caller wants: an empty conversation,
   * not a thrown one.
   */
  async function messagesFor(sessionId: string): Promise<ChatMessage[]> {
    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return [];
    try {
      const fresh = await ChatSessionRecord.findOne(perspective, {
        where: { id: sessionId },
        include: { messages: { order: { createdAt: 'ASC' } } },
      });
      // One fallback, not two: the inner `?? []` already makes this non-nullish, so the outer one was
      // unreachable. TypeScript 6 reports that (TS2869) where 5 accepted it in silence.
      return (fresh?.messages ?? []) as ChatMessage[];
    } catch (err) {
      console.error('Failed to read messages for session', sessionId, err);
      return [];
    }
  }

  /** Load sessions for a given template and activate the most recent one */
  async function loadSessionsForTemplate(templateId: string) {
    // Core (read-only) templates use ephemeral in-memory sessions
    if (templateStore.isBuiltInTemplateId(templateId)) {
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
    if (!templateId || templateStore.isBuiltInTemplateId(templateId)) {
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
    setMessages(await messagesFor(sessionId));
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

      // Asked for, not read off `target`: its `messages` is a snapshot from whenever that row was
      // read, so a chat created or added to this run walked an empty list here and left every
      // message behind in the root dataset with nothing left pointing at it.
      for (const msg of await messagesFor(sessionId)) {
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
          setMessages(await messagesFor(next.id));
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
        // The predicate by name, not `model`. These classes come from `@we/entities`, which are
        // neutral proxies; the `@HasMany` metadata the backend resolves a parent predicate from
        // lives on the generated backend classes, so a proxy handed over as `model` resolves to
        // nothing and every message fails to save.
        { parent: { id: activeSessionRecord.id, predicate: 'we://chat_message' } },
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
  // Chat — send message
  // ----------------------------------------------------------------
  async function sendMessage(text: string) {
    // Lazy session creation for custom templates: if no active session, create one
    const templateId = templateStore.currentTemplate.id;
    if (templateId && !templateStore.isBuiltInTemplateId(templateId) && !activeSessionRecord) {
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
      await sendViaNode(text);
    } catch (err) {
      console.error('[EditorStore] sendMessage caught error:', err);
      // A failure is often the model's — a revoked key, a removed default — so the status line
      // should stop claiming it is fine.
      void refreshAssistant();
      const errorText = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, createMessage('assistant', `Error: ${errorText}`)]);
    } finally {
      // Mark user message as sent
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, status: 'sent' as const } : m)));
      /*
        Resolve any placeholder still marked `streaming`.

        `sendViaNode` creates one before the first token and clears it only on the paths that
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
  // The conversation, on the node's language model
  // ----------------------------------------------------------------

  async function sendViaNode(text: string) {
    const port = languageModel();
    if (!port?.converse || !nodeHasModel()) {
      throw new Error('This node has no language model to talk to. Add one in Settings → AI.');
    }
    const converse = port.converse.bind(port);

    // Create a placeholder assistant message — shows streaming content as tokens arrive
    const streamMsg = createMessage('assistant', '', 'streaming');
    setMessages((prev) => [...prev, streamMsg]);

    // What the model is told about WE, chosen for this request: a core plus the components and
    // stores it implicates, with the rest behind a tool. See `chatContext`.
    /*
      ONE tree, numbered once, for everything this turn: what the model is shown, what its ids
      are resolved against, and what the context strategy preselects from.

      Built here rather than inside `buildTurns` because the ids only mean anything if the SAME
      tree is on both sides. Compacting in one place and patching the uncompacted template in
      another gave two independent numberings that drift apart at the first hoisted shape — and
      the failure was quiet: a patch the model wrote against a shared definition resolved, on this
      side, to one inline copy of it. It validated, it saved, it changed something plausible, and
      the model's explanation of what it had done was confidently wrong.
    */
    const schemaForRequest = ensureNodeIds(
      compactDefinitions(deepClone(pendingTemplate() ?? templateStore.currentTemplate) as SchemaNode).schema,
    );
    const prepared = await chatContext({ request: text, schema: schemaForRequest });

    const result = await runEditSession({
      converse,
      system: prepared.system,
      turns: buildTurns(text, schemaForRequest),
      tools: [updateSchemaTool, ...prepared.tools],
      resolveTool: prepared.resolveTool,
      // Buffered changes if there are any, so a conversation resumed against a read-only template
      // continues from them rather than reverting them.
      schema: schemaForRequest,
      validationContext: getValidationCtx(),
      onDisplay: setStreamingContent,
      debug: devLog,
      accept: async (merged) => {
        pushSnapshot();
        /*
          Expanded before it is stored: compaction is a fact about the wire, not about the
          template. A stored `$defs` would be a second shape for everything downstream to
          understand — the code panel, a published template, the next turn's compaction — in
          exchange for nothing, since the saving is in what is sent.
        */
        const authored = stripNodeIds(expandDefinitions(merged)) as TemplateSchema;
        if (isReadOnly()) {
          setPendingTemplate(authored);
          return 'Schema changes validated and buffered. Template is read-only — user must fork to apply.';
        }
        templateStore.updateTemplate({
          ...authored,
          id: templateStore.currentTemplate.id,
        } as TemplateSchema);
        await templateStore.persistCurrentTemplate();
        setPendingTemplate(null);
        return 'Template updated successfully.';
      },
      acceptedLine: (patches) =>
        isReadOnly() && pendingTemplate() !== null
          ? `<span class="warning">⚠ ${countedPatches(patches)} ready — fork this template to apply them.</span>`
          : `<span class="success">✓ Template updated (${countedPatches(patches)})</span>`,
    });

    /*
      What the session actually did, once, at the end.

      A tick in the panel is drawn per accepted turn, so a count of them is a claim about how many
      turns were accepted — and when those two disagreed there was no way to tell a display fault
      from an extra write without reading every patch line and counting. `accepted` is the number
      of times the template was written; this makes that answerable at a glance.
    */
    devLog('[editSession] session', result.outcome, result.stats);

    setStreamingContent('');
    if (result.outcome === 'truncated') {
      updateAssistantMessage(
        streamMsg.id,
        `${result.transcript}\n\n---\n\n**This reply was cut off before it finished, so no changes were applied.** Ask again, or in smaller steps.`.trim(),
      );
    } else if (result.outcome === 'exhausted') {
      updateAssistantMessage(
        streamMsg.id,
        result.transcript + '\n\n<span class="danger">✗ Could not apply changes after multiple attempts.</span>',
      );
    } else {
      updateAssistantMessage(streamMsg.id, result.transcript || 'No response from AI');
    }
  }

  /**
   * The conversation so far, as turns.
   * The currentSchema is included in the latest user message so the AI
   * always sees the current template state.
   */
  function buildTurns(latestText: string, schemaWithIds: SchemaNode): ConversationTurn[] {
    const history: ConversationTurn[] = [];

    // Include prior conversation (skip system messages)
    for (const msg of messages()) {
      if (msg.role === 'system') continue;
      // The request being sent is already in the list, marked `sending`, and goes last below with
      // the schema attached. Reading it here too sent every request to the model twice.
      if (msg.status === 'sending') continue;
      if (msg.role === 'user') {
        history.push({
          role: 'user',
          text: requestMessage(msg.content, {}),
        });
      } else {
        history.push({ role: 'assistant', text: msg.content });
      }
    }

    /*
      `schemaWithIds` is the caller's — compacted and numbered once in `sendMessage`, and the same
      object the session resolves the model's ids against. It carries buffered changes where there
      are any, which matters on a read-only template: patched into `pendingTemplate` while the
      store is deliberately untouched, so showing `currentTemplate` would show the model a tree
      without its own last answer in it.

      Compaction is why it is worth the care. A template repeats itself because a fragment stamps
      its whole tree at every call site, and the editor is where that is most expensive — the
      schema crosses the wire every turn and comes back. It takes CardsView down 50% and the
      workshop template 32%, the difference between a request that fits a context window and one
      that does not. It also gives the model two scopes rather than one: a patch inside a
      definition changes every use of that shape, a patch on a `$ref` changes that one use, and
      the tool result says which happened.
    */
    const manifest = datasetStore.currentDatasetEntities();
    const extras: Record<string, unknown> = {};
    if (manifest.length > 0) {
      const weEntityNames = new Set(baseValidationCtx.entityNames);
      const weInPerspective = manifest.filter((m) => weEntityNames.has(m.name)).map((m) => m.name);
      const externalInPerspective = manifest.filter((m) => !weEntityNames.has(m.name));
      // WE models: send only names — AI already has their full structure in schemaContext
      if (weInPerspective.length > 0) extras.availableWeEntities = weInPerspective;
      // External models: send full property descriptions — AI has no other knowledge of them
      if (externalInPerspective.length > 0)
        extras.externalEntities = formatExternalManifestForPrompt(externalInPerspective);
    }
    history.push({
      role: 'user',
      text: requestMessage(latestText, schemaWithIds, extras),
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
      void commitEdit();
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
    const record = activeSessionRecord;
    if (record) {
      try {
        // Asked for, not read off the held record — its `messages` is a snapshot of whenever that
        // row was read, and every message written since is missing from it. The comment here used to
        // say they were "already hydrated on the session model", which is what made Clear History a
        // no-op on any conversation this run had started.
        for (const msg of await messagesFor(record.id)) {
          await record.removeMessages(msg as ChatMessageRecord);
          await (msg as ChatMessageRecord).delete();
        }
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
    assistantAvailable,
    assistantStatus,
    refreshAssistant,

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
    commitEdit,

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
