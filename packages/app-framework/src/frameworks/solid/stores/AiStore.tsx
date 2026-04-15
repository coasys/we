import { Ad4mClient, AITask } from '@coasys/ad4m';
import { Model } from '@coasys/ad4m/lib/src/ai/AIResolver';
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import { schemaPromptExamples } from '@shared/prompts/schemaExamples';
import { deepClone } from '@shared/utils';
import { useAdamStore, useTemplateStore } from '@solid/stores';
import { schemaContext } from '@we/ai-context';
import {
  ChatMessage as ChatMessageModel,
  ChatSession as ChatSessionModel,
  Template as TemplateModel,
} from '@we/models';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { patchByPath } from '@we/schema-shared';
import type { ChatMessage } from '@we/widgets/solid';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

// Re-export for convenience
export type { ChatMessage } from '@we/widgets/solid';

export interface AiStore {
  // --- Existing: AD4M AI state ---
  models: Accessor<Model[]>;
  tasks: Accessor<AITask[]>;
  handleSchemaPrompt: (prompt: string) => Promise<string | undefined>;

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

  // --- Session management ---
  sessions: Accessor<ChatSessionModel[]>;
  activeSessionId: Accessor<string | null>;
  newChat: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;

  // --- Panel mode (chat / code) ---
  panelMode: Accessor<'chat' | 'code'>;
  schemaJson: Accessor<string>;
  setPanelMode: (mode: 'chat' | 'code') => void;
  onSchemaEdit: (json: string) => void;

  // --- Template actions ---
  startFork: () => void;
  startFresh: () => void;
  confirmPicker: (name: string, icon: string) => void;
  cancelPicker: () => void;

  // --- Panel control ---
  toggle: () => void;
  open: () => void;
  close: () => void;

  // --- Chat actions ---
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;

  // --- Settings ---
  setApiKey: (key: string) => void;
}

const AiContext = createContext<AiStore>();

const schemaTask: AITask = {
  taskId: 'we-schema-generation',
  name: 'WE Schema Generation',
  modelId: 'gpt-4',
  systemPrompt: schemaContext,
  promptExamples: schemaPromptExamples,
  metaData: 'Generates UI JSON schema based on user requirements',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Build the full system prompt for Claude chat
const chatSystemPrompt = chatSystemPreamble + schemaContext;

let msgIdCounter = 0;
function createMessage(
  role: ChatMessage['role'],
  content: string,
  status?: ChatMessage['status'],
  messageType?: ChatMessage['messageType'],
): ChatMessage {
  return {
    id: `msg-${++msgIdCounter}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    status,
    messageType: messageType ?? 'text',
  };
}

/** Minimal starter template for "Start Fresh" */
const starterTemplate: SchemaNode = {
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50' },
  children: [
    {
      type: 'Column',
      props: { p: '600', gap: '300', bg: 'primary-100' },
      children: [{ type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Welcome'] }],
    },
    {
      type: 'Column',
      props: { p: '600', styles: { flex: '1' } },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'neutral-400' },
          children: ['Chat with AI to build your interface.'],
        },
      ],
    },
  ],
};

export function AiStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const templateStore = useTemplateStore();

  // --- AD4M AI state (existing) ---
  const [models, setModels] = createSignal<Model[]>([]);
  const [tasks, setTasks] = createSignal<AITask[]>([]);

  // --- Chat state ---
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal('');
  const [apiKey, setApiKeySignal] = createSignal('');

  const apiKeyConfigured = () => apiKey().length > 0;

  // --- Session management ---
  const [sessions, setSessions] = createSignal<ChatSessionModel[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  // Track the AD4M ChatSession model instance for the active session
  let activeSessionModel: ChatSessionModel | null = null;

  // --- Panel mode (chat / code) ---
  const [panelMode, setPanelMode] = createSignal<'chat' | 'code'>('chat');
  const schemaJson = () => JSON.stringify(templateStore.currentTemplate, null, 2);

  // --- Template context (computed) ---
  const templateName = () => templateStore.currentTemplate.meta?.name || templateStore.currentTemplate.id || 'Template';
  const templateIcon = () => templateStore.currentTemplate.meta?.icon || 'cube';
  const isReadOnly = () => {
    const id = templateStore.currentTemplate.id;
    return !!id && templateStore.isCoreTemplate(id);
  };

  // --- Pending changes (buffered edits for read-only templates) ---
  const [pendingTemplate, setPendingTemplate] = createSignal<TemplateSchema | null>(null);
  const hasPendingChanges = () => pendingTemplate() !== null;

  // --- Name + Icon picker state ---
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerAction, setPickerAction] = createSignal<'fork' | 'fresh'>('fork');
  const [pickerDefaultName, setPickerDefaultName] = createSignal('');
  const [pickerDefaultIcon, setPickerDefaultIcon] = createSignal('cube');

  // ----------------------------------------------------------------
  // Session management — load, create, switch, delete
  // ----------------------------------------------------------------

  /** Load sessions for a given template and activate the most recent one */
  async function loadSessionsForTemplate(templateId: string) {
    // Core (read-only) templates use ephemeral in-memory sessions
    if (templateStore.isCoreTemplate(templateId)) {
      setSessions([]);
      setActiveSessionId(null);
      activeSessionModel = null;
      setMessages([]);
      return;
    }

    const templateModel = templateStore.getTemplateModel(templateId);
    if (!templateModel) {
      setSessions([]);
      setActiveSessionId(null);
      activeSessionModel = null;
      setMessages([]);
      return;
    }

    const perspective = adamStore.rootPerspective();
    if (!perspective) return;

    try {
      // Single query: sessions for this template with messages already hydrated
      const templateSessions = await ChatSessionModel.findAll(perspective, {
        parent: { id: templateModel.id, predicate: 'we://chat_session' },
        order: { updatedAt: 'DESC' },
        include: { messages: { order: { createdAt: 'ASC' } } },
      });

      setSessions(templateSessions);

      // Activate the most recent session
      if (templateSessions.length > 0) {
        const latest = templateSessions[0];
        setActiveSessionId(latest.id);
        activeSessionModel = latest;
        setMessages((latest.messages as ChatMessage[]) || []);
      } else {
        setActiveSessionId(null);
        activeSessionModel = null;
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to load sessions for template', templateId, err);
      setSessions([]);
      setActiveSessionId(null);
      activeSessionModel = null;
      setMessages([]);
    }
  }

  /** Create a new chat session for the current template */
  async function newChat() {
    const templateId = templateStore.currentTemplate.id;
    if (!templateId || templateStore.isCoreTemplate(templateId)) {
      // For core templates, clear in-memory messages (ephemeral sessions)
      setMessages([]);
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', 'Chat cleared. Start a new conversation!', undefined, 'info'),
      ]);
      return;
    }

    const templateModel = templateStore.getTemplateModel(templateId);
    const perspective = adamStore.rootPerspective();
    if (!templateModel || !perspective) return;

    try {
      const sessionName = `Chat ${sessions().length + 1}`;
      const now = new Date().toISOString();
      const session = await ChatSessionModel.create(
        perspective,
        { name: sessionName, updatedAt: now },
        { parent: { model: TemplateModel, id: templateModel.id } },
      );

      activeSessionModel = session;
      setActiveSessionId(session.id);
      setMessages([]);
      setSessions((prev) => [session, ...prev]);
    } catch (err) {
      console.error('Failed to create new chat session', err);
    }
  }

  /** Switch to an existing session */
  async function switchSession(sessionId: string) {
    if (sessionId === activeSessionId()) return;

    const target = sessions().find((s) => s.id === sessionId);
    if (!target) return;

    activeSessionModel = target;
    setActiveSessionId(sessionId);
    setMessages((target.messages as ChatMessage[]) || []);
  }

  /** Delete a session and its messages */
  async function deleteSession(sessionId: string) {
    const templateId = templateStore.currentTemplate.id;
    if (!templateId) return;

    const templateModel = templateStore.getTemplateModel(templateId);
    const perspective = adamStore.rootPerspective();
    if (!templateModel || !perspective) return;

    try {
      const target = sessions().find((s) => s.id === sessionId);
      if (!target) return;

      // Delete all hydrated messages in the session
      for (const msg of target.messages || []) {
        await (msg as ChatMessageModel).delete();
      }

      // Remove session from template and delete it
      await templateModel.removeChatSessions(target);
      await target.delete();

      // Update local state
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));

      if (activeSessionId() === sessionId) {
        const remaining = sessions();
        if (remaining.length > 0) {
          const next = remaining[0];
          activeSessionModel = next;
          setActiveSessionId(next.id);
          setMessages((next.messages as ChatMessage[]) || []);
        } else {
          setActiveSessionId(null);
          activeSessionModel = null;
          setMessages([]);
        }
      }
    } catch (err) {
      console.error('Failed to delete session', err);
    }
  }

  /** Persist a message to AD4M and link it to the active session */
  async function persistMessage(
    role: 'user' | 'assistant',
    content: string,
    messageType: string = 'text',
    thinking: string = '',
  ) {
    if (!activeSessionModel) return;

    const perspective = adamStore.rootPerspective();
    if (!perspective) return;

    try {
      await ChatMessageModel.create(
        perspective,
        { role, content, messageType, thinking },
        { parent: { model: ChatSessionModel, id: activeSessionModel.id } },
      );

      // Update session updatedAt
      activeSessionModel.updatedAt = new Date().toISOString();
      await activeSessionModel.save();
    } catch (err) {
      console.error('Failed to persist message', err);
    }
  }

  // ----------------------------------------------------------------
  // AD4M AI initialisation (unchanged)
  // ----------------------------------------------------------------
  async function initialiseStore(client: Ad4mClient): Promise<void> {
    try {
      setModels(await client.ai.getModels());
      setTasks(await client.ai.tasks());

      const existingSchemaTask = tasks().find((r) => r.name === schemaTask.name);
      if (!existingSchemaTask) {
        console.log('Creating schema task');
        await client.ai.addTask(schemaTask.name, 'default', schemaTask.systemPrompt, schemaTask.promptExamples);
        setTasks(await client.ai.tasks());
        console.log('Schema task created', { tasks: tasks() });
      }
    } catch (error) {
      console.error('AdamStore: getMyAI error', error);
    }
  }

  // ----------------------------------------------------------------
  // AD4M AI one-shot prompt (existing — kept as fallback)
  // ----------------------------------------------------------------
  async function handleSchemaPrompt(textPrompt: string) {
    const client = adamStore.adamClient();
    if (!client) return;

    const fullPrompt = `{ "request": "${textPrompt}", "currentSchema": ${JSON.stringify(templateStore.currentTemplate)} }`;

    const existingSchemaTask = tasks().find((t) => t.name === schemaTask.name);
    const taskId = existingSchemaTask ? existingSchemaTask.taskId : null;

    if (!taskId) {
      console.error('Schema task not found');
      return;
    }

    const result = await client.ai.prompt(taskId, fullPrompt);
    console.log('Schema generation result', result);

    try {
      const parsedResult = JSON.parse(result || '{}');
      const updatedSchema = parsedResult.updatedSchema;
      const response = parsedResult.response;

      if (updatedSchema) {
        console.log('Updating template schema in store');
        templateStore.updateTemplate(updatedSchema);
      }
      return response;
    } catch (e) {
      console.error('Failed to parse schema generation result', e);
      return 'Failed to parse schema generation result';
    }
  }

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

  // ----------------------------------------------------------------
  // API key management (persisted to AgentSettings)
  // ----------------------------------------------------------------
  function setApiKey(key: string) {
    setApiKeySignal(key);
    adamStore.updateAgentSettings({ claudeApiKey: key });
  }

  // Load persisted API key when agentSettings become available
  createEffect(() => {
    const settings = adamStore.agentSettings();
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

  async function confirmPicker(name: string, icon: string) {
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

    const success = await templateStore.saveTemplateAs(schema);
    setPickerOpen(false);
    if (!success) {
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', `Failed to save template "${name}".`, undefined, 'error'),
      ]);
      return;
    }

    if (action === 'fresh') {
      setMessages((prev) => [
        ...prev,
        createMessage(
          'assistant',
          `Created new template "${name}". Start chatting to build your interface!`,
          undefined,
          'success',
        ),
      ]);
    } else {
      const hadPending = pendingTemplate() !== null;
      setPendingTemplate(null);
      const suffix = hadPending ? ' Pending changes have been applied.' : '';
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', `Forked as "${name}".${suffix}`, undefined, 'success'),
      ]);
    }
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
    if (templateId && !templateStore.isCoreTemplate(templateId) && !activeSessionModel) {
      await newChat();
    }

    // Add user message to chat
    const userMsg = createMessage('user', text, 'sending');
    setMessages((prev) => [...prev, userMsg]);

    // Persist user message to AD4M (custom templates only)
    if (activeSessionModel) {
      persistMessage('user', text);
    }

    setIsStreaming(true);
    setStreamingContent('');

    try {
      if (apiKeyConfigured()) {
        await sendViaClaude(text);
      } else {
        await sendViaAd4m(text);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, createMessage('assistant', `Error: ${errorText}`, undefined, 'error')]);
    } finally {
      // Mark user message as sent
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, status: 'sent' as const } : m)));
      setIsStreaming(false);
      setStreamingContent('');
    }
  }

  // ----------------------------------------------------------------
  // Claude API path (SSE streaming)
  // ----------------------------------------------------------------
  async function sendViaClaude(text: string) {
    const claudeMessages = buildClaudeMessages(text);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        stream: true,
        system: chatSystemPrompt,
        messages: claudeMessages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Claude API error ${response.status}: ${errorBody}`);
    }

    // Create a placeholder assistant message — shows streaming content as tokens arrive
    const streamMsg = createMessage('assistant', '', 'streaming');
    setMessages((prev) => [...prev, streamMsg]);

    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullContent += event.delta.text;
            // Stream raw tokens to the UI so the user sees something immediately
            setStreamingContent(fullContent);
          }
        } catch {
          // Skip malformed SSE events
        }
      }
    }

    // Process the final assembled content for schema updates
    // This sets the message content to the human-readable "response" text
    // Clear streaming content now that we have the final response
    setStreamingContent('');
    processAiResponse(fullContent, streamMsg.id);
  }

  /**
   * Build Claude messages array from chat history.
   * The currentSchema is included in each user message so the AI
   * always sees the latest template state.
   */
  function buildClaudeMessages(latestText: string) {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

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

    // Add current message with latest schema
    history.push({
      role: 'user',
      content: JSON.stringify({
        request: latestText,
        currentSchema: templateStore.currentTemplate,
      }),
    });

    return history;
  }

  // ----------------------------------------------------------------
  // AD4M AI fallback path
  // ----------------------------------------------------------------
  async function sendViaAd4m(text: string) {
    const response = await handleSchemaPrompt(text);
    const assistantContent = response ?? 'No response from AI';

    // For AD4M path the schema is already applied inside handleSchemaPrompt,
    // so just show the text response in chat
    setMessages((prev) => [...prev, createMessage('assistant', assistantContent)]);
  }

  // ----------------------------------------------------------------
  // Process AI response — parse JSON, apply node patches
  // When streamMsgId is provided the message already exists (streaming)
  // ----------------------------------------------------------------
  function processAiResponse(rawContent: string, streamMsgId?: string) {
    let parsedResult: {
      response?: string;
      updatedNodes?: Array<{ path: number[]; node: SchemaNode }>;
      updatedSchema?: Record<string, unknown>; // legacy fallback
    };
    try {
      // Strip markdown code fences if Claude wrapped the JSON in ```json ... ```
      let jsonStr = rawContent.trim();
      const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      // Also handle case where there's prose before the code fence
      if (!jsonStr.startsWith('{')) {
        const innerFence = jsonStr.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        if (innerFence) {
          jsonStr = innerFence[1].trim();
        }
      }
      parsedResult = JSON.parse(jsonStr);
    } catch {
      // AI returned plain text — show it directly
      updateAssistantMessage(streamMsgId, rawContent);
      return;
    }

    const responseText = parsedResult.response ?? '';
    const updatedNodes = parsedResult.updatedNodes;
    const legacySchema = parsedResult.updatedSchema;

    // Build the merged template by applying node patches via patchByPath
    let mergedTemplate: TemplateSchema | undefined;

    if (updatedNodes && updatedNodes.length > 0) {
      try {
        // deepClone to strip SolidJS proxy — patchByPath uses structuredClone internally
        let patched: SchemaNode = deepClone(templateStore.currentTemplate);
        for (const { path, node } of updatedNodes) {
          patched = patchByPath(patched, path, node);
        }
        mergedTemplate = patched as TemplateSchema;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown patching error';
        console.error('patchByPath failed:', errMsg);
        const display = responseText
          ? `${responseText}\n\n⚠ Could not apply changes: ${errMsg}`
          : `⚠ Could not apply changes: ${errMsg}`;
        updateAssistantMessage(streamMsgId, display, 'error');
        return;
      }
    } else if (legacySchema) {
      mergedTemplate = legacySchema as unknown as TemplateSchema;
    }

    if (mergedTemplate) {
      if (isReadOnly()) {
        // Buffer the changes — user must fork first to apply
        setPendingTemplate(mergedTemplate);
        const display = responseText
          ? `${responseText}\n\n📋 Changes are ready — fork this template to apply them.`
          : '📋 Changes are ready — fork this template to apply them.';
        updateAssistantMessage(streamMsgId, display, 'info');
      } else {
        // Editable template — apply directly and persist to AD4M
        templateStore.updateTemplate(mergedTemplate);
        templateStore.persistCurrentTemplate();
        setPendingTemplate(null);
        const display = responseText ? `${responseText}\n\n✓ Template updated.` : '✓ Template updated.';
        updateAssistantMessage(streamMsgId, display, 'success');
      }
    } else {
      // No schema changes — just a text response
      updateAssistantMessage(streamMsgId, responseText || rawContent);
    }
  }

  /** Update or create the assistant message, then persist to AD4M */
  function updateAssistantMessage(streamMsgId: string | undefined, content: string, messageType?: string) {
    if (streamMsgId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamMsgId
            ? { ...m, content, status: undefined, messageType: (messageType as ChatMessage['messageType']) ?? 'text' }
            : m,
        ),
      );
    } else {
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', content, undefined, messageType as ChatMessage['messageType']),
      ]);
    }

    // Persist to AD4M (fire-and-forget for custom templates)
    if (activeSessionModel) {
      persistMessage('assistant', content, messageType || 'text');
    }
  }

  // ----------------------------------------------------------------
  // Schema JSON editing (Code mode)
  // ----------------------------------------------------------------
  function onSchemaEdit(json: string) {
    try {
      const parsed = JSON.parse(json);
      templateStore.updateTemplate(parsed as TemplateSchema);
      templateStore.persistCurrentTemplate();
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', 'Schema updated from JSON editor.', undefined, 'success'),
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', 'Invalid JSON — changes not applied.', undefined, 'error'),
      ]);
    }
  }

  // ----------------------------------------------------------------
  // Clear chat
  // ----------------------------------------------------------------
  async function clearHistory() {
    // If persisted session, delete messages from AD4M
    if (activeSessionModel) {
      try {
        // Messages are already hydrated on the session model
        for (const msg of activeSessionModel.messages || []) {
          await activeSessionModel.removeMessages(msg as ChatMessageModel);
          await (msg as ChatMessageModel).delete();
        }
        activeSessionModel.messages = [];
      } catch (err) {
        console.error('Failed to clear persisted messages', err);
      }
    }
    setMessages([]);
    setPendingTemplate(null);
  }

  // ----------------------------------------------------------------
  // Initialise AD4M AI when client is ready
  // ----------------------------------------------------------------
  createEffect(() => {
    const client = adamStore.adamClient();
    if (client) initialiseStore(client);
  });

  // ----------------------------------------------------------------
  // Load sessions when template changes
  // ----------------------------------------------------------------
  createEffect(() => {
    const templateId = templateStore.currentTemplate.id;
    if (templateId && adamStore.rootPerspective()) {
      loadSessionsForTemplate(templateId);
    }
  });

  // ----------------------------------------------------------------
  // Store object
  // ----------------------------------------------------------------
  const store: AiStore = {
    // AD4M AI (existing)
    models,
    tasks,
    handleSchemaPrompt,

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

    // Session management
    sessions,
    activeSessionId,
    newChat,
    switchSession,
    deleteSession,

    // Panel mode (chat / code)
    panelMode,
    schemaJson,
    setPanelMode,
    onSchemaEdit,

    // Template actions
    startFork,
    startFresh,
    confirmPicker,
    cancelPicker,

    // Panel control
    toggle,
    open,
    close,

    // Chat actions
    sendMessage,
    clearHistory,

    // Settings
    setApiKey,
  };

  return <AiContext.Provider value={store}>{props.children}</AiContext.Provider>;
}

export function useAiStore(): AiStore {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error('useAiStore must be used within AiStoreProvider');
  return ctx;
}

export default AiStoreProvider;
