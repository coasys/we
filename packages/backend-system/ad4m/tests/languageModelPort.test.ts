/**
 * The model-authoring task follows the app's system prompt by replacement, never `updateTask` —
 * which the executor's RPC refuses for want of a `taskId` the client does not send.
 */
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
    api: { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant', model: 'claude-sonnet-5', apiType: 'ANTHROPIC' },
  };

  function statusClient(ai: Record<string, unknown>) {
    return createAd4mLanguageModelPort({ ai });
  }

  it('is none when no default is set', async () => {
    const port = statusClient({ getDefaultModel: vi.fn(async () => Promise.reject(new Error('No default'))) });
    await expect(port.status!()).resolves.toMatchObject({ state: 'none' });
  });

  it('is unchecked for a remote model on a client that cannot ask the endpoint', async () => {
    const port = statusClient({ getDefaultModel: vi.fn(async () => claude) });
    await expect(port.status!()).resolves.toEqual({
      state: 'unchecked',
      name: 'Claude Sonnet 5',
      model: 'claude-sonnet-5',
      detail: '',
    });
  });

  it('is ready when the endpoint lists the model, dated versions included', async () => {
    const discoverModels = vi.fn(async () => ['claude-sonnet-5-20260801', 'claude-opus-5']);
    const port = statusClient({ getDefaultModel: vi.fn(async () => claude), discoverModels });

    await expect(port.status!()).resolves.toMatchObject({ state: 'ready' });
    expect(discoverModels).toHaveBeenCalledWith('https://api.anthropic.com', 'sk-ant', 'ANTHROPIC');
  });

  it('is an error, with the endpoint’s reason, when the key is refused', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => claude),
      discoverModels: vi.fn(async () => Promise.reject(new Error('Anthropic API error 401: invalid x-api-key'))),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'error', detail: expect.stringContaining('401') });
  });

  it('is an error when the service does not offer that model', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => ({ ...claude, api: { ...claude.api, model: 'claude-sonet-5' } })),
      discoverModels: vi.fn(async () => ['claude-sonnet-5']),
    });
    await expect(port.status!()).resolves.toMatchObject({ state: 'error' });
  });

  it('reports a local model’s download progress', async () => {
    const port = statusClient({
      getDefaultModel: vi.fn(async () => ({
        id: 'm2',
        name: 'Llama',
        modelType: 'LLM',
        local: { fileName: 'llama_8b' },
      })),
      modelLoadingStatus: vi.fn(async () => ({ downloaded: false, loaded: false, progress: 41.6, status: '' })),
    });
    await expect(port.status!()).resolves.toEqual({
      state: 'loading',
      name: 'Llama',
      model: 'llama_8b',
      detail: 'Downloading 42%',
    });
  });
});
