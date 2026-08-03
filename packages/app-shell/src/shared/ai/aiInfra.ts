/**
 * aiInfra — the browser-side AI infrastructure: direct Anthropic API access, SSE stream parsing,
 * the schema-mutation tool definition, and prompt assembly.
 *
 * Isolated from the edit-session store on purpose: this file is the complete surface of "the
 * browser calls a model with the user's API key". A backend-executed assistant (the pattern the
 * assistant module introduces, where the executor runs models and writes replies into the
 * dataset) would replace exactly this file — the sessions, panels, and undo history it serves
 * are unaffected. Keep it free of Solid and store imports so that boundary stays real.
 */
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import { schemaContext } from '@we/ai-context';
import type { ModelManifestEntry } from '@we/backend-shared';

/** The full system prompt for schema-editing chat. */
export const chatSystemPrompt = chatSystemPreamble + schemaContext;

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
 * WE models are already described in schemaContext so only their names are sent;
 * external models need full property descriptions because the AI has no other
 * knowledge of their structure.
 */
export function formatExternalManifestForPrompt(manifest: ModelManifestEntry[]): string {
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

export interface StreamResult {
  textContent: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}

/** Parse an SSE stream and return extracted text + tool calls + stop reason */
export async function parseSSEStream(
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

/** Send a request to Claude and handle the response stream */
export async function sendClaudeRequest(
  apiKey: string,
  claudeMessages: Array<{ role: string; content: unknown }>,
  onTextDelta: (text: string) => void,
  onToolUseStart?: (textSoFar: string) => void,
): Promise<StreamResult> {
  // Abort after 90 seconds to prevent hanging on stalled connections
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.error('[aiInfra] Request timed out after 90s — aborting');
    controller.abort();
  }, 90_000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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
