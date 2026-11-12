/**
 * The model-authoring task follows the app's system prompt by replacement, never `updateTask` —
 * which the executor's RPC refuses for want of a `taskId` the client does not send.
 */
import { RpcError } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mLanguageModelPort } from '../src/languageModelPort';

function fakeClient(tasks: { taskId: string; name: string; systemPrompt: string }[]) {
  const ai = {
    tasks: vi.fn(async () => tasks),
    addTask: vi.fn(async (name: string, _model: string, systemPrompt: string) => ({
      taskId: 'new',
      name,
      systemPrompt,
    })),
    removeTask: vi.fn(async () => undefined),
    updateTask: vi.fn(async () => {
      throw new Error('RPC error 400: missing field `taskId`');
    }),
    prompt: vi.fn(async (taskId: string) => `answer from ${taskId}`),
  };
  return { ai };
}

describe('the AD4M language-model port', () => {
  it('replaces a task whose system prompt has changed, and prompts the new one', async () => {
    const client = fakeClient([{ taskId: 'old', name: 'we://model-authoring', systemPrompt: 'before' }]);
    const port = createAd4mLanguageModelPort(client);

    await expect(port.prompt('after', 'input')).resolves.toBe('answer from new');
    expect(client.ai.removeTask).toHaveBeenCalledWith('old');
    expect(client.ai.addTask).toHaveBeenCalledWith('we://model-authoring', 'default', 'after', []);
    expect(client.ai.updateTask).not.toHaveBeenCalled();
  });

  it('reuses a task whose prompt is unchanged', async () => {
    const client = fakeClient([{ taskId: 'same', name: 'we://model-authoring', systemPrompt: 'prompt' }]);
    await expect(createAd4mLanguageModelPort(client).prompt('prompt', 'input')).resolves.toBe('answer from same');
    expect(client.ai.addTask).not.toHaveBeenCalled();
    expect(client.ai.removeTask).not.toHaveBeenCalled();
  });
});

describe('the default model’s status', () => {
  // A remote model: the endpoint row owns the URL, the key and the protocol; the model names the
  // endpoint and the id it serves under.
  const claude = {
    id: 'm1',
    name: 'Claude Sonnet 5',
    modelType: 'LLM',
    endpointId: 'e1',
    remoteModel: 'claude-sonnet-5',
  };
  const anthropic = {
    id: 'e1',
    name: 'Anthropic',
    kind: 'ANTHROPIC',
    baseUrl: 'https://api.anthropic.com',
    hasApiKey: true,
    managed: false,
    health: { state: 'REACHABLE', servedModels: ['claude-sonnet-5'], checkedAt: 0 },
  };

  function statusClient(ai: Record<string, unknown>) {
    return createAd4mLanguageModelPort({ ai });
  }

  it('is none when no default is set', async () => {
    const port = statusClient({ getDefaultModel: vi.fn(async () => Promise.reject(new Error('No default'))) });
    await expect(port.status!()).resolves.toMatchObject({ state: 'none' });
  });

  it('is unchecked for a model nothing on the client can check', async () => {
    // An old client has neither `endpoints` nor `modelStatus`: every check throws.
    const port = statusClient({ getDefaultModel: vi.fn(async () => claude) });
    await expect(port.status!()).resolves.toEqual({
      state: 'unchecked',
      name: 'Claude Sonnet 5',
      model: 'claude-sonnet-5',
      detail: '',
    });
  });

  it('is ready when the endpoint’s health check lists the model, dated versions included', async () => {
    // A listing names dated versions (`claude-x-20260801`) that an alias (`claude-x`) resolves to.
    const endpoint = {
      ...anthropic,
      health: { state: 'REACHABLE', servedModels: ['claude-sonnet-5-20260801', 'claude-opus-5'], checkedAt: 0 },
    };
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => [endpoint]),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'ready' });
  });

  it('answers a keyed model through the endpoint’s own check — the node probes with the stored key', async () => {
    // The old reason a keyed model read `unchecked` is gone: the health check runs server-side,
    // where the key the client never gets back still reaches.
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => [anthropic]),
    });
    await expect(port.status!()).resolves.toEqual({
      state: 'ready',
      name: 'Claude Sonnet 5',
      model: 'claude-sonnet-5',
      detail: '',
    });
  });

  it('is an error, with the endpoint’s reason, when the endpoint refused its key', async () => {
    const endpoint = {
      ...anthropic,
      health: { state: 'UNAUTHORIZED', servedModels: [], detail: 'invalid x-api-key', checkedAt: 0 },
    };
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => [endpoint]),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'error', detail: 'invalid x-api-key' });
  });

  it('is an error when the endpoint cannot be reached', async () => {
    const endpoint = {
      ...anthropic,
      health: { state: 'UNREACHABLE', servedModels: [], checkedAt: 0 },
    };
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => [endpoint]),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'error', detail: 'The endpoint cannot be reached' });
  });

  it('still answers when the caller may not list endpoints — the model’s own status says it', async () => {
    // `ai.endpoints` is operator-only; `ai.modelStatus` is not. A guest on a healthy model reads
    // ready, not unchecked.
    const refusal = new RpcError(403, 'ai.endpoints acts on the node itself, so a user session may not call it');
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => Promise.reject(refusal)),
      modelStatus: vi.fn(async () => ({ state: 'READY' })),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'ready' });
  });

  it('is an error, not a shrug, when the fallback check reports the endpoint down', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => Promise.reject(new RpcError(403, 'operator only'))),
      modelStatus: vi.fn(async () => ({ state: 'ENDPOINT_DOWN', detail: 'connection refused' })),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'error', detail: 'connection refused' });
  });

  it('is unchecked when the executor refuses both checks', async () => {
    // A user session on a multi-user node may not call either: each refusal words itself
    // differently, but both are a 403, and nothing else can say.
    const refusal = new RpcError(403, 'a user session may not call it');
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => Promise.reject(refusal)),
      modelStatus: vi.fn(async () => Promise.reject(refusal)),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'unchecked' });
  });

  it('is unchecked when the refusal comes from the SDK copy bundled in ad4m-connect', async () => {
    // The app's client throws ad4m-connect's own `RpcError`, a different class from the one
    // `@coasys/ad4m` exports — this stands in for it, with the same shape.
    class BundledRpcError extends Error {
      constructor(
        public status: number,
        body: string,
      ) {
        super(`RPC error ${status}: ${body}`);
      }
    }
    const refusal = new BundledRpcError(403, 'a user session may not call it');
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      endpoints: vi.fn(async () => Promise.reject(refusal)),
      modelStatus: vi.fn(async () => Promise.reject(refusal)),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'unchecked' });
  });

  it('is an error when the service does not offer that model', async () => {
    const endpoint = {
      ...anthropic,
      health: { state: 'REACHABLE', servedModels: ['claude-haiku-4'], checkedAt: 0 },
    };
    const port = statusClient({
      getDefaultModel: vi.fn(async () => ({ ...claude, remoteModel: 'claude-sonet-5' })),
      endpoints: vi.fn(async () => [endpoint]),
    });
    await expect(port.status!()).resolves.toMatchObject({
      state: 'error',
      detail: expect.stringContaining('does not list'),
    });
  });

  it('reports a local model’s download progress', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => ({
        id: 'm2',
        name: 'Llama',
        modelType: 'LLM',
        endpointId: 'e2',
        remoteModel: 'llama_8b',
      })),
      endpoints: vi.fn(async () => [{ ...anthropic, id: 'e2', managed: true }]),
      modelStatus: vi.fn(async () => ({ state: 'PULLING', progress: 41.6 })),
    });
    await expect(port.status!()).resolves.toEqual({
      state: 'loading',
      name: 'Llama',
      model: 'llama_8b',
      detail: 'Downloading 42%',
    });
  });
});
