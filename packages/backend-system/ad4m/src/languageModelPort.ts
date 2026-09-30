import type { Ad4mClient, AIModel } from '@coasys/ad4m';
import type {
  ConversationReply,
  ConversationRequest,
  LanguageModelPort,
  LanguageModelStatus,
} from '@we/backend-shared';

import { readChatStream, toOpenAiMessages, toOpenAiTools } from './openaiChat';

/**
 * The AD4M executor's AI service, as the neutral language-model port.
 *
 * Prompting here goes through a *task* — the executor's unit of "a system prompt registered
 * against a model" — so the port keeps one task, named below, and reuses it. Found by name rather
 * than held in memory because tasks persist on the executor across sessions: creating one per call
 * would accumulate copies, and holding an id in a variable would leak one task per reload.
 *
 * The task binds to the literal model id `"default"`, which the executor resolves to whatever the
 * user's AI settings name as the default LLM — so changing models in settings changes what answers
 * this, with no re-registration.
 */
const TASK_NAME = 'we://model-authoring';

/**
 * Long enough for a turn that writes a whole template, which on a slow model is minutes rather than
 * seconds; short enough that a stalled connection is eventually reported rather than spinning.
 */
const CONVERSE_TIMEOUT_MS = 180_000;

/** Where the executor's HTTP surface is, and the token this session holds for it. */
export interface Ad4mHttpConnection {
  /** The executor's HTTP base, e.g. `http://localhost:12000`. */
  url: string;
  token: string;
}

export function createAd4mLanguageModelPort(
  backendClient: unknown,
  /**
   * A getter rather than a value: a web session's token is replaced when it is refreshed, and the
   * port outlives that. Absent where the connector cannot say, which leaves `converse` off.
   */
  connection?: () => Ad4mHttpConnection | null,
): LanguageModelPort {
  const client = backendClient as Ad4mClient;

  const port: LanguageModelPort = {
    async available() {
      try {
        const models = await client.ai.getModels();
        return models.some((m) => m.modelType === 'LLM');
      } catch {
        // An executor without the AI service is a node without a model, not an error.
        return false;
      }
    },

    async prompt(system, input) {
      const tasks = await client.ai.tasks();
      let task = tasks.find((t) => t.name === TASK_NAME);
      if (!task) {
        task = await client.ai.addTask(TASK_NAME, 'default', system, []);
      } else if (task.systemPrompt !== system) {
        /*
          The system prompt evolves with the app; the stored task follows it — by replacement, not
          `updateTask`.

          `updateTask` cannot succeed over the executor's WebSocket RPC: the client sends the task
          without its `taskId`, `createdAt` or `updatedAt`, and the handler deserialises a whole
          `AITask`, so every call is refused with "missing field `taskId`". It went unnoticed because
          it only runs when the prompt changes — the first release to change the model-authoring
          schema made generation fail for everyone who had generated before. Remove and add are both
          sound, and the task holds nothing but what this function writes into it.
        */
        await client.ai.removeTask(task.taskId);
        task = await client.ai.addTask(TASK_NAME, 'default', system, []);
      }
      return client.ai.prompt(task.taskId, input);
    },

    status: () => defaultModelStatus(client),
  };

  if (connection) port.converse = (request) => converse(connection, request);
  return port;
}

/**
 * The default LLM, and whether it can answer — without prompting it.
 *
 * A local model reports its own download and load progress. A remote one is checked by asking its
 * endpoint which models it serves, through the node, which costs no tokens and fails the ways a
 * completion would: a refused key, an unreachable host, a model id the service does not offer.
 * Where the client predates model discovery a remote model is `unchecked` rather than assumed fine.
 */
async function defaultModelStatus(client: Ad4mClient): Promise<LanguageModelStatus> {
  let model: AIModel | undefined;
  try {
    model = await client.ai.getDefaultModel('LLM');
  } catch {
    // No default set reads as an error from the executor; to a status line it is simply none.
  }
  if (!model) return { state: 'none', name: '', model: '', detail: '' };

  const name = model.name;
  if (!model.api) {
    const build = model.local?.fileName ?? '';
    try {
      const loading = await client.ai.modelLoadingStatus(model.id);
      if (loading.loaded) return { state: 'ready', name, model: build, detail: '' };
      const detail = loading.downloaded
        ? loading.status || 'Loading'
        : `Downloading ${Math.round(loading.progress ?? 0)}%`;
      return { state: 'loading', name, model: build, detail };
    } catch (err) {
      return { state: 'error', name, model: build, detail: messageOf(err) };
    }
  }

  const { baseUrl, apiKey, model: id, apiType } = model.api;
  const ai = client.ai as unknown as {
    discoverModels?: (baseUrl: string, apiKey?: string, apiType?: string) => Promise<string[]>;
  };
  if (typeof ai.discoverModels !== 'function') return { state: 'unchecked', name, model: id, detail: '' };

  try {
    const offered = await ai.discoverModels(baseUrl, apiKey || undefined, String(apiType));
    // A listing names dated versions (`claude-x-20250929`) that an alias (`claude-x`) resolves to.
    const listed = offered.some((candidate) => candidate === id || candidate.startsWith(`${id}-`));
    if (offered.length && !listed) {
      return { state: 'error', name, model: id, detail: `The service does not list a model called ${id}` };
    }
    return { state: 'ready', name, model: id, detail: '' };
  } catch (err) {
    // Discovery needs the AI CREATE grant. A guest without it has asked a question it may not ask,
    // which says nothing about the model — so that is unchecked, not broken.
    if (/capabilit|forbidden|unauthori/i.test(messageOf(err)))
      return { state: 'unchecked', name, model: id, detail: '' };
    return { state: 'error', name, model: id, detail: messageOf(err) };
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A conversation turn through the executor's OpenAI-compatible surface.
 *
 * Not through a task, because a task is one system prompt and one input: a tool-calling
 * conversation is a list of turns the caller keeps, which is exactly what `/v1/chat/completions`
 * takes. `"default"` resolves to the default LLM, as it does for the task above.
 *
 * Tools go to the executor as data. Whether they reach the model that way is the executor's call —
 * natively for a provider that carries them, rendered into the prompt for one that does not — and
 * nothing here depends on which.
 */
async function converse(
  connection: () => Ad4mHttpConnection | null,
  request: ConversationRequest,
): Promise<ConversationReply> {
  const target = connection();
  if (!target) throw new Error('Not connected to a node');

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, CONVERSE_TIMEOUT_MS);

  try {
    const response = await fetch(`${target.url.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}),
      },
      body: JSON.stringify({
        model: 'default',
        stream: true,
        messages: toOpenAiMessages(request.system, request.turns),
        ...(request.tools?.length ? { tools: toOpenAiTools(request.tools) } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(await failureMessage(response));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The node answered with no body');
    return await readChatStream(reader, request.onText);
  } catch (err) {
    if (controller.signal.aborted && !request.signal?.aborted) {
      throw new Error(`The model did not answer within ${CONVERSE_TIMEOUT_MS / 60_000} minutes`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', abort);
  }
}

/**
 * The executor wraps every failure in OpenAI's `{ error: { message } }` envelope, and the message is
 * the part a person can act on — "No default LLM model configured", a provider refusing the key.
 */
async function failureMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const message = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    if (message) return message;
  } catch {
    // Not the envelope — fall through to the raw body.
  }
  return `The node refused the request (${response.status})${body ? `: ${body}` : ''}`;
}
