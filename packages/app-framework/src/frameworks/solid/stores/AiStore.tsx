import { Ad4mClient, AITask } from '@coasys/ad4m';
import { Model } from '@coasys/ad4m/lib/src/ai/AIResolver';
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import { schemaPromptExamples } from '@shared/prompts/schemaExamples';
import { deepClone } from '@shared/utils';
import { useAdamStore, useTemplateStore } from '@solid/stores';
import { schemaContext } from '@we/ai-context';
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
function createMessage(role: ChatMessage['role'], content: string, status?: ChatMessage['status']): ChatMessage {
  return { id: `msg-${++msgIdCounter}`, role, content, timestamp: Date.now(), status };
}

/** Minimal starter template for "Start Fresh" */
const starterTemplate: SchemaNode = {
  type: 'container',
  props: { direction: 'column' },
  children: [
    {
      type: 'container',
      props: { tag: 'header', padding: 'lg', bg: 'primary-100' },
      children: [{ type: 'text', props: { content: 'Welcome', fontSize: 'xl', fontWeight: 'bold' } }],
    },
    {
      type: 'container',
      props: { padding: 'lg', grow: true },
      children: [{ type: 'text', props: { content: 'Chat with AI to build your interface.', color: 'neutral-400' } }],
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
  const [apiKey, setApiKeySignal] = createSignal('');

  const apiKeyConfigured = () => apiKey().length > 0;

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
    setPickerOpen(false);

    const action = pickerAction();
    const templateId = name.toLowerCase().replace(/\s+/g, '-');

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
    if (!success) {
      setMessages((prev) => [...prev, createMessage('system', `Failed to save template "${name}".`)]);
      return;
    }

    if (action === 'fresh') {
      setMessages((prev) => [
        ...prev,
        createMessage('system', `Created new template "${name}". Start chatting to build your interface!`),
      ]);
    } else {
      const hadPending = pendingTemplate() !== null;
      setPendingTemplate(null);
      const suffix = hadPending ? ' Pending changes have been applied.' : '';
      setMessages((prev) => [...prev, createMessage('system', `Forked as "${name}".${suffix}`)]);
    }
  }

  function cancelPicker() {
    setPickerOpen(false);
  }

  // ----------------------------------------------------------------
  // Chat — send message (Claude primary, AD4M fallback)
  // ----------------------------------------------------------------
  async function sendMessage(text: string) {
    // Add user message to chat
    const userMsg = createMessage('user', text, 'sending');
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);

    try {
      if (apiKeyConfigured()) {
        await sendViaClaude(text);
      } else {
        await sendViaAd4m(text);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, createMessage('system', `Error: ${errorText}`)]);
    } finally {
      // Mark user message as sent
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, status: 'sent' as const } : m)));
      setIsStreaming(false);
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

    // Create a placeholder assistant message — shows "Thinking..." via loading indicator
    // We do NOT stream raw JSON tokens into the bubble
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
          }
        } catch {
          // Skip malformed SSE events
        }
      }
    }

    // Process the final assembled content for schema updates
    // This sets the message content to the human-readable "response" text
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
        updateAssistantMessage(streamMsgId, display);
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
        updateAssistantMessage(streamMsgId, display);
      } else {
        // Editable template — apply directly and persist to AD4M
        templateStore.updateTemplate(mergedTemplate);
        templateStore.persistCurrentTemplate();
        setPendingTemplate(null);
        const display = responseText ? `${responseText}\n\n✓ Template updated.` : '✓ Template updated.';
        updateAssistantMessage(streamMsgId, display);
      }
    } else {
      // No schema changes — just a text response
      updateAssistantMessage(streamMsgId, responseText || rawContent);
    }
  }

  /** Update or create the assistant message */
  function updateAssistantMessage(streamMsgId: string | undefined, content: string) {
    if (streamMsgId) {
      setMessages((prev) => prev.map((m) => (m.id === streamMsgId ? { ...m, content, status: undefined } : m)));
    } else {
      setMessages((prev) => [...prev, createMessage('assistant', content)]);
    }
  }

  // ----------------------------------------------------------------
  // Clear chat
  // ----------------------------------------------------------------
  function clearHistory() {
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
