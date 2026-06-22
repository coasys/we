import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import { deepClone } from '@shared/utils';
import { useAdamStore, useTemplateStore } from '@solid/stores';
import { contextData, schemaContext } from '@we/ai-context';
import { ChatMessage as ChatMessageModel, ChatSession as ChatSessionModel } from '@we/models';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import {
  buildValidationContext,
  ensureNodeIds,
  findNodeById,
  insertChild,
  mergeNode,
  removeChild,
  validateSemantic,
  validateStructure,
} from '@we/schema-shared';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

import type { ChatMessage } from '../components/ChatPanel.types';
import type { ModelManifestEntry } from './AdamStore';

// Re-export for convenience
export type { ChatMessage } from '../components/ChatPanel.types';

// Base validation context built once from the static generated context data.
// External perspective models are merged in reactively inside AiStoreProvider.
const baseValidationCtx = buildValidationContext(contextData);

export interface AiStore {
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
  sessions: Accessor<ChatSessionModel[]>;
  activeSessionId: Accessor<string | null>;
  newChat: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;

  // --- Content mode (preview / visual / code) ---
  contentMode: Accessor<'preview' | 'visual' | 'code'>;
  setContentMode: (mode: 'preview' | 'visual' | 'code') => void;
  schemaJson: Accessor<string>;
  onSchemaEdit: (json: string) => void;

  // --- Undo / Redo ---
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  // --- Template actions ---
  startFork: () => void;
  startFresh: () => void;
  confirmPicker: (name: string, icon: string, destination: 'personal' | 'space') => Promise<void>;
  cancelPicker: () => void;

  // --- Edit mode ---
  isEditMode: Accessor<boolean>;
  editAction: Accessor<'edit' | 'fork' | 'fresh' | null>;
  enterEditMode: (action?: 'edit' | 'fork' | 'fresh') => void;
  exitEditMode: () => void;

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

// Build the full system prompt for Claude chat
const chatSystemPrompt = chatSystemPreamble + schemaContext;

// Tool definition for schema mutations (ID-based patching)
const updateSchemaTool = {
  name: 'update_schema',
  description:
    'Apply patches to the current template schema. Each patch targets a node by its id. Exactly one of node, insert, or remove must be provided per patch.',
  input_schema: {
    type: 'object' as const,
    properties: {
      patches: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            targetId: {
              type: 'string' as const,
              description:
                'For node (update): the id of the node to merge into. For insert/remove: the id of the PARENT node whose children/routes array to modify. Use "" for root.',
            },
            node: {
              type: 'object' as const,
              description:
                'Partial node to merge (JSON Merge Patch). Absent keys preserved, null deletes a key. Mutually exclusive with insert/remove.',
            },
            insert: {
              type: 'object' as const,
              properties: {
                children: {
                  type: 'object' as const,
                  properties: {
                    node: { type: 'object' as const, description: 'The new node to insert.' },
                    after: { type: 'string' as const, description: 'ID of sibling to insert after. Omit to append.' },
                    before: { type: 'string' as const, description: 'ID of sibling to insert before.' },
                  },
                  required: ['node'],
                },
                routes: {
                  type: 'object' as const,
                  properties: {
                    node: { type: 'object' as const, description: 'The new route node to insert.' },
                    after: {
                      type: 'string' as const,
                      description: 'ID of sibling route to insert after. Omit to append.',
                    },
                    before: { type: 'string' as const, description: 'ID of sibling route to insert before.' },
                  },
                  required: ['node'],
                },
              },
              description: 'Insert into children or routes array. Mutually exclusive with node/remove.',
            },
            remove: {
              type: 'object' as const,
              properties: {
                children: { type: 'string' as const, description: 'ID of child to remove.' },
                routes: { type: 'string' as const, description: 'ID of route to remove.' },
              },
              description: 'Remove from children or routes array by child ID. Mutually exclusive with node/insert.',
            },
          },
          required: ['targetId'],
        },
      },
    },
    required: ['patches'],
  },
};

/**
 * Format external (non-WE) manifest entries into a human-readable text block.
 * WE models are already described in schemaContext so only their names are sent;
 * external models need full property descriptions because the AI has no other
 * knowledge of their structure.
 */
function formatExternalManifestForPrompt(manifest: ModelManifestEntry[]): string {
  if (!manifest.length) return '';
  const lines: string[] = ['## External Perspective Models', ''];
  for (const entry of manifest) {
    lines.push(`### ${entry.name}`);
    // A HasMany relation is a collection of IRIs (type === 'uri' && isCollection).
    // Scalar properties are everything else (strings, numbers, booleans, or single IRIs).
    const dataProps = entry.properties.filter((p) => !(p.isCollection && p.type === 'uri'));
    const relations = entry.properties.filter((p) => p.isCollection && p.type === 'uri');
    for (const prop of dataProps) {
      const flags: string[] = [prop.type];
      if (prop.required) flags.push('required');
      if (prop.isCollection) flags.push('collection');
      lines.push(`- ${prop.name} (${flags.join(', ')})`);
    }
    if (relations.length > 0) {
      lines.push('HasMany relations — typed (→ Model) support both include and parent; untyped support parent only:');
      for (const rel of relations) {
        if (rel.relatedModel) {
          lines.push(`- ${rel.name} → ${rel.relatedModel} (include or parent)`);
        } else {
          lines.push(`- ${rel.name} (untyped — parent query only, do NOT use with include)`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

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

  // Reactive validation context — perspective-accurate model allowlist.
  // When a perspective is active its full manifest (WE + external) is used to
  // narrow modelNames to only what is actually registered there.  WE models
  // not present in the manifest (e.g. CollectionBlock in we-root) are excluded.
  // Falls back to the all-WE base context when no perspective is set.
  const getValidationCtx = createMemo(() => {
    const manifest = adamStore.currentPerspectiveModels();
    if (manifest.length === 0) return baseValidationCtx;
    const perspectiveModelNames = new Set(manifest.map((m) => m.name));
    return { ...baseValidationCtx, modelNames: perspectiveModelNames };
  });

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

  // --- Content mode (preview / visual / code) ---
  const [contentMode, setContentMode] = createSignal<'preview' | 'visual' | 'code'>('preview');
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

  // --- Undo / Redo ---
  const MAX_UNDO = 50;
  const [undoStack, setUndoStack] = createSignal<TemplateSchema[]>([]);
  const [redoStack, setRedoStack] = createSignal<TemplateSchema[]>([]);
  const stackCache = new Map<string, { undo: TemplateSchema[]; redo: TemplateSchema[] }>();
  let prevTemplateId: string | undefined;
  const canUndo: Accessor<boolean> = () => undoStack().length > 0;
  const canRedo: Accessor<boolean> = () => redoStack().length > 0;

  function pushSnapshot() {
    const current = isReadOnly()
      ? (pendingTemplate() ?? deepClone(templateStore.currentTemplate))
      : deepClone(templateStore.currentTemplate);
    setUndoStack((prev) => {
      const next = [...prev, current as TemplateSchema];
      return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
    });
    setRedoStack([]);
  }

  async function undo() {
    const stack = undoStack();
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [
      ...prev,
      (isReadOnly()
        ? (pendingTemplate() ?? deepClone(templateStore.currentTemplate))
        : deepClone(templateStore.currentTemplate)) as TemplateSchema,
    ]);
    if (isReadOnly()) {
      setPendingTemplate(snapshot);
    } else {
      templateStore.updateTemplate(snapshot);
      try {
        await templateStore.persistCurrentTemplate();
      } catch {
        /* key may already exist */
      }
    }
    setMessages((prev) => [...prev, createMessage('assistant', '↶ Reverted to previous schema state.')]);
  }

  async function redo() {
    const stack = redoStack();
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [
      ...prev,
      (isReadOnly()
        ? (pendingTemplate() ?? deepClone(templateStore.currentTemplate))
        : deepClone(templateStore.currentTemplate)) as TemplateSchema,
    ]);
    if (isReadOnly()) {
      setPendingTemplate(snapshot);
    } else {
      templateStore.updateTemplate(snapshot);
      try {
        await templateStore.persistCurrentTemplate();
      } catch {
        /* key may already exist */
      }
    }
    setMessages((prev) => [...prev, createMessage('assistant', '↷ Re-applied schema change.')]);
  }

  // --- Name + Icon picker state ---
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerAction, setPickerAction] = createSignal<'fork' | 'fresh'>('fork');
  const [pickerDefaultName, setPickerDefaultName] = createSignal('');
  const [pickerDefaultIcon, setPickerDefaultIcon] = createSignal('cube');
  const pickerShowDestination = () => !!adamStore.currentPerspective();

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
        where: { templateId: templateModel.id },
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
      const session = await ChatSessionModel.create(perspective, {
        name: sessionName,
        templateId: templateModel.id,
        updatedAt: now,
      });

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
  // Edit mode
  // ----------------------------------------------------------------
  const [isEditMode, setIsEditMode] = createSignal(false);
  const [editAction, setEditAction] = createSignal<'edit' | 'fork' | 'fresh' | null>(null);

  function enterEditMode(action: 'edit' | 'fork' | 'fresh' = 'edit') {
    setEditAction(action);
    setIsEditMode(true);
    setIsOpen(true);
  }

  function exitEditMode() {
    setIsEditMode(false);
    setEditAction(null);
    setIsOpen(false);
    setContentMode('preview');
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

    // Enter edit mode on the newly created template
    enterEditMode(action as 'fork' | 'fresh');
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
    setStreamingContent('<span class="shimmer">*Thinking...*</span>');

    try {
      await sendViaClaude(text);
    } catch (err) {
      console.error('[AiStore] sendMessage caught error:', err);
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
    // Abort after 90 seconds to prevent hanging on stalled connections
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.error('[AiStore] Request timed out after 90s — aborting');
      controller.abort();
    }, 90_000);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
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

      return await parseSSEStream(reader, onTextDelta, onToolUseStart);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendViaClaude(text: string) {
    const claudeMessages: Array<{ role: string; content: unknown }> = buildClaudeMessages(text);

    // Create a placeholder assistant message — shows streaming content as tokens arrive
    const streamMsg = createMessage('assistant', '', 'streaming');
    setMessages((prev) => [...prev, streamMsg]);

    let allTextContent = '';
    const maxContinuations = 5; // Safety limit to prevent infinite loops

    const showInlineStatus = (status: string) => {
      const sep = allTextContent ? '\n\n' : '';
      setStreamingContent(allTextContent + sep + `<span class="shimmer">*${status}*</span>`);
    };

    for (let turn = 0; turn <= maxContinuations; turn++) {
      let streamResult;
      try {
        streamResult = await sendClaudeRequest(
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
        console.error(`[AiStore] Turn ${turn}: sendClaudeRequest threw`, err);
        throw err;
      }
      const { textContent, toolCalls, stopReason } = streamResult;

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

      // --- Atomic patching: accumulate all patches before applying ---
      // We clone the template once and apply all tool calls' patches to it.
      // Only after ALL patches succeed and validate do we apply to the store.
      let accumulatedSchema: SchemaNode = ensureNodeIds(deepClone(templateStore.currentTemplate) as SchemaNode);

      // Capture baseline validation issues so we only reject patches that introduce NEW problems
      const baselineSemantic = validateSemantic(accumulatedSchema as TemplateSchema, getValidationCtx());
      const baselineIssueKeys = new Set(baselineSemantic.errors.map((e) => `${e.severity}|${e.path}|${e.message}`));
      let allPatchesValid = true;

      for (const tc of toolCalls) {
        if (tc.name === 'update_schema') {
          type IdPatch = {
            targetId: string;
            node?: Record<string, unknown>;
            insert?: {
              children?: { node: SchemaNode; after?: string; before?: string };
              routes?: { node: SchemaNode; after?: string; before?: string };
            };
            remove?: { children?: string; routes?: string };
          };
          const patches = (tc.input as { patches: IdPatch[] }).patches;

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

          console.log(`[AiStore] Tool call ${tc.id} — ${patches.length} patch(es):`);
          for (const p of patches) {
            const op = p.node ? 'update' : p.insert ? 'insert' : 'remove';
            console.log(`  targetId: "${p.targetId}", op: ${op}`);
          }
          console.log('[AiStore] Patch detail:', JSON.stringify(patches, null, 2));

          // Apply ID-based patches to the accumulated schema (not to the store yet)
          try {
            let patchError: string | undefined;

            for (const patch of patches) {
              const opCount = [patch.node, patch.insert, patch.remove].filter(Boolean).length;
              if (opCount !== 1) {
                patchError = `Patch for targetId "${patch.targetId}" must have exactly one of: node, insert, remove.`;
                break;
              }

              if (patch.node) {
                // Merge update
                if (patch.targetId === '') {
                  // Root merge
                  accumulatedSchema = mergeNode(accumulatedSchema, patch.node);
                } else {
                  const found = findNodeById(accumulatedSchema, patch.targetId);
                  if (!found) {
                    patchError = `No node with id "${patch.targetId}" found in the current schema.`;
                    break;
                  }
                  const merged = mergeNode(found.node, patch.node);
                  // Replace the node in its parent
                  if (found.parent) {
                    if (found.key === 'children' && found.parent.children) {
                      found.parent.children[found.index] = merged;
                    } else if (found.key === 'routes' && found.parent.routes) {
                      found.parent.routes[found.index] = merged as SchemaNode & { path: string };
                    } else if (found.key.startsWith('slots.') && found.parent.slots) {
                      const slotName = found.key.slice(6);
                      found.parent.slots[slotName] = merged;
                    } else if (found.key.startsWith('props.') && found.parent.props) {
                      const propName = found.key.slice(6);
                      const existing = (found.parent.props as Record<string, unknown>)[propName];
                      if (Array.isArray(existing)) {
                        (existing as SchemaNode[])[found.index] = merged;
                      } else {
                        (found.parent.props as Record<string, unknown>)[propName] = merged;
                      }
                    }
                  } else {
                    // found.node IS the root — merge into accumulated
                    accumulatedSchema = merged;
                  }
                }
              } else if (patch.insert) {
                // Insert child or route
                const insertSpec = patch.insert.children ?? patch.insert.routes;
                const arrayKey = patch.insert.children ? 'children' : 'routes';
                if (!insertSpec) {
                  patchError = `Insert patch for targetId "${patch.targetId}" must specify children or routes.`;
                  break;
                }
                const position = insertSpec.after
                  ? { after: insertSpec.after }
                  : insertSpec.before
                    ? { before: insertSpec.before }
                    : undefined;
                // Strip positioning keys that the AI sometimes misplaces inside the node body.
                // These are patch directives, not valid SchemaNode fields — leaving them on the
                // node causes zSchemaNode.strict() to reject the schema with "Unrecognized key".
                const cleanNode = { ...(insertSpec.node as Record<string, unknown>) };
                delete cleanNode.after;
                delete cleanNode.before;
                const nodeToInsert = cleanNode as SchemaNode;
                const err = insertChild(accumulatedSchema, patch.targetId, arrayKey, nodeToInsert, position);
                if (err) {
                  patchError = err.error;
                  break;
                }
              } else if (patch.remove) {
                // Remove child or route
                const childId = patch.remove.children ?? patch.remove.routes;
                const arrayKey = patch.remove.children ? 'children' : 'routes';
                if (!childId) {
                  patchError = `Remove patch for targetId "${patch.targetId}" must specify children or routes.`;
                  break;
                }
                const err = removeChild(accumulatedSchema, patch.targetId, arrayKey, childId);
                if (err) {
                  patchError = err.error;
                  break;
                }
              }
            }

            if (patchError) {
              console.warn(`[AiStore] Patch validation failed: ${patchError}`);
              allTextContent += '\n\n<span class="warning">⚠ Template failed validation. Retrying...</span>';
              setStreamingContent(allTextContent);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tc.id,
                content: `Patching failed: ${patchError}`,
                is_error: true,
              });
              allPatchesValid = false;
              continue;
            }

            // Assign IDs to any newly inserted nodes
            ensureNodeIds(accumulatedSchema);

            // Mark success for this tool call (actual store apply deferred)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: 'Patches applied.',
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown patching error';
            console.warn(`[AiStore] Patch apply failed: ${errMsg}`);
            allTextContent += '\n\n<span class="warning">⚠ Patch error — retrying...</span>';
            setStreamingContent(allTextContent);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `Patching failed: ${errMsg}. Please check your node structure and try again.`,
              is_error: true,
            });
            allPatchesValid = false;
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

      // --- Atomic apply: validate + apply only if ALL tool calls succeeded ---
      if (allPatchesValid) {
        const mergedTemplate = accumulatedSchema as TemplateSchema;
        console.log('[AiStore] merged template:', JSON.stringify(mergedTemplate, null, 2));

        // Step 1: Structural validation (Zod schema check)
        const structural = validateStructure(mergedTemplate);
        if (!structural.valid) {
          console.warn(`[AiStore] Structural validation failed (${structural.errors.length} issues):`);
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
          console.log('[AiStore] Structural validation passed');

          // Step 2: Semantic validation (component/prop/store checks)
          // Only fail on NEW issues introduced by the patch, not pre-existing ones
          const semantic = validateSemantic(mergedTemplate, getValidationCtx());
          const newIssues = semantic.errors.filter(
            (e) => !baselineIssueKeys.has(`${e.severity}|${e.path}|${e.message}`),
          );
          const isClean = newIssues.length === 0;

          if (semantic.errors.length > 0 && newIssues.length === 0) {
            console.log(`[AiStore] Semantic validation: ${semantic.errors.length} pre-existing issue(s) ignored`);
          }

          if (!isClean) {
            console.warn(`[AiStore] Semantic validation failed (${newIssues.length} new issues):`);
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
            console.log('[AiStore] Semantic validation passed — buffering (read-only template)');
            pushSnapshot();
            setPendingTemplate(mergedTemplate);
            for (const tr of toolResults) {
              tr.content = 'Schema changes validated and buffered. Template is read-only — user must fork to apply.';
            }
          } else {
            console.log('[AiStore] Semantic validation passed — applying to store');
            pushSnapshot();
            templateStore.updateTemplate(mergedTemplate);
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

    // Add current message with latest schema (with node IDs for ID-based patching)
    const schemaWithIds = ensureNodeIds(deepClone(templateStore.currentTemplate) as SchemaNode);
    const manifest = adamStore.currentPerspectiveModels();
    const payload: Record<string, unknown> = {
      request: latestText,
      currentSchema: schemaWithIds,
    };
    if (manifest.length > 0) {
      const weModelNames = new Set(baseValidationCtx.modelNames);
      const weInPerspective = manifest.filter((m) => weModelNames.has(m.name)).map((m) => m.name);
      const externalInPerspective = manifest.filter((m) => !weModelNames.has(m.name));
      // WE models: send only names — AI already has their full structure in schemaContext
      if (weInPerspective.length > 0) payload.availableWeModels = weInPerspective;
      // External models: send full property descriptions — AI has no other knowledge of them
      if (externalInPerspective.length > 0)
        payload.externalModels = formatExternalManifestForPrompt(externalInPerspective);
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
      pushSnapshot();
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
  // Load sessions when template changes
  // ----------------------------------------------------------------
  createEffect(() => {
    const templateId = templateStore.currentTemplate.id;
    if (templateId && adamStore.rootPerspective()) {
      loadSessionsForTemplate(templateId);
      setContentMode('preview');
      setIsEditMode(false);
      setEditAction(null);
    }
  });

  // Save/restore undo/redo stacks per template
  createEffect(() => {
    const newId = templateStore.currentTemplate.id;
    untrack(() => {
      // Save outgoing stacks
      if (prevTemplateId) {
        const undo = undoStack();
        const redo = redoStack();
        if (undo.length || redo.length) {
          stackCache.set(prevTemplateId, { undo, redo });
        } else {
          stackCache.delete(prevTemplateId);
        }
      }
      // Restore incoming stacks
      const cached = newId ? stackCache.get(newId) : undefined;
      setUndoStack(cached?.undo ?? []);
      setRedoStack(cached?.redo ?? []);
      prevTemplateId = newId;
    });
  });

  // ----------------------------------------------------------------
  // Store object
  // ----------------------------------------------------------------
  const store: AiStore = {
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

    // Template actions
    startFork,
    startFresh,
    confirmPicker,
    cancelPicker,

    // Edit mode
    isEditMode,
    editAction,
    enterEditMode,
    exitEditMode,

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
