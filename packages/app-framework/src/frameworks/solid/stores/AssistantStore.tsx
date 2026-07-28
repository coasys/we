/**
 * AssistantStore — state + actions for the AD4M AI-assistant surface.
 *
 * This store is the front end for AI assistants whose replies are produced by the
 * AD4M backend, NOT by any in-browser model call. The flow is:
 *
 *   1. The user writes a `Message` (role 'user') into the active thread's perspective.
 *   2. The AD4M backend observes the perspective, runs the assistant, and writes back
 *      an assistant `Message` — creating it with `status: 'streaming'` and appending to
 *      its `content` (and `toolCalls`) as tokens arrive, then flipping `status` to
 *      'complete'. Tool results may arrive as additional `role: 'tool'` messages.
 *   3. This store subscribes to the thread's messages via the subject-class ORM
 *      (`Model.query(p).subscribe(cb)`), so the UI re-renders on every write — the token
 *      stream is simply the assistant message's `content` growing under an open
 *      subscription. Nothing here calls an LLM.
 *
 * Data lives in two perspectives:
 *   - Personal config (we-root): Assistant, Personality, Skill, McpServer.
 *   - Neighbourhood (current space, falling back to we-root): Thread, Message.
 */
import { Assistant, McpServer, Message, Personality, Skill, Thread } from '@we/models';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  ParentProps,
  useContext,
} from 'solid-js';

import { useAdamStore } from './AdamStore';

/** Minimal structural view of an AD4M `ModelQueryBuilder` — the three methods this store uses. */
interface LiveQueryBuilder<T> {
  subscribe(cb: (rows: T[]) => void): Promise<T[]>;
  get(): Promise<T[]>;
  dispose(): void;
}

/** A parsed tool call, as rendered by the thread view. Serialised into `Message.toolCalls` (JSON). */
export interface ToolCall {
  id?: string;
  name: string;
  /** Tool input arguments (any JSON value). */
  input?: unknown;
  /** Tool result once the backend has run it (any JSON value). */
  result?: unknown;
  /** 'pending' while running, 'complete' when a result is in, 'error' on failure. */
  status?: 'pending' | 'complete' | 'error';
}

export interface AssistantStore {
  // --- Threads (current neighbourhood) ---
  threads: Accessor<Thread[]>;
  activeThreadId: Accessor<string | null>;
  activeThread: Accessor<Thread | null>;
  selectThread: (id: string) => void;
  createThread: (title?: string, assistantId?: string) => Promise<string | null>;
  deleteThread: (id: string) => Promise<void>;
  renameThread: (id: string, title: string) => Promise<void>;
  setThreadModel: (id: string, modelId: string) => Promise<void>;

  // --- Messages (active thread) ---
  messages: Accessor<Message[]>;
  streamingMessageId: Accessor<string | null>;
  sendMessage: (text: string) => Promise<void>;

  // --- Assistants (personal config) ---
  assistants: Accessor<Assistant[]>;
  activeAssistant: Accessor<Assistant | null>;
  createAssistant: (data: { name: string; modelId?: string; systemPrompt?: string }) => Promise<string | null>;
  updateAssistant: (
    id: string,
    updates: Partial<{ name: string; modelId: string; systemPrompt: string }>,
  ) => Promise<void>;
  deleteAssistant: (id: string) => Promise<void>;
  /** Toggle a Personality / Skill / McpServer grant on an assistant (rewrites the JSON id list). */
  toggleGrant: (assistantId: string, field: 'personalityIds' | 'skillIds' | 'mcpServerIds', itemId: string) => Promise<void>;
  assistantHasGrant: (assistant: Assistant, field: 'personalityIds' | 'skillIds' | 'mcpServerIds', itemId: string) => boolean;

  // --- Personalities ---
  personalities: Accessor<Personality[]>;
  createPersonality: (data: { name: string; body: string }) => Promise<void>;
  updatePersonality: (id: string, updates: Partial<{ name: string; body: string }>) => Promise<void>;
  deletePersonality: (id: string) => Promise<void>;

  // --- Skills ---
  skills: Accessor<Skill[]>;
  createSkill: (data: { name: string; description: string; body: string }) => Promise<void>;
  updateSkill: (id: string, updates: Partial<{ name: string; description: string; body: string }>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;

  // --- MCP servers ---
  mcpServers: Accessor<McpServer[]>;
  createMcpServer: (data: {
    name: string;
    transport: string;
    url?: string;
    command?: string;
    auth?: string;
  }) => Promise<void>;
  updateMcpServer: (
    id: string,
    updates: Partial<{ name: string; transport: string; url: string; command: string; auth: string }>,
  ) => Promise<void>;
  deleteMcpServer: (id: string) => Promise<void>;

  // --- Models ---
  models: Accessor<string[]>;
  refreshModels: () => Promise<void>;
}

/** Parse a JSON-encoded id list (used for Assistant grant fields). Tolerant of '' and bad JSON. */
export function parseIdList(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Parse a Message's toolCalls JSON into a ToolCall[] for rendering. Never throws. */
export function parseToolCalls(json: string | undefined): ToolCall[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as ToolCall[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Exported so tests and standalone harnesses can render assistant components with a mock
 * store injected directly (`<AssistantContext.Provider value={mock}>`), without the full
 * AD4M provider chain.
 */
export const AssistantContext = createContext<AssistantStore>();

export function AssistantStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  // Threads + messages live in the active neighbourhood, falling back to the personal
  // root perspective so assistants work before any space is opened.
  const threadPerspective = () => adamStore.currentPerspective() ?? adamStore.rootPerspective();
  // Assistant configuration is personal — always the root perspective.
  const configPerspective = () => adamStore.rootPerspective();

  const [threads, setThreads] = createSignal<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [assistants, setAssistants] = createSignal<Assistant[]>([]);
  const [personalities, setPersonalities] = createSignal<Personality[]>([]);
  const [skills, setSkills] = createSignal<Skill[]>([]);
  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);
  const [models, setModels] = createSignal<string[]>([]);

  /**
   * Open a live subscription. Returns a disposer. Falls back to a single `.get()` if the
   * executor rejects the live subscription (e.g. live queries unavailable), so the UI still
   * populates once even without push updates.
   */
  function liveQuery<T>(make: () => LiveQueryBuilder<T>, onRows: (rows: T[]) => void): () => void {
    let disposed = false;
    const builder = make();
    builder
      .subscribe((rows) => {
        if (!disposed) onRows(rows);
      })
      .catch((err) => {
        console.warn('[AssistantStore] live subscribe failed; falling back to one-shot query', err);
        if (disposed) return;
        make()
          .get()
          .then((rows) => {
            if (!disposed) onRows(rows);
          })
          .catch((e) => console.warn('[AssistantStore] fallback query failed', e));
      });
    return () => {
      disposed = true;
      try {
        builder.dispose();
      } catch {
        /* dispose is best-effort */
      }
    };
  }

  // Threads for the active neighbourhood, newest activity first.
  createEffect(() => {
    const p = threadPerspective();
    if (!p) {
      setThreads([]);
      return;
    }
    const dispose = liveQuery<Thread>(
      () => Thread.query(p).order({ updatedAt: 'DESC' }) as unknown as LiveQueryBuilder<Thread>,
      setThreads,
    );
    onCleanup(dispose);
  });

  // Messages for the active thread, chronological.
  createEffect(() => {
    const p = threadPerspective();
    const tid = activeThreadId();
    if (!p || !tid) {
      setMessages([]);
      return;
    }
    const dispose = liveQuery<Message>(
      () => Message.query(p).where({ threadId: tid }).order({ ts: 'ASC' }) as unknown as LiveQueryBuilder<Message>,
      setMessages,
    );
    onCleanup(dispose);
  });

  // Personal config: assistants, personalities, skills, MCP servers.
  createEffect(() => {
    const p = configPerspective();
    if (!p) {
      setAssistants([]);
      setPersonalities([]);
      setSkills([]);
      setMcpServers([]);
      return;
    }
    const disposers = [
      liveQuery<Assistant>(
        () => Assistant.query(p).order({ name: 'ASC' }) as unknown as LiveQueryBuilder<Assistant>,
        setAssistants,
      ),
      liveQuery<Personality>(
        () => Personality.query(p).order({ name: 'ASC' }) as unknown as LiveQueryBuilder<Personality>,
        setPersonalities,
      ),
      liveQuery<Skill>(() => Skill.query(p).order({ name: 'ASC' }) as unknown as LiveQueryBuilder<Skill>, setSkills),
      liveQuery<McpServer>(
        () => McpServer.query(p).order({ name: 'ASC' }) as unknown as LiveQueryBuilder<McpServer>,
        setMcpServers,
      ),
    ];
    onCleanup(() => disposers.forEach((d) => d()));
  });

  // Keep an active thread selected: adopt the newest when none is chosen, and recover if the
  // active thread is deleted out from under us.
  createEffect(() => {
    const list = threads();
    const active = activeThreadId();
    if (!active && list.length > 0) {
      setActiveThreadId(list[0].id);
    } else if (active && !list.some((t) => t.id === active)) {
      setActiveThreadId(list[0]?.id ?? null);
    }
  });

  const activeThread = createMemo(() => threads().find((t) => t.id === activeThreadId()) ?? null);

  const activeAssistant = createMemo(() => {
    const thread = activeThread();
    const list = assistants();
    if (thread?.assistantId) {
      const match = list.find((a) => a.id === thread.assistantId);
      if (match) return match;
    }
    return list[0] ?? null;
  });

  const streamingMessageId = createMemo(() => messages().find((m) => m.status === 'streaming')?.id ?? null);

  // ---------------------------------------------------------------- Thread actions

  function selectThread(id: string) {
    setActiveThreadId(id);
  }

  async function createThread(title?: string, assistantId?: string): Promise<string | null> {
    const p = threadPerspective();
    if (!p) return null;
    const now = new Date().toISOString();
    const aId = assistantId ?? activeAssistant()?.id ?? assistants()[0]?.id ?? '';
    try {
      const thread = await Thread.create(p, {
        title: title?.trim() || 'New chat',
        assistantId: aId,
        modelId: '',
        createdAt: now,
        updatedAt: now,
      });
      setActiveThreadId(thread.id);
      return thread.id;
    } catch (err) {
      console.error('[AssistantStore] createThread failed', err);
      return null;
    }
  }

  async function deleteThread(id: string): Promise<void> {
    const p = threadPerspective();
    if (!p) return;
    try {
      const msgs = await Message.findAll(p, { where: { threadId: id } });
      for (const m of msgs) await m.delete().catch((e) => console.warn('[AssistantStore] delete message failed', e));
      const thread = threads().find((t) => t.id === id);
      if (thread) await thread.delete();
      if (activeThreadId() === id) setActiveThreadId(null);
    } catch (err) {
      console.error('[AssistantStore] deleteThread failed', err);
    }
  }

  async function renameThread(id: string, title: string): Promise<void> {
    const thread = threads().find((t) => t.id === id);
    if (!thread) return;
    try {
      thread.title = title.trim() || thread.title;
      thread.updatedAt = new Date().toISOString();
      await thread.save();
    } catch (err) {
      console.error('[AssistantStore] renameThread failed', err);
    }
  }

  async function setThreadModel(id: string, modelId: string): Promise<void> {
    const thread = threads().find((t) => t.id === id);
    if (!thread) return;
    try {
      thread.modelId = modelId;
      await thread.save();
    } catch (err) {
      console.error('[AssistantStore] setThreadModel failed', err);
    }
  }

  // ---------------------------------------------------------------- Messaging

  /**
   * Write a user message into the active thread's perspective. This is the ONLY write the UI
   * makes on send — the assistant's reply comes from the AD4M backend, which observes the
   * perspective and writes the response back (picked up by the messages subscription).
   */
  async function sendMessage(text: string): Promise<void> {
    const p = threadPerspective();
    const tid = activeThreadId();
    const content = text.trim();
    if (!p || !tid || !content) return;
    const now = new Date().toISOString();
    try {
      await Message.create(
        p,
        { threadId: tid, role: 'user', content, ts: now, status: 'complete', toolCalls: '' },
        { parent: { model: Thread, id: tid } },
      );
      // Bump the thread's updatedAt so it sorts to the top and the backend has a clear "last active".
      const thread = threads().find((t) => t.id === tid);
      if (thread) {
        thread.updatedAt = now;
        await thread.save().catch((e) => console.warn('[AssistantStore] thread bump failed', e));
      }
    } catch (err) {
      console.error('[AssistantStore] sendMessage failed', err);
    }
  }

  // ---------------------------------------------------------------- Assistant CRUD

  async function createAssistant(data: {
    name: string;
    modelId?: string;
    systemPrompt?: string;
  }): Promise<string | null> {
    const p = configPerspective();
    if (!p) return null;
    try {
      const assistant = await Assistant.create(p, {
        name: data.name.trim() || 'Assistant',
        modelId: data.modelId ?? models()[0] ?? '',
        systemPrompt: data.systemPrompt ?? '',
        personalityIds: '[]',
        skillIds: '[]',
        mcpServerIds: '[]',
      });
      return assistant.id;
    } catch (err) {
      console.error('[AssistantStore] createAssistant failed', err);
      return null;
    }
  }

  async function updateAssistant(
    id: string,
    updates: Partial<{ name: string; modelId: string; systemPrompt: string }>,
  ): Promise<void> {
    const assistant = assistants().find((a) => a.id === id);
    if (!assistant) return;
    try {
      Object.assign(assistant, updates);
      await assistant.save();
    } catch (err) {
      console.error('[AssistantStore] updateAssistant failed', err);
    }
  }

  async function deleteAssistant(id: string): Promise<void> {
    const assistant = assistants().find((a) => a.id === id);
    if (!assistant) return;
    try {
      await assistant.delete();
    } catch (err) {
      console.error('[AssistantStore] deleteAssistant failed', err);
    }
  }

  function assistantHasGrant(
    assistant: Assistant,
    field: 'personalityIds' | 'skillIds' | 'mcpServerIds',
    itemId: string,
  ): boolean {
    return parseIdList(assistant[field]).includes(itemId);
  }

  async function toggleGrant(
    assistantId: string,
    field: 'personalityIds' | 'skillIds' | 'mcpServerIds',
    itemId: string,
  ): Promise<void> {
    const assistant = assistants().find((a) => a.id === assistantId);
    if (!assistant) return;
    const current = parseIdList(assistant[field]);
    const next = current.includes(itemId) ? current.filter((x) => x !== itemId) : [...current, itemId];
    try {
      assistant[field] = JSON.stringify(next);
      await assistant.save();
    } catch (err) {
      console.error('[AssistantStore] toggleGrant failed', err);
    }
  }

  // ---------------------------------------------------------------- Personality CRUD

  async function createPersonality(data: { name: string; body: string }): Promise<void> {
    const p = configPerspective();
    if (!p) return;
    try {
      await Personality.create(p, { name: data.name.trim() || 'Personality', body: data.body });
    } catch (err) {
      console.error('[AssistantStore] createPersonality failed', err);
    }
  }

  async function updatePersonality(id: string, updates: Partial<{ name: string; body: string }>): Promise<void> {
    const item = personalities().find((x) => x.id === id);
    if (!item) return;
    try {
      Object.assign(item, updates);
      await item.save();
    } catch (err) {
      console.error('[AssistantStore] updatePersonality failed', err);
    }
  }

  async function deletePersonality(id: string): Promise<void> {
    const item = personalities().find((x) => x.id === id);
    if (!item) return;
    try {
      await item.delete();
    } catch (err) {
      console.error('[AssistantStore] deletePersonality failed', err);
    }
  }

  // ---------------------------------------------------------------- Skill CRUD

  async function createSkill(data: { name: string; description: string; body: string }): Promise<void> {
    const p = configPerspective();
    if (!p) return;
    try {
      await Skill.create(p, {
        name: data.name.trim() || 'Skill',
        description: data.description,
        body: data.body,
      });
    } catch (err) {
      console.error('[AssistantStore] createSkill failed', err);
    }
  }

  async function updateSkill(
    id: string,
    updates: Partial<{ name: string; description: string; body: string }>,
  ): Promise<void> {
    const item = skills().find((x) => x.id === id);
    if (!item) return;
    try {
      Object.assign(item, updates);
      await item.save();
    } catch (err) {
      console.error('[AssistantStore] updateSkill failed', err);
    }
  }

  async function deleteSkill(id: string): Promise<void> {
    const item = skills().find((x) => x.id === id);
    if (!item) return;
    try {
      await item.delete();
    } catch (err) {
      console.error('[AssistantStore] deleteSkill failed', err);
    }
  }

  // ---------------------------------------------------------------- MCP server CRUD

  async function createMcpServer(data: {
    name: string;
    transport: string;
    url?: string;
    command?: string;
    auth?: string;
  }): Promise<void> {
    const p = configPerspective();
    if (!p) return;
    try {
      await McpServer.create(p, {
        name: data.name.trim() || 'MCP server',
        transport: data.transport || 'stdio',
        url: data.url ?? '',
        command: data.command ?? '',
        auth: data.auth ?? '',
      });
    } catch (err) {
      console.error('[AssistantStore] createMcpServer failed', err);
    }
  }

  async function updateMcpServer(
    id: string,
    updates: Partial<{ name: string; transport: string; url: string; command: string; auth: string }>,
  ): Promise<void> {
    const item = mcpServers().find((x) => x.id === id);
    if (!item) return;
    try {
      Object.assign(item, updates);
      await item.save();
    } catch (err) {
      console.error('[AssistantStore] updateMcpServer failed', err);
    }
  }

  async function deleteMcpServer(id: string): Promise<void> {
    const item = mcpServers().find((x) => x.id === id);
    if (!item) return;
    try {
      await item.delete();
    } catch (err) {
      console.error('[AssistantStore] deleteMcpServer failed', err);
    }
  }

  // ---------------------------------------------------------------- Models

  /**
   * Discover model ids from the AD4M backend's OpenAI-compatible `/v1/models` endpoint.
   * Best-effort: on web the executor may not be directly reachable, so on any failure we fall
   * back to the union of model ids already referenced by assistants. The UI additionally lets a
   * user type a model id, so an empty list never blocks configuration.
   */
  async function refreshModels(): Promise<void> {
    const port = adamStore.ad4mPort();
    const token = adamStore.ad4mToken();
    if (port) {
      try {
        const res = await fetch(`http://localhost:${port}/v1/models`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.ok) {
          const json = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
          const ids = Array.isArray(json?.data)
            ? json.data.map((m) => m.id).filter((x): x is string => !!x)
            : Array.isArray(json?.models)
              ? json.models.map((m) => m.id ?? m.name).filter((x): x is string => !!x)
              : [];
          if (ids.length) {
            setModels(ids);
            return;
          }
        }
      } catch (err) {
        console.warn('[AssistantStore] /v1/models unavailable; using referenced models', err);
      }
    }
    const used = Array.from(new Set(assistants().map((a) => a.modelId).filter((x): x is string => !!x)));
    setModels(used);
  }

  let modelFallbackTried = false;
  onMount(() => {
    void refreshModels();
  });
  // Once assistants load, retry discovery a single time if we still have no models — handles
  // the executor port not being ready at mount. Guarded so a persistently empty /v1/models
  // (which re-sets an empty array each call) can't spin this into a refetch loop.
  createEffect(() => {
    if (!modelFallbackTried && models().length === 0 && assistants().length > 0) {
      modelFallbackTried = true;
      void refreshModels();
    }
  });

  const store: AssistantStore = {
    threads,
    activeThreadId,
    activeThread,
    selectThread,
    createThread,
    deleteThread,
    renameThread,
    setThreadModel,

    messages,
    streamingMessageId,
    sendMessage,

    assistants,
    activeAssistant,
    createAssistant,
    updateAssistant,
    deleteAssistant,
    toggleGrant,
    assistantHasGrant,

    personalities,
    createPersonality,
    updatePersonality,
    deletePersonality,

    skills,
    createSkill,
    updateSkill,
    deleteSkill,

    mcpServers,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,

    models,
    refreshModels,
  };

  return <AssistantContext.Provider value={store}>{props.children}</AssistantContext.Provider>;
}

export function useAssistantStore(): AssistantStore {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistantStore must be used within an AssistantStoreProvider');
  return ctx;
}

export default AssistantStoreProvider;
