/**
 * aiInfra — browser-side AI infrastructure for the WE schema editor.
 *
 * All AI requests route through AD4M's OpenAI-compatible endpoint
 * (`/v1/chat/completions`) with SSE streaming. The executor handles
 * provider dispatch (Anthropic, Ollama, OpenAI) — WE never calls a
 * provider directly.
 *
 * Also manages the split context system: a compact core prompt (~7K tokens)
 * plus on-demand context tools the model calls to load schema sections.
 * Context tools resolve locally in the browser — each returns a pre-compiled
 * section of the schema reference.
 *
 * Isolated from the edit-session store on purpose: this file owns the wire
 * protocol and the prompt surface. The conversation loop, tool resolution,
 * and patch application live in `EditorStore`. Keep it free of Solid and
 * store imports so that boundary stays real.
 */
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import type { EntityManifestEntry } from '@we/backend-shared';

// ── AD4M connection ──────────────────────────────────────────────────────

/** The connection details needed to reach AD4M's /v1 API surface. */
export interface Ad4mConnection {
  /** HTTP base URL of the executor (e.g. `http://localhost:12000`). */
  baseUrl: string;
  /** Bearer token for authentication. */
  token: string;
}

// ── System prompt (split context) ─────────────────────────────────────────

/**
 * The compact core system prompt for tool-based AI chat.
 *
 * Contains the chat preamble + rules, routing, entity models, design tokens,
 * and a directory of available context tools (~7K tokens total).
 * Resolved once on first use, then cached.
 */
let corePromptLoad: Promise<string> | undefined;

export function chatCorePrompt(): Promise<string> {
  corePromptLoad ??= import('@we/ai-context').then(({ coreContext }) => chatSystemPreamble + coreContext);
  return corePromptLoad;
}

/**
 * The full monolithic system prompt (kept for backward compatibility).
 * Used when context tools are not available (e.g. Anthropic without tool support).
 */
let fullPromptLoad: Promise<string> | undefined;

export function chatSystemPrompt(): Promise<string> {
  fullPromptLoad ??= import('@we/ai-context').then(({ schemaContext }) => chatSystemPreamble + schemaContext);
  return fullPromptLoad;
}

// ── Context sections (on-demand) ──────────────────────────────────────────

let sectionsLoad: Promise<Record<string, string>> | undefined;

/** Load the context sections map.  Each key matches a context tool name. */
export function loadContextSections(): Promise<Record<string, string>> {
  sectionsLoad ??= import('@we/ai-context').then(({ contextSections }) => contextSections);
  return sectionsLoad;
}

/** A context tool definition — no parameters, returns section text. */
interface ContextToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, never> };
}

let toolDefsLoad: Promise<ContextToolDef[]> | undefined;

/** Load the context tool definitions (provider-neutral format). */
export function loadContextToolDefs(): Promise<ContextToolDef[]> {
  toolDefsLoad ??= import('@we/ai-context').then(({ contextToolDefs }) => [...contextToolDefs] as ContextToolDef[]);
  return toolDefsLoad;
}

// ── Tool definitions ──────────────────────────────────────────────────────

/** Tool definition for schema mutations (ID-based patching). */
export const updateSchemaTool = {
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
 * WE models already appear in the schema context so only their names get sent;
 * external models need full property descriptions because the AI has no other
 * knowledge of their structure.
 */
export function formatExternalManifestForPrompt(manifest: EntityManifestEntry[]): string {
  if (!manifest.length) return '';
  const lines: string[] = ['## External Perspective Models', ''];
  for (const entry of manifest) {
    lines.push(`### ${entry.name}`);
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
        if (rel.relatedEntity) {
          lines.push(`- ${rel.name} → ${rel.relatedEntity} (include or parent)`);
        } else {
          lines.push(`- ${rel.name} (untyped — parent query only, do NOT use with include)`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Stream result ────────────────────────────────────────────────────────

export interface StreamResult {
  textContent: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}

// ── Tool format (OpenAI) ─────────────────────────────────────────────────

/**
 * Build the tools array for the OpenAI-compatible request body.
 * Combines context tools + update_schema in OpenAI function-calling format.
 */
export async function buildTools(): Promise<unknown[]> {
  const contextDefs = await loadContextToolDefs();

  // OpenAI format: { type: "function", function: { name, description, parameters } }
  const contextTools = contextDefs.map((def) => ({
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
  const updateSchemaOpenAI = {
    type: 'function',
    function: {
      name: updateSchemaTool.name,
      description: updateSchemaTool.description,
      parameters: updateSchemaTool.input_schema,
    },
  };
  return [...contextTools, updateSchemaOpenAI];
}

// ── OpenAI SSE streaming ─────────────────────────────────────────────────

/** Parse an OpenAI-compatible SSE stream and return extracted text + tool calls + stop reason. */
export async function parseOpenAISSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const decoder = new TextDecoder();
  let buffer = '';
  let textContent = '';
  let stopReason = '';
  let toolUseNotified = false;

  // Track tool calls by index — arguments stream in pieces across chunks
  const toolCallBuilders: Map<number, { id: string; name: string; argsBuffer: string }> = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const chunk = JSON.parse(data);
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content delta
        if (delta?.content) {
          textContent += delta.content;
          onTextDelta(textContent);
        }

        // Tool call deltas — streamed incrementally
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallBuilders.has(idx)) {
              // First fragment for this tool call — carries id and function name
              toolCallBuilders.set(idx, {
                id: tc.id ?? `tc_${idx}_${Date.now()}`,
                name: tc.function?.name ?? '',
                argsBuffer: tc.function?.arguments ?? '',
              });
              if (!toolUseNotified) {
                onToolUseStart?.(textContent);
                toolUseNotified = true;
              }
            } else {
              // Subsequent fragment — append arguments
              const builder = toolCallBuilders.get(idx)!;
              if (tc.function?.arguments) {
                builder.argsBuffer += tc.function.arguments;
              }
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          stopReason = choice.finish_reason;
        }
      } catch {
        // Skip malformed SSE events
      }
    }
  }

  // Assemble completed tool calls
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  for (const [, builder] of toolCallBuilders) {
    try {
      const input = builder.argsBuffer ? JSON.parse(builder.argsBuffer) : {};
      toolCalls.push({ id: builder.id, name: builder.name, input });
    } catch {
      console.error('[aiInfra] Failed to parse tool arguments:', builder.argsBuffer.slice(0, 200));
    }
  }

  // Normalise stop reason to the internal vocabulary
  if (toolCalls.length > 0 && (stopReason === 'tool_calls' || stopReason === 'stop')) {
    stopReason = 'tool_use';
  } else if (stopReason === 'length') {
    stopReason = 'max_tokens';
  } else if (stopReason === 'stop' || !stopReason) {
    stopReason = 'end_turn';
  }

  return { textContent, toolCalls, stopReason };
}

// ── Provider dispatch (AD4M) ─────────────────────────────────────────────

/**
 * Send a prompt request through AD4M's OpenAI-compatible /v1/chat/completions.
 *
 * Uses the split context system: the system prompt contains only the core
 * context (~7K tokens) plus tool definitions for on-demand sections.
 * The caller (EditorStore) resolves context tool calls from the local
 * section map and sends results back in the conversation loop.
 */
export async function sendPromptRequest(
  connection: Ad4mConnection,
  messages: Array<{ role: string; content: unknown }>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error('[aiInfra] AD4M request timed out after 180s — aborting');
    controller.abort();
  }, 180_000);

  try {
    const tools = await buildTools();
    const systemPrompt = await chatCorePrompt();

    // Convert messages from Anthropic content-block format to OpenAI format
    const openAIMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(toOpenAIMessage)];

    const baseUrl = connection.baseUrl.replace(/\/$/, '');

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      },
      body: JSON.stringify({
        model: 'default',
        max_tokens: 16384,
        stream: true,
        tools,
        messages: openAIMessages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`AD4M AI error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    return await parseOpenAISSE(reader, onTextDelta, onToolUseStart);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert an Anthropic-shaped message to an OpenAI wire message.
 *
 * The EditorStore's tool loop builds messages in Anthropic content-block
 * format ({ type: "text", text }, { type: "tool_use", ... }, { type: "tool_result", ... }).
 * AD4M's /v1/chat/completions speaks OpenAI format, so each turn needs
 * translation.
 */
function toOpenAIMessage(msg: { role: string; content: unknown }): Record<string, unknown> {
  const { role, content } = msg;

  // Simple string content
  if (typeof content === 'string') {
    return { role, content };
  }

  // Array of content blocks (Anthropic format)
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    const toolCalls: unknown[] = [];
    const toolResults: Array<Record<string, unknown>> = [];

    for (const block of content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
          },
        });
      } else if (block.type === 'tool_result') {
        toolResults.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        });
      }
    }

    // Tool results → return the first as a "tool" message.
    // The EditorStore builds tool results as user messages with content arrays.
    // OpenAI expects one "tool" message per tool_call_id.
    if (toolResults.length > 0 && role === 'user') {
      return toolResults[0];
    }

    // Assistant message with tool calls
    const result: Record<string, unknown> = {
      role,
      content: textParts.join('\n') || null,
    };
    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }
    return result;
  }

  // Fallback
  return { role, content: typeof content === 'object' ? JSON.stringify(content) : String(content) };
}
