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

// Tool definition for schema mutations
const updateSchemaTool = {
  name: 'update_schema',
  description:
    'Apply node patches to the current template schema. Each patch replaces the node at the given path. Use path [] to replace the entire schema.',
  input_schema: {
    type: 'object' as const,
    properties: {
      patches: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            path: {
              type: 'array' as const,
              items: { type: 'integer' as const },
              description:
                'Path to the node to replace. [] = root, [0] = first child of root, [2, 0] = first child of third child of root. Use -1 to enter routes array.',
            },
            node: {
              type: 'object' as const,
              description: 'The full SchemaNode to insert at this path.',
            },
          },
          required: ['path', 'node'],
        },
      },
    },
    required: ['patches'],
  },
};

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
      setMessages((prev) => [...prev, createMessage('assistant', 'Chat cleared. Start a new conversation!')]);
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
  async function persistMessage(role: 'user' | 'assistant', content: string) {
    if (!activeSessionModel) return;

    const perspective = adamStore.rootPerspective();
    if (!perspective) return;

    try {
      await ChatMessageModel.create(
        perspective,
        { role, content },
        { parent: { model: ChatSessionModel, id: activeSessionModel.id } },
      );
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
    setStreamingContent('<span class="muted">*Thinking...*</span>');

    try {
      if (apiKeyConfigured()) {
        await sendViaClaude(text);
      } else {
        await sendViaAd4m(text);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, createMessage('assistant', `Error: ${errorText}`)]);
    } finally {
      // Mark user message as sent
      setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, status: 'sent' as const } : m)));
      setIsStreaming(false);
      setStreamingContent('');
    }
  }

  // ----------------------------------------------------------------
  // Claude API path (SSE streaming with tool_use)
  // ----------------------------------------------------------------

  /** Validate patches against the current schema before applying */
  function validatePatches(
    patches: Array<{ path: number[]; node: unknown }>,
    schema: SchemaNode,
  ): { valid: true } | { valid: false; error: string } {
    for (const { path, node } of patches) {
      // Verify path exists in current schema (empty path = root replacement, always valid)
      let target: SchemaNode = schema;
      for (let i = 0; i < path.length; i++) {
        if (path[i] === -1) {
          // Route marker — next index selects from routes array
          const routes = target.routes;
          const routeIdx = path[i + 1];
          if (routeIdx === undefined) {
            return { valid: false, error: `Path [${path.join(', ')}] invalid: -1 at end with no route index` };
          }
          if (!routes || routeIdx < 0 || routeIdx >= routes.length) {
            return {
              valid: false,
              error: `Path [${path.join(', ')}] invalid: route index ${routeIdx} out of bounds (node has ${routes?.length ?? 0} routes)`,
            };
          }
          // Skip the route index (already validated) and continue from the route node itself
          target = routes[routeIdx] as SchemaNode;
          i++; // skip next element (route index)
          continue;
        }

        const children = target.children;
        if (!children || path[i] < 0 || path[i] >= children.length) {
          return {
            valid: false,
            error: `Path [${path.join(', ')}] invalid: index ${path[i]} out of bounds at depth ${i} (node has ${children?.length ?? 0} children)`,
          };
        }
        const child = children[path[i]];
        if (typeof child === 'string' || child === null || child === undefined) {
          return {
            valid: false,
            error: `Path [${path.join(', ')}] invalid: node at depth ${i} is a text node, not a SchemaNode`,
          };
        }
        target = child as SchemaNode;
      }

      // Verify node has required 'type' field
      if (!node || typeof node !== 'object' || !('type' in node)) {
        return { valid: false, error: `Patch at [${path.join(', ')}]: node must have a 'type' field` };
      }
    }
    return { valid: true };
  }

  /** Parse an SSE stream and return extracted text + tool calls + stop reason */
  async function parseSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onTextDelta: (text: string) => void,
    onToolUseStart?: (textSoFar: string) => void,
  ): Promise<{
    textContent: string;
    toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    stopReason: string;
  }> {
    const decoder = new TextDecoder();
    let buffer = '';
    let textContent = '';
    let stopReason = '';

    // Tool use tracking
    let currentBlockType: 'text' | 'tool_use' | null = null;
    let currentToolId = '';
    let currentToolName = '';
    let toolInputBuffer = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

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

          switch (event.type) {
            case 'content_block_start':
              if (event.content_block?.type === 'text') {
                currentBlockType = 'text';
              } else if (event.content_block?.type === 'tool_use') {
                currentBlockType = 'tool_use';
                currentToolId = event.content_block.id ?? '';
                currentToolName = event.content_block.name ?? '';
                toolInputBuffer = '';
                onToolUseStart?.(textContent);
              }
              break;

            case 'content_block_delta':
              if (currentBlockType === 'text' && event.delta?.text) {
                textContent += event.delta.text;
                onTextDelta(textContent);
              } else if (currentBlockType === 'tool_use' && event.delta?.partial_json) {
                toolInputBuffer += event.delta.partial_json;
              }
              break;

            case 'content_block_stop':
              if (currentBlockType === 'tool_use' && currentToolId) {
                try {
                  const input = JSON.parse(toolInputBuffer);
                  toolCalls.push({ id: currentToolId, name: currentToolName, input });
                } catch {
                  // Malformed tool input — will be handled as no tool calls
                  console.error('Failed to parse tool input:', toolInputBuffer.slice(0, 200));
                }
              }
              currentBlockType = null;
              break;

            case 'message_delta':
              if (event.delta?.stop_reason) {
                stopReason = event.delta.stop_reason;
              }
              break;
          }
        } catch {
          // Skip malformed SSE events
        }
      }
    }

    return { textContent, toolCalls, stopReason };
  }

  /** Send a request to Claude and handle the response stream */
  async function sendClaudeRequest(
    claudeMessages: Array<{ role: string; content: unknown }>,
    onTextDelta: (text: string) => void,
    onToolUseStart?: (textSoFar: string) => void,
  ) {
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
        tools: [updateSchemaTool],
        system: [
          {
            type: 'text',
            text: chatSystemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: claudeMessages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Claude API error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    return parseSSEStream(reader, onTextDelta, onToolUseStart);
  }

  async function sendViaClaude(text: string) {
    const claudeMessages: Array<{ role: string; content: unknown }> = buildClaudeMessages(text);

    // Create a placeholder assistant message — shows streaming content as tokens arrive
    const streamMsg = createMessage('assistant', '', 'streaming');
    setMessages((prev) => [...prev, streamMsg]);

    let allTextContent = '';
    const maxContinuations = 3; // Safety limit to prevent infinite loops

    const showInlineStatus = (status: string) => {
      const sep = allTextContent ? '\n\n' : '';
      setStreamingContent(allTextContent + sep + `<span class="muted">*${status}*</span>`);
    };

    for (let turn = 0; turn <= maxContinuations; turn++) {
      if (turn > 0) showInlineStatus('Retrying...');
      const { textContent, toolCalls, stopReason } = await sendClaudeRequest(
        claudeMessages,
        (accumulated) => {
          const sep = allTextContent && accumulated ? '\n\n' : '';
          setStreamingContent(allTextContent + sep + accumulated);
        },
        (textSoFar) => {
          const base = allTextContent + (allTextContent && textSoFar ? '\n\n' : '') + textSoFar;
          const sep = base ? '\n\n' : '';
          setStreamingContent(base + sep + '<span class="muted">*Updating template...*</span>');
        },
      );

      if (textContent) {
        allTextContent += (allTextContent ? '\n\n' : '') + textContent;
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

      for (const tc of toolCalls) {
        if (tc.name === 'update_schema') {
          const patches = (tc.input as { patches: Array<{ path: number[]; node: SchemaNode }> }).patches;

          if (!patches || !Array.isArray(patches)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: 'Invalid input: patches must be an array',
              is_error: true,
            });
            continue;
          }

          // Validate before applying
          const currentSchema = deepClone(templateStore.currentTemplate) as SchemaNode;
          const validation = validatePatches(patches, currentSchema);

          if (!validation.valid) {
            allTextContent += '\n\n<span class="warning">⚠ Template failed validation. Retrying...</span>';
            setStreamingContent(allTextContent);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `Validation failed: ${validation.error}. Please check the currentSchema paths and try again.`,
              is_error: true,
            });
            continue;
          }

          // Apply patches
          try {
            let patched: SchemaNode = currentSchema;
            for (const { path, node } of patches) {
              patched = patchByPath(patched, path, node);
            }
            const mergedTemplate = patched as TemplateSchema;

            if (isReadOnly()) {
              setPendingTemplate(mergedTemplate);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tc.id,
                content: 'Schema changes validated and buffered. Template is read-only — user must fork to apply.',
              });
            } else {
              templateStore.updateTemplate(mergedTemplate);
              templateStore.persistCurrentTemplate();
              setPendingTemplate(null);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tc.id,
                content: 'Template updated successfully.',
              });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown patching error';
            allTextContent += '\n\n<span class="warning">⚠ Patch error — retrying...</span>';
            setStreamingContent(allTextContent);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `Patching failed: ${errMsg}. Please check your node structure and try again.`,
              is_error: true,
            });
          }
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `Unknown tool: ${tc.name}`,
            is_error: true,
          });
        }
      }

      // Add tool results to conversation history
      claudeMessages.push({ role: 'user', content: toolResults });

      // Check if any errors occurred — if so, continue the loop for Claude to self-correct
      const hasErrors = toolResults.some((r) => r.is_error);
      if (!hasErrors) {
        // Inject inline success indicator immediately
        const pended = isReadOnly() && pendingTemplate() !== null;
        // ✅ ⚠️ ❌
        const statusLine = pended
          ? '<span class="warning">⚠ Changes are ready — fork this template to apply them.</span>'
          : '<span class="success">✓ Template updated</span>';
        allTextContent += '\n\n' + statusLine;
        setStreamingContent(allTextContent);

        // Show thinking indicator before final request
        showInlineStatus('Thinking...');

        // Send one more request so Claude can provide closing text
        const final = await sendClaudeRequest(claudeMessages, (accumulated) => {
          const sep = allTextContent && accumulated ? '\n\n' : '';
          setStreamingContent(allTextContent + sep + accumulated);
        });
        if (final.textContent) {
          allTextContent += (allTextContent ? '\n\n' : '') + final.textContent;
        }

        setStreamingContent('');

        // Finalize the AI message (includes the inline status line)
        updateAssistantMessage(streamMsg.id, allTextContent || 'Changes applied.');
        return;
      }

      // Has errors — loop continues, Claude will self-correct
      showInlineStatus('Retrying...');
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

  /** Update or create the assistant message, then persist to AD4M */
  function updateAssistantMessage(streamMsgId: string | undefined, content: string) {
    if (streamMsgId) {
      setMessages((prev) => prev.map((m) => (m.id === streamMsgId ? { ...m, content, status: undefined } : m)));
    } else {
      setMessages((prev) => [...prev, createMessage('assistant', content)]);
    }

    // Persist to AD4M (fire-and-forget for custom templates)
    if (activeSessionModel) {
      persistMessage('assistant', content);
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
