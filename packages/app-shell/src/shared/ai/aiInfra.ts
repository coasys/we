/**
 * aiInfra — multi-provider AI infrastructure: SSE stream parsing, non-streaming
 * request/response, tool definitions, and prompt assembly.
 *
 * Three wire protocols:
 * - **Anthropic** — /v1/messages with content-block SSE events
 * - **OpenAI** — /v1/chat/completions (OpenAI, Google, Groq, OpenRouter, AD4M, etc.)
 * - **Ollama** — native /api/chat (non-streaming; see `sendOllamaRequest` for why)
 *
 * Messages stay in Anthropic format internally; conversion happens at the boundary.
 * Keep this file free of Solid/store imports — a backend assistant replaces exactly this.
 */
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import type { EntityManifestEntry } from '@we/backend-shared';

import type { AiProvider } from './providers';

/**
 * The full system prompt for schema-editing chat.
 *
 * The schema reference it embeds is ~117 KB of generated text, and it is needed only when a
 * request is actually sent. As a module-level constant it was in the first bytes every visitor
 * downloaded, whether or not they ever opened the assistant. Resolved once, then cached.
 */
let promptLoad: Promise<string> | undefined;

export function chatSystemPrompt(): Promise<string> {
  promptLoad ??= import('@we/ai-context').then(({ schemaContext }) => chatSystemPreamble + schemaContext);
  return promptLoad;
}

// ---------------------------------------------------------------------------
// Tool definition — Anthropic format (canonical), converted to OpenAI on send
// ---------------------------------------------------------------------------

/** Tool definition for schema mutations (ID-based patching). Anthropic wire format. */
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

/** Convert the Anthropic tool definition to OpenAI function-calling format. */
export function toolToOpenAI(tool: typeof updateSchemaTool) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

// ---------------------------------------------------------------------------
// External manifest formatting
// ---------------------------------------------------------------------------

/**
 * Format external (non-WE) manifest entries into a human-readable text block.
 * WE models are already described in schemaContext so only their names are sent;
 * external models need full property descriptions because the AI has no other
 * knowledge of their structure.
 */
export function formatExternalManifestForPrompt(manifest: EntityManifestEntry[]): string {
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

// ---------------------------------------------------------------------------
// Shared result type
// ---------------------------------------------------------------------------

export interface StreamResult {
  textContent: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}

// ---------------------------------------------------------------------------
// Anthropic SSE parser
// ---------------------------------------------------------------------------

/** Parse an Anthropic SSE stream and return extracted text + tool calls + stop reason. */
export async function parseAnthropicSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
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

// ---------------------------------------------------------------------------
// Text post-processing — thinking tags and inline tool calls
// ---------------------------------------------------------------------------

/**
 * Strip `<think>…</think>` blocks from model output.
 *
 * Qwen3 and similar reasoning models wrap internal chain-of-thought in these
 * tags. The reasoning content carries no user value and should not appear in
 * the final response text.
 */
export function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Extract tool calls from text content when a model outputs them inline
 * rather than as structured `delta.tool_calls`.
 *
 * Qwen3 (and other models running through Ollama) may emit tool calls in
 * several ways depending on model version and streaming mode:
 *
 * 1. `<tool_call>{"name":…, "arguments":…}</tool_call>` — XML-wrapped
 * 2. Raw `{"name": "update_schema", "arguments": {…}}` — bare JSON in text
 * 3. Markdown code blocks containing either form
 * 4. Direct tool input `{"patches": […]}` — the arguments without a wrapper
 *
 * The function tries each pattern in priority order and returns the extracted
 * calls alongside the cleaned text (matched regions removed).
 *
 * The `arguments` value may arrive as a JSON string or as an object — both
 * forms are normalised to an object.
 */
export function extractToolCallsFromText(text: string): {
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  cleanedText: string;
} {
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  let cleanedText = text;

  // --- Pass 1: <tool_call> XML tags ---
  const xmlMatches = [...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)];
  for (const match of xmlMatches) {
    const parsed = tryParseToolCall(match[1]);
    if (parsed) toolCalls.push({ id: `text-tc-${toolCalls.length}`, ...parsed });
  }
  if (toolCalls.length > 0) {
    cleanedText = cleanedText.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, '').trim();
    return { toolCalls, cleanedText };
  }

  // --- Pass 2: markdown code blocks containing tool-call JSON ---
  const codeBlockMatches = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g)];
  for (const match of codeBlockMatches) {
    const parsed = tryParseToolCall(match[1]);
    if (parsed) toolCalls.push({ id: `text-tc-${toolCalls.length}`, ...parsed });
  }
  if (toolCalls.length > 0) {
    cleanedText = cleanedText.replace(/```(?:json)?\s*\n?[\s\S]*?\n?\s*```/g, '').trim();
    return { toolCalls, cleanedText };
  }

  // --- Pass 3: bare JSON objects matching tool-call shape ---
  // Look for {"name": "update_schema" …} or {"patches": […]} anywhere in text.
  // Use a brace-counting scanner to extract complete objects.
  const jsonCandidates = extractJsonObjects(text);
  for (const { json, start, end } of jsonCandidates) {
    const parsed = tryParseToolCall(json);
    if (parsed) {
      toolCalls.push({ id: `text-tc-${toolCalls.length}`, ...parsed });
      // Remove the matched JSON from cleaned text
      cleanedText = cleanedText.slice(0, start) + cleanedText.slice(end);
    }
  }
  if (toolCalls.length > 0) {
    cleanedText = cleanedText.trim();
  }

  return { toolCalls, cleanedText };
}

/**
 * Try to parse a JSON string as a tool call. Accepts two formats:
 * - `{"name": "…", "arguments": {…}}` — standard wrapper
 * - `{"patches": […]}` — direct update_schema input (no wrapper)
 *
 * Returns null when the JSON does not match any recognised tool-call shape.
 */
function tryParseToolCall(raw: string): { name: string; input: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    // Format 1: {"name": "update_schema", "arguments": {…}}
    if (parsed.name && typeof parsed.name === 'string') {
      const args = typeof parsed.arguments === 'string' ? JSON.parse(parsed.arguments) : (parsed.arguments ?? {});
      return { name: parsed.name, input: args };
    }

    // Format 2: direct tool input — {"patches": […]}
    if (Array.isArray(parsed.patches)) {
      return { name: 'update_schema', input: parsed };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Scan text for top-level JSON objects using brace counting.
 *
 * Returns each candidate with its start/end indices so callers can remove
 * the matched region from the source text. Processes in reverse order so
 * index-based splicing stays stable.
 */
function extractJsonObjects(text: string): Array<{ json: string; start: number; end: number }> {
  const results: Array<{ json: string; start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 0;
      let inString = false;
      let escaped = false;
      const start = i;
      for (let j = i; j < text.length; j++) {
        const ch = text[j];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            results.push({ json: text.slice(start, j + 1), start, end: j + 1 });
            i = j + 1;
            break;
          }
        }
      }
      if (depth !== 0) i++; // unclosed brace — skip
    } else {
      i++;
    }
  }
  // Reverse so callers can splice by index without shifting
  return results.reverse();
}

// ---------------------------------------------------------------------------
// OpenAI SSE parser
// ---------------------------------------------------------------------------

/**
 * Parse an OpenAI-compatible SSE stream.
 *
 * OpenAI streams `choices[0].delta` chunks:
 * - `delta.content` — text tokens
 * - `delta.tool_calls[i]` — incremental tool call fragments
 * - `choices[0].finish_reason` — "stop" or "tool_calls"
 *
 * After parsing, two post-processing steps run:
 * 1. `<think>…</think>` blocks are stripped (Qwen3 reasoning output).
 * 2. When no structured tool calls arrived, `<tool_call>` XML tags in the text
 *    are extracted as a fallback — Ollama may emit them inline for some models.
 */
export async function parseOpenAISSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const decoder = new TextDecoder();
  let buffer = '';
  let textContent = '';
  let stopReason = '';

  // Tool calls accumulate across multiple delta chunks, keyed by index
  const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();
  let toolUseStartFired = false;

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
        const event = JSON.parse(data);
        const choice = event.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta) {
          // Text content
          if (delta.content) {
            textContent += delta.content;
            onTextDelta(textContent);
          }

          // Tool calls (incremental)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              let accum = toolCallAccum.get(idx);
              if (!accum) {
                accum = { id: tc.id ?? '', name: '', arguments: '' };
                toolCallAccum.set(idx, accum);
              }
              if (tc.id) accum.id = tc.id;
              if (tc.function?.name) accum.name = tc.function.name;
              if (tc.function?.arguments) accum.arguments += tc.function.arguments;

              // Fire the tool-use-start callback on the first tool call fragment
              if (!toolUseStartFired) {
                toolUseStartFired = true;
                onToolUseStart?.(textContent);
              }
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          // Normalise: OpenAI uses "stop" / "tool_calls"; Anthropic uses "end_turn" / "tool_use"
          if (choice.finish_reason === 'stop') {
            stopReason = 'end_turn';
          } else if (choice.finish_reason === 'tool_calls') {
            stopReason = 'tool_use';
          } else {
            stopReason = choice.finish_reason;
          }
        }
      } catch (parseErr) {
        console.warn('[aiInfra] Malformed SSE event skipped:', data.slice(0, 200), parseErr);
      }
    }
  }

  // If the stream ended with zero content and no stop reason, the endpoint
  // likely returned an error page (HTML) or an incompatible response format.
  if (!textContent && toolCallAccum.size === 0 && !stopReason) {
    throw new Error('Empty response — the endpoint returned no content. Check the provider URL and model.');
  }

  // Assemble final tool calls from accumulated fragments
  const toolCalls: StreamResult['toolCalls'] = [];
  for (const [, accum] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
    try {
      const input = JSON.parse(accum.arguments);
      toolCalls.push({ id: accum.id, name: accum.name, input });
    } catch {
      console.error('Failed to parse OpenAI tool arguments:', accum.arguments.slice(0, 200));
    }
  }

  // ---- Post-processing ----

  // 1. Strip <think> blocks (Qwen3 reasoning output)
  textContent = stripThinkingTags(textContent);

  // 2. Fallback: extract tool calls from text when the model emitted them
  //    inline (e.g. Ollama + Qwen3 <tool_call> XML tags) instead of as
  //    structured delta.tool_calls.
  if (toolCalls.length === 0 && textContent) {
    const extracted = extractToolCallsFromText(textContent);
    if (extracted.toolCalls.length > 0) {
      toolCalls.push(...extracted.toolCalls);
      textContent = extracted.cleanedText;
      stopReason = 'tool_use';
      // Fire the callback that was never triggered during streaming
      onToolUseStart?.(textContent);
    }
  }

  return { textContent, toolCalls, stopReason };
}

// ---------------------------------------------------------------------------
// Message format conversion (Anthropic ↔ OpenAI)
// ---------------------------------------------------------------------------

/**
 * Convert Anthropic-format conversation messages to OpenAI format.
 *
 * Anthropic uses content-block arrays for multi-part messages (text + tool_use),
 * and nests tool results inside user messages as { type: 'tool_result' } blocks.
 *
 * OpenAI uses `tool_calls` on assistant messages and separate `role: 'tool'` messages.
 */
function convertMessagesToOpenAI(
  anthropicMessages: Array<{ role: string; content: unknown }>,
  systemPrompt: string,
): Array<Record<string, unknown>> {
  const openaiMessages: Array<Record<string, unknown>> = [];

  // System prompt goes as the first message in OpenAI format
  openaiMessages.push({ role: 'system', content: systemPrompt });

  for (const msg of anthropicMessages) {
    if (msg.role === 'assistant') {
      // Check if content is an array of content blocks (tool_use + text)
      if (Array.isArray(msg.content)) {
        const blocks = msg.content as Array<Record<string, unknown>>;
        const textParts: string[] = [];
        const toolCalls: Array<Record<string, unknown>> = [];

        for (const block of blocks) {
          if (block.type === 'text') {
            textParts.push(block.text as string);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }

        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: textParts.join('\n') || null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        openaiMessages.push(assistantMsg);
      } else {
        // Plain text assistant message
        openaiMessages.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'user') {
      // Check if content is an array of tool_result blocks
      if (Array.isArray(msg.content)) {
        const blocks = msg.content as Array<Record<string, unknown>>;
        const isToolResults = blocks.every((b) => b.type === 'tool_result');

        if (isToolResults) {
          // Convert each tool_result to a separate tool message
          for (const block of blocks) {
            openaiMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content as string,
            });
          }
        } else {
          // Mixed content — stringify
          openaiMessages.push({ role: 'user', content: JSON.stringify(msg.content) });
        }
      } else {
        openaiMessages.push({ role: 'user', content: msg.content });
      }
    }
  }

  return openaiMessages;
}

// ---------------------------------------------------------------------------
// Anthropic request sender
// ---------------------------------------------------------------------------

/** Send a request to an Anthropic-protocol endpoint and handle the response stream. */
export async function sendAnthropicRequest(
  provider: AiProvider,
  anthropicMessages: Array<{ role: string; content: unknown }>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error('[aiInfra] Anthropic request timed out after 10min — aborting');
    controller.abort();
  }, 600_000);

  try {
    const url = `${provider.baseUrl}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 16384,
        stream: true,
        tools: [updateSchemaTool],
        system: [
          {
            type: 'text',
            text: await chatSystemPrompt(),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`${provider.name} API error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    return await parseAnthropicSSE(reader, onTextDelta, onToolUseStart);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible request sender
// ---------------------------------------------------------------------------

/** Whether a provider runs locally (AD4M executor). Gates non-streaming + tool_choice. */
function isLocalProvider(provider: AiProvider): boolean {
  return /localhost|127\.0\.0\.1/i.test(provider.baseUrl);
}

/** Send a request to an OpenAI-compatible endpoint and handle the response stream. */
export async function sendOpenAIRequest(
  provider: AiProvider,
  anthropicMessages: Array<{ role: string; content: unknown }>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error(`[aiInfra] ${provider.name} request timed out after 10min — aborting`);
    controller.abort();
  }, 600_000);

  try {
    const systemPrompt = await chatSystemPrompt();
    const openaiMessages = convertMessagesToOpenAI(anthropicMessages, systemPrompt);
    const url = `${provider.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (provider.apiKey) {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    // Local providers (Ollama, AD4M) use non-streaming to get reliable tool calls.
    // Ollama + Qwen3 streaming often emits tool calls as text rather than structured
    // delta.tool_calls — non-streaming avoids that entirely.
    const local = isLocalProvider(provider);

    // OpenAI deprecated `max_tokens` in favour of `max_completion_tokens`.
    // Most OpenAI-compat providers (Groq, OpenRouter, Ollama) still accept
    // `max_tokens`, so we send both — endpoints ignore the one they don't use.
    // Local models (AD4M executor) need tool_choice "required" — with the full
    // system prompt, "auto" lets the model skip the tool and dump the schema as
    // text instead. Cloud models handle "auto" correctly at that prompt length.
    // (Ollama uses the native /api/chat endpoint via protocol: 'ollama' and does
    // not pass through this function.)
    const body: Record<string, unknown> = {
      model: provider.model,
      max_tokens: 16384,
      stream: !local,
      tools: [toolToOpenAI(updateSchemaTool)],
      tool_choice: local ? 'required' : 'auto',
      messages: openaiMessages,
    };
    // Cloud providers also accept max_completion_tokens (OpenAI's newer name).
    if (!local) {
      body.max_completion_tokens = 16384;
    }
    // AD4M executor may proxy to Ollama — pass num_ctx to expand context.
    // (Direct Ollama uses protocol: 'ollama' and the native endpoint instead.)
    if (local) {
      body.options = { num_ctx: 131072 };
    }

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`${provider.name} API error ${response.status}: ${errorBody}`);
    }

    if (local) {
      return await parseOpenAIComplete(response, onTextDelta, onToolUseStart);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    return await parseOpenAISSE(reader, onTextDelta, onToolUseStart);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse a non-streaming OpenAI-compatible response (used for local providers).
 *
 * The complete JSON response contains `choices[0].message` with `content` and
 * optional `tool_calls`. This avoids streaming bugs in Ollama where tool calls
 * appear as text instead of structured output.
 */
/**
 * Shared post-processing for non-streaming responses (OpenAI and Ollama).
 *
 * Strips thinking tags, falls back to text-embedded tool calls when structured
 * ones are absent, fires UI callbacks, and maps the provider's stop reason to
 * the internal `StreamResult['stopReason']`.
 */
function postProcessComplete(
  rawText: string,
  rawToolCalls: StreamResult['toolCalls'],
  finishReason: string,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): StreamResult {
  const toolCalls = [...rawToolCalls];
  let textContent = stripThinkingTags(rawText);

  // Fallback: extract tool calls from text when the model emitted them inline
  if (toolCalls.length === 0 && textContent) {
    const extracted = extractToolCallsFromText(textContent);
    if (extracted.toolCalls.length > 0) {
      toolCalls.push(...extracted.toolCalls);
      textContent = extracted.cleanedText;
    }
  }

  if (textContent) onTextDelta(textContent);
  if (toolCalls.length > 0) onToolUseStart?.(textContent);

  const stopReason: StreamResult['stopReason'] =
    toolCalls.length > 0
      ? 'tool_use'
      : finishReason === 'stop' || finishReason === 'end_turn' || finishReason === ''
        ? 'end_turn'
        : finishReason === 'length'
          ? 'max_tokens'
          : 'end_turn';

  return { textContent, toolCalls, stopReason };
}

export async function parseOpenAIComplete(
  response: Response,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const json = await response.json();
  const choice = json.choices?.[0];
  if (!choice) throw new Error('Empty response from provider — no choices returned');

  const message = choice.message ?? {};
  const toolCalls: StreamResult['toolCalls'] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      try {
        const fn = tc.function ?? {};
        const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? {});
        toolCalls.push({ id: tc.id || `tc-${toolCalls.length}`, name: fn.name, input: args });
      } catch {
        console.error('[aiInfra] Failed to parse tool call arguments:', tc);
      }
    }
  }

  return postProcessComplete(message.content ?? '', toolCalls, choice.finish_reason ?? '', onTextDelta, onToolUseStart);
}

// ---------------------------------------------------------------------------
// Ollama native request sender
// ---------------------------------------------------------------------------

/**
 * Send a request to Ollama's native /api/chat endpoint.
 *
 * Ollama's OpenAI-compatible `/v1/chat/completions` ignores `options.num_ctx`,
 * silently truncating prompts to ~16 K tokens regardless of the value set.
 * The WE schema context runs ~75 K tokens — at 16 K the model never sees tool
 * definitions and dumps JSON as text instead of calling `update_schema`.
 *
 * The native endpoint honours `options.num_ctx` and produces proper structured
 * tool calls when the full prompt loads.
 *
 * Non-streaming only — Ollama streaming often emits tool calls as text rather
 * than structured output. Non-streaming avoids that entirely.
 */
async function sendOllamaRequest(
  provider: AiProvider,
  anthropicMessages: Array<{ role: string; content: unknown }>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error(`[aiInfra] ${provider.name} Ollama request timed out after 10min — aborting`);
    controller.abort();
  }, 600_000);

  try {
    const systemPrompt = await chatSystemPrompt();
    const openaiMessages = convertMessagesToOpenAI(anthropicMessages, systemPrompt);

    // Ollama's native /api/chat expects tool_calls[].function.arguments as a
    // parsed object, not a JSON string. convertMessagesToOpenAI produces the
    // OpenAI wire format (JSON string) — parse them back for the native endpoint.
    // Without this, the second turn fails with:
    //   "Value looks like object, but can't find closing '}' symbol"
    for (const msg of openaiMessages) {
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
          const fn = tc.function as Record<string, unknown> | undefined;
          if (fn && typeof fn.arguments === 'string') {
            try {
              fn.arguments = JSON.parse(fn.arguments as string);
            } catch {
              /* leave as string if not valid JSON */
            }
          }
        }
      }
    }

    const base = provider.baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    const url = `${base}/api/chat`;

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        stream: false,
        tools: [toolToOpenAI(updateSchemaTool)],
        messages: openaiMessages,
        options: {
          num_ctx: 131072,
          num_predict: 16384,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`${provider.name} API error ${response.status}: ${errorBody}`);
    }

    return await parseOllamaComplete(response, onTextDelta, onToolUseStart);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse a non-streaming Ollama native /api/chat response.
 *
 * Differs from OpenAI: `message` at top level, `done_reason` instead of
 * `finish_reason`, and `tool_calls[].function.arguments` as a parsed object.
 */
export async function parseOllamaComplete(
  response: Response,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const json = await response.json();
  const message = json.message;
  if (!message) throw new Error('Empty response from Ollama — no message returned');

  const toolCalls: StreamResult['toolCalls'] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      const fn = tc.function ?? {};
      const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? {});
      toolCalls.push({ id: `ollama-tc-${toolCalls.length}`, name: fn.name, input: args });
    }
  }

  return postProcessComplete(message.content ?? '', toolCalls, json.done_reason ?? '', onTextDelta, onToolUseStart);
}

// ---------------------------------------------------------------------------
// Provider dispatcher
// ---------------------------------------------------------------------------

/**
 * Send a request through the configured provider.
 *
 * Messages are always in Anthropic format (the canonical internal representation).
 * The dispatcher converts to the provider's wire format as needed.
 *
 * Returns a normalised StreamResult regardless of provider.
 */
export async function sendProviderRequest(
  provider: AiProvider,
  anthropicMessages: Array<{ role: string; content: unknown }>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  if (provider.protocol === 'anthropic') {
    return sendAnthropicRequest(provider, anthropicMessages, onTextDelta, onToolUseStart);
  }
  if (provider.protocol === 'ollama') {
    return sendOllamaRequest(provider, anthropicMessages, onTextDelta, onToolUseStart);
  }
  return sendOpenAIRequest(provider, anthropicMessages, onTextDelta, onToolUseStart);
}
