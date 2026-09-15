/**
 * AI infrastructure tests — OpenAI SSE parser, tool format adapter,
 * context sections, and live integration against the AD4M executor.
 *
 * The live tests call AD4M's `/v1/chat/completions` at `http://localhost:12000`.
 * When the executor has no reachable AI model, they skip silently.
 * The remaining tests use synthetic responses and run everywhere.
 */
import {
  type Ad4mConnection,
  buildTools,
  formatExternalManifestForPrompt,
  loadContextSections,
  parseOpenAISSE,
  sendPromptRequest,
} from '@shared/ai/aiInfra';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a ReadableStreamDefaultReader from raw string chunks. */
function readerFrom(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = chunks.map((c) => encoder.encode(c));
  let i = 0;
  return {
    read: async () => {
      if (i >= encoded.length) return { done: true as const, value: undefined };
      return { done: false as const, value: encoded[i++] };
    },
    cancel: async () => {},
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

/** Check whether the local AD4M executor has AI models available. */
async function ad4mAiAvailable(connection: Ad4mConnection): Promise<boolean> {
  try {
    const res = await fetch(`${connection.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3_000),
      headers: connection.token ? { Authorization: `Bearer ${connection.token}` } : {},
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: unknown[] };
    return Array.isArray(body.data) && body.data.length > 0;
  } catch {
    return false;
  }
}

// ── parseOpenAISSE ──────────────────────────────────────────────────────

describe('parseOpenAISSE', () => {
  it('extracts text content from streaming chunks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const deltas: string[] = [];
    const result = await parseOpenAISSE(readerFrom(chunks), (text) => deltas.push(text));

    expect(result.textContent).toBe('Hello world!');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toHaveLength(0);
    // Each chunk produces a cumulative delta
    expect(deltas).toEqual(['Hello', 'Hello world', 'Hello world!']);
  });

  it('extracts streamed tool calls with incremental arguments', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Checking..."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"update_schema","arguments":"{\\"pa"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"tches\\":[]}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const onToolUse = vi.fn();
    const result = await parseOpenAISSE(readerFrom(chunks), () => {}, onToolUse);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: 'call_1',
      name: 'update_schema',
      input: { patches: [] },
    });
    expect(result.stopReason).toBe('tool_use');
    expect(onToolUse).toHaveBeenCalledOnce();
  });

  it('handles multiple tool calls with distinct indices', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"we_stores_reference","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"we_component_registry","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const onToolUse = vi.fn();
    const result = await parseOpenAISSE(readerFrom(chunks), () => {}, onToolUse);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('we_stores_reference');
    expect(result.toolCalls[1].name).toBe('we_component_registry');
    // Only notified once, even with multiple tool calls
    expect(onToolUse).toHaveBeenCalledOnce();
  });

  it('maps finish_reason "length" to "max_tokens"', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"truncated"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const result = await parseOpenAISSE(readerFrom(chunks), () => {});
    expect(result.stopReason).toBe('max_tokens');
  });

  it('handles SSE data split across two reads', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"sp',
      'lit"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ];

    const result = await parseOpenAISSE(readerFrom(chunks), () => {});

    expect(result.textContent).toBe('split');
    expect(result.stopReason).toBe('end_turn');
  });

  it('skips malformed SSE events without crashing', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {BROKEN_JSON}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const result = await parseOpenAISSE(readerFrom(chunks), () => {});

    expect(result.textContent).toBe('ok');
    expect(result.stopReason).toBe('end_turn');
  });

  it('ignores non-data lines (comments, event types)', async () => {
    const chunks = [
      'event: message\n',
      'data: {"choices":[{"delta":{"content":"yes"}}]}\n\n',
      ': this is a comment\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const result = await parseOpenAISSE(readerFrom(chunks), () => {});

    expect(result.textContent).toBe('yes');
    expect(result.stopReason).toBe('end_turn');
  });
});

// ── buildTools ──────────────────────────────────────────────────────────

describe('buildTools', () => {
  it('produces OpenAI function-calling format', async () => {
    const tools = (await buildTools()) as Array<Record<string, unknown>>;

    expect(tools.length).toBeGreaterThan(1);

    // Every tool: { type: "function", function: { name, description, parameters } }
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      const fn = tool.function as Record<string, unknown>;
      expect(fn).toBeDefined();
      expect(fn.name).toBeDefined();
      expect(fn.description).toBeDefined();
      expect(fn.parameters).toBeDefined();
    }
  });

  it('includes update_schema as the last tool', async () => {
    const tools = (await buildTools()) as Array<Record<string, unknown>>;
    const lastFn = (tools[tools.length - 1] as Record<string, unknown>).function as Record<string, unknown>;
    expect(lastFn.name).toBe('update_schema');
    expect(lastFn.parameters).toBeDefined();
  });

  it('includes context tools with we_ prefix', async () => {
    const tools = (await buildTools()) as Array<Record<string, unknown>>;
    const firstFn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    expect(firstFn.name).toMatch(/^we_/);
  });
});

// ── formatExternalManifestForPrompt ──────────────────────────────────────

describe('formatExternalManifestForPrompt', () => {
  it('returns empty string for empty manifest', () => {
    expect(formatExternalManifestForPrompt([])).toBe('');
  });

  it('formats data properties with flags', () => {
    const manifest = [
      {
        name: 'TestModel',
        properties: [
          { name: 'title', type: 'string', required: true, isCollection: false },
          { name: 'tags', type: 'string', required: false, isCollection: true },
        ],
      },
    ];

    const result = formatExternalManifestForPrompt(manifest as Parameters<typeof formatExternalManifestForPrompt>[0]);

    expect(result).toContain('### TestModel');
    expect(result).toContain('title (string, required)');
    expect(result).toContain('tags (string, collection)');
  });

  it('separates data properties from HasMany relations', () => {
    const manifest = [
      {
        name: 'Parent',
        properties: [
          { name: 'name', type: 'string', required: true, isCollection: false },
          { name: 'children', type: 'uri', required: false, isCollection: true, relatedEntity: 'Child' },
          { name: 'links', type: 'uri', required: false, isCollection: true },
        ],
      },
    ];

    const result = formatExternalManifestForPrompt(manifest as Parameters<typeof formatExternalManifestForPrompt>[0]);

    expect(result).toContain('children → Child');
    expect(result).toContain('links (untyped');
    // Data property should appear before the relations header
    expect(result.indexOf('name (string')).toBeLessThan(result.indexOf('HasMany'));
  });
});

// ── loadContextSections ──────────────────────────────────────────────────

describe('loadContextSections', () => {
  it('loads a non-empty map with we_-prefixed keys', async () => {
    const sections = await loadContextSections();
    const keys = Object.keys(sections);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(key).toMatch(/^we_/);
    }
  });

  it('provides non-empty content for every section', async () => {
    const sections = await loadContextSections();

    for (const [key, value] of Object.entries(sections)) {
      expect(typeof value).toBe('string');
      expect(value.length, `section ${key} should have content`).toBeGreaterThan(0);
    }
  });

  it('includes stores and components sections', async () => {
    const sections = await loadContextSections();
    const keys = Object.keys(sections);

    expect(keys).toContain('we_stores_reference');
    expect(keys).toContain('we_component_registry');
  });
});

// ── Integration: live AD4M ─────────────────────────────────────────────
//
// These tests call the AD4M executor's OpenAI-compatible endpoint.
// They skip silently when the executor has no AI models configured.
// Timeouts are generous — first-prompt cold loads the model into memory.

describe('AD4M AI integration (live)', () => {
  let available = false;

  const ad4mConnection: Ad4mConnection = {
    baseUrl: 'http://localhost:12000',
    token: '',
  };

  beforeAll(async () => {
    available = await ad4mAiAvailable(ad4mConnection);
  });

  it('streams a text response', async () => {
    if (!available) return;

    const deltas: string[] = [];
    const result = await sendPromptRequest(
      ad4mConnection,
      [{ role: 'user', content: 'Reply with exactly the word "pong" and nothing else.' }],
      (text) => deltas.push(text),
    );

    expect(result.textContent.length).toBeGreaterThan(0);
    expect(result.stopReason).toBe('end_turn');
    expect(deltas.length).toBeGreaterThan(0);
  }, 120_000);

  it('triggers context tool calls when asked about schema sections', async () => {
    if (!available) return;

    // Single attempt — tool-calling behaviour depends on model capability.
    const result = await sendPromptRequest(
      ad4mConnection,
      [
        {
          role: 'user',
          content:
            'You MUST call the we_stores_reference tool before answering. Do not answer from memory. I need to know the exact store types available in WE. Call the tool now.',
        },
      ],
      () => {},
    );

    if (result.stopReason !== 'tool_use') {
      // Model answered directly — not a test failure, just non-deterministic behaviour.
      console.warn('[aiInfra.test] Model answered without calling tools — non-deterministic, skipping assertions');
      return;
    }

    expect(result.toolCalls.length).toBeGreaterThan(0);
    const toolNames = result.toolCalls.map((tc) => tc.name);
    expect(toolNames.some((n) => n.startsWith('we_'))).toBe(true);
  }, 120_000);

  it('completes a full context-tool loop: prompt → tool call → resolve → response', async () => {
    if (!available) return;

    const sections = await loadContextSections();
    const messages: Array<{ role: string; content: unknown }> = [
      {
        role: 'user',
        content:
          'You MUST call the we_stores_reference tool before answering. Do not answer from memory. What store types does WE support? Call the tool now, then list just the type names.',
      },
    ];

    // Step 1 — initial prompt. Retry if model does not call tools (non-deterministic).
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await sendPromptRequest(ad4mConnection, [...messages], () => {});
      if (result.stopReason === 'tool_use') break;
    }

    // If no tool call after retries, the model answered directly — skip gracefully
    if (result!.stopReason !== 'tool_use') {
      console.warn('[aiInfra.test] Model did not call tools after 3 attempts — skipping loop test');
      return;
    }

    expect(result!.toolCalls.length).toBeGreaterThan(0);

    // Step 2 — build assistant turn with tool calls, then tool results
    const assistantBlocks: unknown[] = [];
    if (result!.textContent) {
      assistantBlocks.push({ type: 'text', text: result!.textContent });
    }
    for (const tc of result!.toolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    const toolResults: unknown[] = [];
    for (const tc of result!.toolCalls) {
      const content = tc.name in sections ? sections[tc.name] : `Unknown tool: ${tc.name}`;
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content });
    }
    messages.push({ role: 'user', content: toolResults });

    // Step 3 — continuation, expect text response mentioning stores
    result = await sendPromptRequest(ad4mConnection, messages, () => {});

    expect(result.textContent.length).toBeGreaterThan(0);
    expect(result.textContent.toLowerCase()).toMatch(/store/i);
  }, 300_000);
});
