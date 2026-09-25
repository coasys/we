/**
 * A conversation, as the executor's `/v1/chat/completions` reads and answers it.
 *
 * The executor speaks the OpenAI chat shape on that surface whatever model sits behind it, and
 * translates to the provider's own format itself — native tool calls for a model whose provider
 * carries them, tools rendered into the prompt for one whose does not. So this is the only wire
 * format WE has to know, and it knows it here rather than in the shell.
 *
 * Pure functions, no fetch: the request body and the stream reader are the parts with rules worth
 * testing, and neither needs a server to test.
 */
import type { ConversationReply, ConversationTool, ConversationToolCall, ConversationTurn } from '@we/backend-shared';

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/**
 * The turns as OpenAI messages, system prompt first.
 *
 * One message per turn, results included. The executor pairs each `role: "tool"` message with the
 * call it names; merging several results into one message, or dropping all but one, leaves calls
 * unanswered — which a provider with native tool calling refuses outright.
 */
export function toOpenAiMessages(system: string, turns: ConversationTurn[]): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const turn of turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.text });
    } else if (turn.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: turn.callId, content: turn.result });
    } else if (turn.calls?.length) {
      messages.push({
        role: 'assistant',
        content: turn.text || null,
        tool_calls: turn.calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
    } else {
      messages.push({ role: 'assistant', content: turn.text });
    }
  }
  return messages;
}

export function toOpenAiTools(tools: ConversationTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/**
 * Read an SSE stream of chat-completion chunks to the end of the turn.
 *
 * Tool calls arrive keyed by `index`, the id and name on the first fragment and the arguments
 * possibly spread over several; they are assembled when the stream ends. A call whose arguments do
 * not parse is kept, with an empty object, rather than dropped: the caller answers every call it
 * was given, and a dropped call would leave its result pointing at nothing.
 */
export async function readChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText?: (textSoFar: string) => void,
): Promise<ConversationReply> {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  const building = new Map<number, { id: string; name: string; args: string }>();

  const readLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;

    let chunk: {
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string | null;
      }[];
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      // One unreadable event costs one delta; aborting would cost the whole reply.
      return;
    }

    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.delta?.content) {
      text += choice.delta.content;
      onText?.(text);
    }
    for (const fragment of choice.delta?.tool_calls ?? []) {
      const index = fragment.index ?? 0;
      const call = building.get(index) ?? { id: '', name: '', args: '' };
      if (fragment.id) call.id = fragment.id;
      if (fragment.function?.name) call.name = fragment.function.name;
      if (fragment.function?.arguments) call.args += fragment.function.arguments;
      building.set(index, call);
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(readLine);
  }
  buffer += decoder.decode();
  if (buffer) readLine(buffer);

  const calls: ConversationToolCall[] = [...building.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: parseArguments(call.args),
    }));

  return {
    text,
    calls,
    finish: finishReason === 'length' ? 'truncated' : calls.length > 0 ? 'tool_calls' : 'done',
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
