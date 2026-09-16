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
