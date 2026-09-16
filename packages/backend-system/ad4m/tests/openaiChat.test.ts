/**
 * A conversation on the executor's `/v1/chat/completions`.
 *
 * Two rules worth pinning. Every tool result travels as its own message naming its call — merging or
 * dropping one leaves a call unanswered, which a provider with native tool calling refuses. And the
 * stream reader keeps a call whose arguments it cannot parse, because the caller answers every call
 * it is handed and a dropped one leaves its answer pointing at nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAd4mLanguageModelPort } from '../src/languageModelPort';
import { readChatStream, toOpenAiMessages, toOpenAiTools } from '../src/openaiChat';

function readerFrom(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }).getReader();
}

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe('the request', () => {
  it('sends each tool result as its own message, after the call that asked for it', () => {
    const messages = toOpenAiMessages('be terse', [
      { role: 'user', text: 'add two things' },
      {
        role: 'assistant',
        text: '',
        calls: [
          { id: 'call_a', name: 'update_schema', arguments: { patches: [1] } },
          { id: 'call_b', name: 'update_schema', arguments: { patches: [2] } },
        ],
      },
      { role: 'tool', callId: 'call_a', result: 'applied' },
      { role: 'tool', callId: 'call_b', result: 'failed' },
    ]);

    expect(messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'add two things' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_a', type: 'function', function: { name: 'update_schema', arguments: '{"patches":[1]}' } },
          { id: 'call_b', type: 'function', function: { name: 'update_schema', arguments: '{"patches":[2]}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_a', content: 'applied' },
      { role: 'tool', tool_call_id: 'call_b', content: 'failed' },
    ]);
  });

  it('keeps text an assistant wrote beside its calls', () => {
    const [, assistant] = toOpenAiMessages('s', [
      { role: 'assistant', text: 'Adding it.', calls: [{ id: 'c', name: 't', arguments: {} }] },
    ]);
    expect(assistant).toMatchObject({ role: 'assistant', content: 'Adding it.' });
  });

  it('describes tools in the function shape', () => {
    expect(toOpenAiTools([{ name: 'update_schema', description: 'Patch it', parameters: { type: 'object' } }])).toEqual(
      [
        {
          type: 'function',
          function: { name: 'update_schema', description: 'Patch it', parameters: { type: 'object' } },
        },
      ],
    );
  });
});

describe('reading the stream', () => {
  it('reports text as it accumulates and ends a text-only turn as done', async () => {
    const seen: string[] = [];
    const reply = await readChatStream(
      readerFrom([
        sse({ choices: [{ delta: { role: 'assistant' } }] }),
        sse({ choices: [{ delta: { content: 'Hel' } }] }),
        sse({ choices: [{ delta: { content: 'lo' } }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ]),
      (text) => seen.push(text),
    );

    expect(seen).toEqual(['Hel', 'Hello']);
    expect(reply).toEqual({ text: 'Hello', calls: [], finish: 'done' });
  });

  it('assembles calls whose arguments arrive in pieces, in index order', async () => {
    const reply = await readChatStream(
      readerFrom([
        sse({
          choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{}' } }] } }],
        }),
        sse({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'first', arguments: '{"x"' } }] } }],
        }),
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] }),
        sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ]),
    );

    expect(reply.finish).toBe('tool_calls');
    expect(reply.calls).toEqual([
      { id: 'a', name: 'first', arguments: { x: 1 } },
      { id: 'b', name: 'second', arguments: {} },
    ]);
  });

  it('keeps a call whose arguments do not parse', async () => {
    const reply = await readChatStream(
      readerFrom([
        sse({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 't', arguments: '{nope' } }] } }],
        }),
      ]),
    );
    expect(reply.calls).toEqual([{ id: 'a', name: 't', arguments: {} }]);
  });

  it('survives an event split across two reads, and a malformed one', async () => {
    const whole = sse({ choices: [{ delta: { content: 'split' } }] });
    const reply = await readChatStream(
      readerFrom([
        whole.slice(0, 20),
        whole.slice(20),
        'data: {broken\n\n',
        sse({ choices: [{ finish_reason: 'stop' }] }),
      ]),
    );
    expect(reply.text).toBe('split');
  });

  it('reads a cut-off reply as truncated, not as finished', async () => {
    const reply = await readChatStream(
      readerFrom([
        sse({ choices: [{ delta: { content: 'most of' } }] }),
        sse({ choices: [{ finish_reason: 'length' }] }),
      ]),
    );
    expect(reply.finish).toBe('truncated');
  });
});

describe('the port', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers no conversation where the connector gave no way to reach the node', () => {
    expect(createAd4mLanguageModelPort({}).converse).toBeUndefined();
  });

  it('posts to the node with its token and the default model', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const port = createAd4mLanguageModelPort({}, () => ({ url: 'http://localhost:12000/', token: 'tkn' }));
    const reply = await port.converse!({ system: 's', turns: [{ role: 'user', text: 'hi' }] });

    expect(reply.text).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:12000/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tkn');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'default', stream: true });
    expect(JSON.parse(init.body as string).tools).toBeUndefined();
  });

  it('reports the node’s own reason when it refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'No default LLM model configured on this executor' } }), {
            status: 404,
          }),
      ),
    );

    const port = createAd4mLanguageModelPort({}, () => ({ url: 'http://node', token: '' }));
    await expect(port.converse!({ system: 's', turns: [] })).rejects.toThrow('No default LLM model configured');
  });
});
