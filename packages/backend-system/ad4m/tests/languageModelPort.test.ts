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
  const claude = {
    id: 'm1',
    name: 'Claude Sonnet 5',
    modelType: 'LLM',
    endpointId: 'e1',
    remoteModel: 'claude-sonnet-5',
    status: { state: 'UNKNOWN' },
  };

  function statusClient(ai: Record<string, unknown>) {
    return createAd4mLanguageModelPort({ ai });
  }

  /** A default model whose endpoint last reported `status`. */
  function withStatus(status: Record<string, unknown>) {
    return statusClient({ getDefaultModel: vi.fn(async () => claude), modelStatus: vi.fn(async () => status) });
  }

  it('is none when no default is set', async () => {
    await expect(statusClient({ getDefaultModel: vi.fn(async () => null) }).status!()).resolves.toMatchObject({
      state: 'none',
    });
  });

  it('is none when the executor cannot be asked', async () => {
    const port = statusClient({ getDefaultModel: vi.fn(async () => Promise.reject(new Error('No AI service'))) });
    await expect(port.status!()).resolves.toMatchObject({ state: 'none' });
  });

  it('is ready when its endpoint says so', async () => {
    await expect(withStatus({ state: 'READY' }).status!()).resolves.toEqual({
      state: 'ready',
      name: 'Claude Sonnet 5',
      model: 'claude-sonnet-5',
      detail: '',
    });
  });

  it('is unchecked until its endpoint has been checked', async () => {
    await expect(withStatus({ state: 'UNKNOWN' }).status!()).resolves.toMatchObject({ state: 'unchecked' });
  });

  it('is an error when the server does not list the model', async () => {
    await expect(withStatus({ state: 'MISSING' }).status!()).resolves.toMatchObject({
      state: 'error',
      detail: expect.stringContaining('claude-sonnet-5'),
    });
  });

  it('is an error when the server does not answer', async () => {
    await expect(withStatus({ state: 'ENDPOINT_DOWN' }).status!()).resolves.toMatchObject({
      state: 'error',
      detail: expect.stringContaining('not answering'),
    });
  });

  it('reports a pull’s progress', async () => {
    await expect(withStatus({ state: 'PULLING', progress: 41.6 }).status!()).resolves.toMatchObject({
      state: 'loading',
      detail: 'Downloading 42%',
    });
  });

  it('falls back to the status the model came with when the executor refuses the check itself', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => ({ ...claude, status: { state: 'READY' } })),
      modelStatus: vi.fn(async () => Promise.reject(new RpcError(403, 'not permitted'))),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'ready' });
  });

  it('is an error, with the reason, when the check fails', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      modelStatus: vi.fn(async () => Promise.reject(new RpcError(500, 'database locked'))),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'error', detail: expect.stringContaining('locked') });
  });
});
