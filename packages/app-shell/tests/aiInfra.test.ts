/**
 * AI infrastructure — SSE parsing, tool call extraction, and thinking tag handling.
 *
 * Tests the pure functions in `aiInfra.ts` that parse provider responses and
 * post-process model output. Mock ReadableStream for SSE tests, everything else real.
 */
import {
  extractToolCallsFromText,
  parseAnthropicSSE,
  parseOpenAIComplete,
  parseOpenAISSE,
  stripThinkingTags,
  toolToOpenAI,
  updateSchemaTool,
} from '@shared/ai/aiInfra';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers — simulate a ReadableStream from SSE text
// ---------------------------------------------------------------------------

/** Build a ReadableStreamDefaultReader from raw SSE lines. */
function sseReader(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let idx = 0;
  return {
    read: async () => (idx < chunks.length ? { done: false, value: chunks[idx++] } : { done: true, value: undefined }),
    releaseLock: () => {},
    cancel: async () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

/** Shorthand: wrap an OpenAI SSE delta event in `data: {json}` format. */
function openaiDelta(delta: Record<string, unknown>, finishReason?: string | null): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  })}`;
}

/** Shorthand: wrap an OpenAI SSE event with only finish_reason (no delta). */
function openaiFinish(reason: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })}`;
}

// ---------------------------------------------------------------------------
// stripThinkingTags
// ---------------------------------------------------------------------------

describe('stripThinkingTags', () => {
  it('removes a single <think> block', () => {
    const input = '<think>I need to add a button</think>Here is the result.';
    expect(stripThinkingTags(input)).toBe('Here is the result.');
  });

  it('removes multiple <think> blocks', () => {
    const input = '<think>first thought</think>Hello <think>second thought</think>world';
    expect(stripThinkingTags(input)).toBe('Hello world');
  });

  it('handles multiline thinking blocks', () => {
    const input = `<think>
I should analyze the schema.
The user wants a button.
Let me figure out the right patch.
</think>
I've added a button to your template.`;
    expect(stripThinkingTags(input)).toBe("I've added a button to your template.");
  });

  it('returns the original text when no <think> tags exist', () => {
    const input = 'No thinking here, just response.';
    expect(stripThinkingTags(input)).toBe(input);
  });

  it('returns empty string when the entire content sits inside <think> tags', () => {
    expect(stripThinkingTags('<think>all thinking, no output</think>')).toBe('');
  });

  it('handles empty <think> blocks', () => {
    expect(stripThinkingTags('<think></think>Hello')).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// extractToolCallsFromText
// ---------------------------------------------------------------------------

describe('extractToolCallsFromText', () => {
  // --- Pass 1: <tool_call> XML tags ---
  it('extracts a single tool call from <tool_call> tags', () => {
    const text = `Some preamble text.
<tool_call>
{"name": "update_schema", "arguments": {"patches": [{"targetId": "root", "node": {"type": "Column"}}]}}
</tool_call>`;
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input).toEqual({
      patches: [{ targetId: 'root', node: { type: 'Column' } }],
    });
    expect(result.cleanedText).toBe('Some preamble text.');
  });

  it('extracts multiple tool calls from <tool_call> tags', () => {
    const text = `<tool_call>
{"name": "update_schema", "arguments": {"patches": [{"targetId": "a"}]}}
</tool_call>
Some middle text.
<tool_call>
{"name": "update_schema", "arguments": {"patches": [{"targetId": "b"}]}}
</tool_call>`;
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'a' }] });
    expect(result.toolCalls[1].input).toEqual({ patches: [{ targetId: 'b' }] });
    expect(result.cleanedText).toBe('Some middle text.');
  });

  it('handles arguments as a JSON string (double-encoded)', () => {
    const text = `<tool_call>
{"name": "update_schema", "arguments": "{\\"patches\\": [{\\"targetId\\": \\"root\\"}]}"}
</tool_call>`;
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'root' }] });
  });

  it('assigns sequential IDs to extracted tool calls', () => {
    const text = `<tool_call>{"name": "a", "arguments": {}}</tool_call>
<tool_call>{"name": "b", "arguments": {}}</tool_call>`;
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls[0].id).toBe('text-tc-0');
    expect(result.toolCalls[1].id).toBe('text-tc-1');
  });

  it('returns empty array and unchanged text when no tool patterns match', () => {
    const text = 'Just a normal response with no tool calls.';
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanedText).toBe(text);
  });

  it('skips malformed JSON inside <tool_call> tags', () => {
    const text = `<tool_call>not valid json</tool_call>
<tool_call>{"name": "update_schema", "arguments": {"patches": []}}</tool_call>`;
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
  });

  it('defaults missing arguments to empty object', () => {
    const text = '<tool_call>{"name": "update_schema"}</tool_call>';
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].input).toEqual({});
  });

  // --- Pass 2: markdown code blocks ---
  it('extracts tool call from a markdown code block', () => {
    const text = `I'll update the schema now.

\`\`\`json
{"name": "update_schema", "arguments": {"patches": [{"targetId": "root", "node": {"type": "Row"}}]}}
\`\`\``;
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input.patches).toEqual([{ targetId: 'root', node: { type: 'Row' } }]);
    expect(result.cleanedText).toBe("I'll update the schema now.");
  });

  it('extracts tool call from a code block without language tag', () => {
    const text = 'Here:\n\n```\n{"name": "update_schema", "arguments": {"patches": []}}\n```';
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
  });

  // --- Pass 3: bare JSON objects ---
  it('extracts a bare JSON object with name + arguments (no wrapper)', () => {
    const text =
      'I will update the schema. {"name": "update_schema", "arguments": {"patches": [{"targetId": "x"}]}} Done.';
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'x' }] });
    expect(result.cleanedText).not.toContain('{');
  });

  it('extracts a direct {"patches": [...]} (tool input without wrapper)', () => {
    const text = 'Here are the changes:\n{"patches": [{"targetId": "root", "node": {"type": "Column"}}]}';
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input.patches).toEqual([{ targetId: 'root', node: { type: 'Column' } }]);
    expect(result.cleanedText).toBe('Here are the changes:');
  });

  it('does not extract bare JSON that has no tool-call shape', () => {
    const text = 'The config looks like {"theme": "dark", "fontSize": 14} in settings.';
    const result = extractToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanedText).toBe(text);
  });

  // --- Priority: XML > code block > bare JSON ---
  it('prefers <tool_call> XML over bare JSON', () => {
    const text =
      '<tool_call>{"name": "update_schema", "arguments": {"patches": [{"targetId": "a"}]}}</tool_call> {"patches": [{"targetId": "b"}]}';
    const result = extractToolCallsFromText(text);
    // XML match wins and short-circuits — bare JSON left in cleanedText
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'a' }] });
  });
});

// ---------------------------------------------------------------------------
// toolToOpenAI
// ---------------------------------------------------------------------------

describe('toolToOpenAI', () => {
  it('converts Anthropic tool format to OpenAI function-calling format', () => {
    const result = toolToOpenAI(updateSchemaTool);
    expect(result.type).toBe('function');
    expect(result.function.name).toBe('update_schema');
    expect(result.function.description).toBe(updateSchemaTool.description);
    expect(result.function.parameters).toBe(updateSchemaTool.input_schema);
  });

  it('produces a valid OpenAI tools array entry', () => {
    const result = toolToOpenAI(updateSchemaTool);
    // The shape Ollama and other OpenAI-compat endpoints expect
    expect(result).toHaveProperty('type', 'function');
    expect(result.function).toHaveProperty('name');
    expect(result.function).toHaveProperty('description');
    expect(result.function).toHaveProperty('parameters');
    expect(result.function.parameters).toHaveProperty('type', 'object');
    expect(result.function.parameters).toHaveProperty('required');
  });
});

// ---------------------------------------------------------------------------
// parseOpenAISSE — standard tool calls (structured delta.tool_calls)
// ---------------------------------------------------------------------------

describe('parseOpenAISSE', () => {
  it('parses a text-only response', async () => {
    const reader = sseReader([
      openaiDelta({ role: 'assistant', content: '' }),
      openaiDelta({ content: 'Hello ' }),
      openaiDelta({ content: 'world!' }),
      openaiFinish('stop'),
      'data: [DONE]',
    ]);
    const onText = vi.fn();
    const result = await parseOpenAISSE(reader, onText);
    expect(result.textContent).toBe('Hello world!');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe('end_turn');
    expect(onText).toHaveBeenCalled();
  });

  it('parses structured tool calls from delta.tool_calls', async () => {
    const reader = sseReader([
      openaiDelta({ role: 'assistant', content: '' }),
      openaiDelta({ content: 'Let me update that.' }),
      // Tool call start
      openaiDelta({
        tool_calls: [
          { index: 0, id: 'call_abc', type: 'function', function: { name: 'update_schema', arguments: '' } },
        ],
      }),
      // Incremental arguments
      openaiDelta({ tool_calls: [{ index: 0, function: { arguments: '{"patches' } }] }),
      openaiDelta({ tool_calls: [{ index: 0, function: { arguments: '": [{"targetId": "root"}]}' } }] }),
      openaiFinish('tool_calls'),
      'data: [DONE]',
    ]);

    const onText = vi.fn();
    const onToolStart = vi.fn();
    const result = await parseOpenAISSE(reader, onText, onToolStart);

    expect(result.textContent).toBe('Let me update that.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      id: 'call_abc',
      name: 'update_schema',
      input: { patches: [{ targetId: 'root' }] },
    });
    expect(result.stopReason).toBe('tool_use');
    expect(onToolStart).toHaveBeenCalledOnce();
  });

  it('handles multiple tool calls in a single response', async () => {
    const reader = sseReader([
      openaiDelta({
        tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'update_schema', arguments: '' } }],
      }),
      openaiDelta({ tool_calls: [{ index: 0, function: { arguments: '{"patches": []}' } }] }),
      openaiDelta({
        tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'update_schema', arguments: '' } }],
      }),
      openaiDelta({ tool_calls: [{ index: 1, function: { arguments: '{"patches": [{"targetId":"x"}]}' } }] }),
      openaiFinish('tool_calls'),
      'data: [DONE]',
    ]);

    const result = await parseOpenAISSE(reader, vi.fn());
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].id).toBe('c1');
    expect(result.toolCalls[1].id).toBe('c2');
    expect(result.toolCalls[1].input).toEqual({ patches: [{ targetId: 'x' }] });
  });

  it('normalises stop → end_turn and tool_calls → tool_use', async () => {
    const stopReader = sseReader([openaiDelta({ content: 'hi' }), openaiFinish('stop'), 'data: [DONE]']);
    const stopResult = await parseOpenAISSE(stopReader, vi.fn());
    expect(stopResult.stopReason).toBe('end_turn');

    const tcReader = sseReader([
      openaiDelta({
        tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'update_schema', arguments: '{}' } }],
      }),
      openaiFinish('tool_calls'),
      'data: [DONE]',
    ]);
    const tcResult = await parseOpenAISSE(tcReader, vi.fn());
    expect(tcResult.stopReason).toBe('tool_use');
  });

  it('throws on empty response (no content, no tool calls, no stop reason)', async () => {
    const reader = sseReader(['data: [DONE]']);
    await expect(parseOpenAISSE(reader, vi.fn())).rejects.toThrow('Empty response');
  });

  it('skips malformed SSE events', async () => {
    const reader = sseReader([
      'data: not-json',
      openaiDelta({ content: 'works' }),
      openaiFinish('stop'),
      'data: [DONE]',
    ]);
    const result = await parseOpenAISSE(reader, vi.fn());
    expect(result.textContent).toBe('works');
  });

  // -----------------------------------------------------------------------
  // Qwen3 / Ollama: thinking tags + inline tool calls
  // -----------------------------------------------------------------------

  it('strips <think> blocks from text content', async () => {
    const reader = sseReader([
      openaiDelta({ content: '<think>\nLet me analyze this request.\n</think>\n' }),
      openaiDelta({ content: "I've updated the template." }),
      openaiFinish('stop'),
      'data: [DONE]',
    ]);
    const result = await parseOpenAISSE(reader, vi.fn());
    expect(result.textContent).toBe("I've updated the template.");
    expect(result.textContent).not.toContain('<think>');
  });

  it('extracts tool calls from <tool_call> tags in text (Ollama/Qwen3 fallback)', async () => {
    // Simulates Qwen3 outputting tool calls as text rather than structured delta.tool_calls
    const toolCallJson = JSON.stringify({
      name: 'update_schema',
      arguments: { patches: [{ targetId: 'root', node: { type: 'Row' } }] },
    });
    const reader = sseReader([
      openaiDelta({ content: `<think>\nI need to change this to a Row.\n</think>\n` }),
      openaiDelta({ content: `<tool_call>\n${toolCallJson}\n</tool_call>` }),
      openaiFinish('stop'),
      'data: [DONE]',
    ]);

    const onToolStart = vi.fn();
    const result = await parseOpenAISSE(reader, vi.fn(), onToolStart);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input).toEqual({
      patches: [{ targetId: 'root', node: { type: 'Row' } }],
    });
    expect(result.stopReason).toBe('tool_use');
    expect(result.textContent).not.toContain('<think>');
    expect(result.textContent).not.toContain('<tool_call>');
    expect(onToolStart).toHaveBeenCalledOnce();
  });

  it('prefers structured tool calls over text-embedded ones', async () => {
    // When the provider properly returns structured tool calls, the text fallback
    // should not fire — even if the text also contains <tool_call> tags.
    const reader = sseReader([
      openaiDelta({ content: 'Text with <tool_call>{"name":"x","arguments":{}}</tool_call>' }),
      openaiDelta({
        tool_calls: [
          {
            index: 0,
            id: 'real-call',
            type: 'function',
            function: { name: 'update_schema', arguments: '{"patches": []}' },
          },
        ],
      }),
      openaiFinish('tool_calls'),
      'data: [DONE]',
    ]);

    const result = await parseOpenAISSE(reader, vi.fn());
    // Structured call wins; text-embedded tool_call tag stays in textContent
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('real-call');
    expect(result.toolCalls[0].name).toBe('update_schema');
  });

  it('handles combined <think> + <tool_call> with no other text', async () => {
    const toolCallJson = JSON.stringify({
      name: 'update_schema',
      arguments: { patches: [{ targetId: '', node: { type: 'Column' } }] },
    });
    const reader = sseReader([
      openaiDelta({
        content: `<think>Reasoning about the schema</think><tool_call>${toolCallJson}</tool_call>`,
      }),
      openaiFinish('stop'),
      'data: [DONE]',
    ]);

    const result = await parseOpenAISSE(reader, vi.fn());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].input.patches).toEqual([{ targetId: '', node: { type: 'Column' } }]);
    expect(result.textContent).toBe('');
    expect(result.stopReason).toBe('tool_use');
  });

  it('handles Ollama non-incremental tool call (complete in one chunk)', async () => {
    // Ollama sometimes sends the entire tool call in a single delta
    const reader = sseReader([
      openaiDelta({
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: {
              name: 'update_schema',
              arguments: '{"patches": [{"targetId": "root", "node": {"props": {"bg": "primary"}}}]}',
            },
          },
        ],
      }),
      openaiFinish('tool_calls'),
      'data: [DONE]',
    ]);

    const result = await parseOpenAISSE(reader, vi.fn());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].input.patches[0].node.props.bg).toBe('primary');
  });

  it('fires onTextDelta with accumulated text (not including final stripped tags)', async () => {
    // During streaming, the raw text (with think tags) goes to the callback.
    // Only the final result has them stripped.
    const deltas: string[] = [];
    const reader = sseReader([
      openaiDelta({ content: '<think>hmm</think>' }),
      openaiDelta({ content: 'Response text' }),
      openaiFinish('stop'),
      'data: [DONE]',
    ]);

    await parseOpenAISSE(reader, (text) => deltas.push(text));

    // During streaming, the callback received the raw text including <think>
    expect(deltas.some((d) => d.includes('<think>'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseAnthropicSSE — baseline sanity (not the focus, but guards regression)
// ---------------------------------------------------------------------------

describe('parseAnthropicSSE', () => {
  it('parses text content from Anthropic SSE events', async () => {
    const reader = sseReader([
      'data: {"type":"content_block_start","content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","delta":{"text":"Hello "}}',
      'data: {"type":"content_block_delta","delta":{"text":"world"}}',
      'data: {"type":"content_block_stop"}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    ]);

    const result = await parseAnthropicSSE(reader, vi.fn());
    expect(result.textContent).toBe('Hello world');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('parses tool_use blocks from Anthropic SSE events', async () => {
    const reader = sseReader([
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tu_1","name":"update_schema"}}',
      'data: {"type":"content_block_delta","delta":{"partial_json":"{\\"patches\\":[{\\"target"}}',
      'data: {"type":"content_block_delta","delta":{"partial_json":"Id\\":\\"root\\"}]}"}}',
      'data: {"type":"content_block_stop"}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
    ]);

    const onToolStart = vi.fn();
    const result = await parseAnthropicSSE(reader, vi.fn(), onToolStart);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('tu_1');
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'root' }] });
    expect(result.stopReason).toBe('tool_use');
    expect(onToolStart).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// updateSchemaTool — shape validation
// ---------------------------------------------------------------------------

describe('updateSchemaTool', () => {
  it('defines the update_schema tool with required patches array', () => {
    expect(updateSchemaTool.name).toBe('update_schema');
    expect(updateSchemaTool.input_schema.type).toBe('object');
    expect(updateSchemaTool.input_schema.required).toContain('patches');
    expect(updateSchemaTool.input_schema.properties.patches.type).toBe('array');
  });

  it('defines patch items with targetId as required', () => {
    const itemSchema = updateSchemaTool.input_schema.properties.patches.items;
    expect(itemSchema.required).toContain('targetId');
    expect(itemSchema.properties.targetId.type).toBe('string');
  });

  it('defines mutually exclusive patch operations (node, insert, remove)', () => {
    const props = updateSchemaTool.input_schema.properties.patches.items.properties;
    expect(props).toHaveProperty('node');
    expect(props).toHaveProperty('insert');
    expect(props).toHaveProperty('remove');
  });
});

// ---------------------------------------------------------------------------
// parseOpenAIComplete — non-streaming response parser (local providers)
// ---------------------------------------------------------------------------

/** Build a mock Response from a JSON body. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseOpenAIComplete', () => {
  it('parses a text-only response', async () => {
    const resp = jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
    });
    const onText = vi.fn();
    const result = await parseOpenAIComplete(resp, onText);
    expect(result.textContent).toBe('Hello!');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe('end_turn');
    expect(onText).toHaveBeenCalledWith('Hello!');
  });

  it('parses structured tool_calls from the response', async () => {
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'update_schema',
                  arguments: '{"patches": [{"targetId": "root", "node": {"type": "Column"}}]}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const onToolStart = vi.fn();
    const result = await parseOpenAIComplete(resp, vi.fn(), onToolStart);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'root', node: { type: 'Column' } }] });
    expect(result.stopReason).toBe('tool_use');
    expect(onToolStart).toHaveBeenCalledOnce();
  });

  it('strips <think> blocks from text content', async () => {
    const resp = jsonResponse({
      choices: [
        {
          message: { role: 'assistant', content: '<think>reasoning</think>The answer.' },
          finish_reason: 'stop',
        },
      ],
    });
    const result = await parseOpenAIComplete(resp, vi.fn());
    expect(result.textContent).toBe('The answer.');
    expect(result.textContent).not.toContain('<think>');
  });

  it('extracts tool calls from text when no structured tool_calls field exists', async () => {
    // Simulates Qwen3/Ollama outputting tool calls as raw text
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              '<think>Let me update this</think>\n{"name": "update_schema", "arguments": {"patches": [{"targetId": "root", "node": {"type": "Row"}}]}}',
          },
          finish_reason: 'stop',
        },
      ],
    });
    const onToolStart = vi.fn();
    const result = await parseOpenAIComplete(resp, vi.fn(), onToolStart);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input.patches).toEqual([{ targetId: 'root', node: { type: 'Row' } }]);
    expect(result.stopReason).toBe('tool_use');
    expect(result.textContent).not.toContain('<think>');
    expect(onToolStart).toHaveBeenCalledOnce();
  });

  it('extracts direct {"patches": [...]} from text (no name wrapper)', async () => {
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Here is the update:\n{"patches": [{"targetId": "", "node": {"type": "Column"}}]}',
          },
          finish_reason: 'stop',
        },
      ],
    });
    const result = await parseOpenAIComplete(resp, vi.fn());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
    expect(result.toolCalls[0].input.patches).toEqual([{ targetId: '', node: { type: 'Column' } }]);
  });

  it('extracts tool calls from a markdown code block in text', async () => {
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              'I\'ll update the schema:\n\n```json\n{"name": "update_schema", "arguments": {"patches": [{"targetId": "root"}]}}\n```',
          },
          finish_reason: 'stop',
        },
      ],
    });
    const result = await parseOpenAIComplete(resp, vi.fn());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('update_schema');
  });

  it('prefers structured tool_calls over text-embedded ones', async () => {
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '{"patches": [{"targetId": "wrong"}]}',
            tool_calls: [
              {
                id: 'real',
                type: 'function',
                function: { name: 'update_schema', arguments: '{"patches": [{"targetId": "right"}]}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const result = await parseOpenAIComplete(resp, vi.fn());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('real');
    expect(result.toolCalls[0].input.patches[0].targetId).toBe('right');
  });

  it('handles text + structured tool calls together', async () => {
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Updated the layout for you.',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'update_schema', arguments: '{"patches": []}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const onText = vi.fn();
    const result = await parseOpenAIComplete(resp, onText);
    expect(result.textContent).toBe('Updated the layout for you.');
    expect(result.toolCalls).toHaveLength(1);
    expect(onText).toHaveBeenCalledWith('Updated the layout for you.');
  });

  it('throws on empty choices array', async () => {
    const resp = jsonResponse({ choices: [] });
    await expect(parseOpenAIComplete(resp, vi.fn())).rejects.toThrow('Empty response');
  });

  it('handles tool call arguments as an object (not string-encoded)', async () => {
    // Some providers return arguments already parsed
    const resp = jsonResponse({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'update_schema', arguments: { patches: [{ targetId: 'root' }] } },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const result = await parseOpenAIComplete(resp, vi.fn());
    expect(result.toolCalls[0].input).toEqual({ patches: [{ targetId: 'root' }] });
  });

  it('maps finish_reason "length" to stopReason "max_tokens"', async () => {
    const resp = jsonResponse({
      choices: [{ message: { role: 'assistant', content: 'Cut off...' }, finish_reason: 'length' }],
    });
    const result = await parseOpenAIComplete(resp, vi.fn());
    expect(result.stopReason).toBe('max_tokens');
  });
});
