/**
 * The AI settings forms' two directions, and the strings their lists show.
 *
 * `endpointFormFrom` / `toEndpointDraft` and `modelFormFrom` / `toModelDraft` are inverses, and the
 * value of writing them next to each other is only realised if something checks that they actually
 * are — above all for what an edit must not change: a stored key, a setting the form does not show.
 */
import type { AiEndpoint, AiModel } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  AI_SERVICES,
  apiKeyProblem,
  describeDetected,
  describeEndpoint,
  describeModel,
  EMPTY_ENDPOINT_FORM,
  endpointFormComplete,
  endpointFormFrom,
  endpointName,
  modelFormComplete,
  modelFormFrom,
  serves,
  toEndpointDraft,
  toModelDraft,
  withService,
} from '../src/frameworks/solid/stores/aiModelDraft';

function endpoint(overrides: Partial<AiEndpoint> = {}): AiEndpoint {
  return {
    id: 'e1',
    name: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    hasApiKey: false,
    capabilities: ['chat'],
    health: { state: 'reachable', detail: '', models: [] },
    ...overrides,
  };
}

function model(overrides: Partial<AiModel> = {}): AiModel {
  return {
    id: 'm1',
    name: 'Qwen',
    kind: 'llm',
    endpointId: 'e1',
    remoteModel: 'qwen3:8b',
    status: { state: 'ready' },
    isDefault: false,
    ...overrides,
  };
}

describe('the endpoint form', () => {
  it('writes back what it read, keeping a key it never saw and settings it does not show', () => {
    const saved = endpoint({
      kind: 'anthropic',
      baseUrl: 'https://api.example.test',
      hasApiKey: true,
      maxContext: 40960,
      requestTimeoutSecs: 600,
      maxConcurrent: 2,
    });
    const form = endpointFormFrom(saved);

    expect(form.service).toBe('anthropic');
    expect(toEndpointDraft(form, form.name)).toEqual({
      name: 'Ollama',
      kind: 'anthropic',
      baseUrl: 'https://api.example.test',
      maxContext: 40960,
      requestTimeoutSecs: 600,
      maxConcurrent: 2,
    });
  });

  it('sends a typed key, and `""` only when the stored one is to be removed', () => {
    const form = endpointFormFrom(endpoint({ hasApiKey: true }));
    expect(toEndpointDraft({ ...form, apiKey: ' sk-test ' }, 'x').apiKey).toBe('sk-test');
    expect(toEndpointDraft({ ...form, apiKeyRemoved: true }, 'x').apiKey).toBe('');
    expect(toEndpointDraft(form, 'x')).not.toHaveProperty('apiKey');
  });

  it('refuses to move a stored key to a new address', () => {
    const form = endpointFormFrom(endpoint({ hasApiKey: true, baseUrl: 'https://api.example.test' }));
    const moved = { ...form, baseUrl: 'https://other.example.test' };
    expect(apiKeyProblem(moved)).not.toBe('');
    expect(endpointFormComplete(moved)).toBe(false);
    expect(apiKeyProblem({ ...moved, apiKey: 'sk-test' })).toBe('');
    expect(apiKeyProblem({ ...moved, apiKeyRemoved: true })).toBe('');
    // The same address, written differently, is not a move.
    expect(apiKeyProblem({ ...form, baseUrl: 'https://api.example.test/' })).toBe('');
  });

  it('sets the kind and a starting address from a service, and keeps the address for a custom one', () => {
    const llama = withService(EMPTY_ENDPOINT_FORM, 'llama-server');
    expect(llama).toMatchObject({ service: 'llama-server', kind: 'llama-server', baseUrl: 'http://127.0.0.1:9931' });
    expect(withService(llama, 'custom')).toMatchObject({
      service: 'custom',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9931',
    });
  });

  it('reads an endpoint on a port no preset names as its service, not as custom', () => {
    expect(endpointFormFrom(endpoint({ baseUrl: 'http://127.0.0.1:11500' })).service).toBe('ollama');
    expect(endpointFormFrom(endpoint({ kind: 'openai-compatible', baseUrl: 'https://gw.example.test' })).service).toBe(
      'custom',
    );
    expect(endpointFormFrom(endpoint({ kind: 'openai-compatible', baseUrl: AI_SERVICES[6].baseUrl })).service).toBe(
      AI_SERVICES[6].id,
    );
  });

  it('names an unnamed endpoint after its kind and port, around names taken', () => {
    const form = { name: '', kind: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434' };
    expect(endpointName(form, [])).toBe('Ollama 11434');
    expect(endpointName(form, ['Ollama 11434'])).toBe('Ollama 11434 (2)');
    expect(endpointName({ ...form, name: ' Mine ' }, ['Mine'])).toBe('Mine');
  });
});

describe('the model form', () => {
  it('writes back what it read, a tool choice it does not show included', () => {
    const saved = model({ nativeTools: false });
    expect(toModelDraft(modelFormFrom(saved))).toEqual({
      name: 'Qwen',
      kind: 'llm',
      endpointId: 'e1',
      remoteModel: 'qwen3:8b',
      nativeTools: false,
    });
  });

  it('names a model after its id when no name was typed', () => {
    expect(toModelDraft({ ...modelFormFrom(model()), name: '  ' }).name).toBe('qwen3:8b');
  });

  it('needs a server and a model on it', () => {
    const form = modelFormFrom(model());
    expect(modelFormComplete(form)).toBe(true);
    expect(modelFormComplete({ ...form, endpointId: '' })).toBe(false);
    expect(modelFormComplete({ ...form, remoteModel: ' ' })).toBe(false);
  });
});

describe('display strings', () => {
  it('says where a model stands, by its server', () => {
    const text = (status: AiModel['status']) => describeModel(model({ status }), [endpoint()]).statusText;
    expect(text({ state: 'ready' })).toBe('Ready');
    expect(text({ state: 'pulling', progress: 45 })).toBe('Downloading 45%');
    expect(text({ state: 'missing' })).toBe('The server does not have this model');
    expect(text({ state: 'endpoint-down' })).toBe('The server is not answering');
    expect(text({ state: 'unknown' })).toBe('Not checked yet');
    expect(describeModel(model(), [endpoint()])).toMatchObject({ endpointName: 'Ollama', ready: true });
    expect(describeModel(model(), []).endpointName).toBe('');
  });

  it('says how an endpoint answered', () => {
    const health = (h: Partial<AiEndpoint['health']>) =>
      describeEndpoint(endpoint({ health: { state: 'reachable', detail: '', models: [], ...h } }), [model()]);
    expect(health({ models: ['a', 'b'] })).toMatchObject({
      healthText: 'Answering · 2 models',
      healthy: true,
      modelCount: 1,
    });
    expect(health({ state: 'unauthorized' })).toMatchObject({ healthText: 'The key was refused', healthy: false });
    expect(health({ state: 'unreachable', detail: 'connection refused' }).healthText).toBe(
      'Not answering — connection refused',
    );
  });

  it('names a server found on the machine by its kind and where it is', () => {
    expect(
      describeDetected({ kind: 'openai-audio', baseUrl: 'http://[::1]:8000', capabilities: [], models: ['w'] }),
    ).toMatchObject({ label: 'Speech server at localhost:8000', detail: 'Serves 1 model' });
  });

  it('finds a model Ollama lists with its tag', () => {
    expect(serves(['qwen3:8b'], 'qwen3:8b')).toBe(true);
    expect(serves(['nomic-embed-text:latest'], 'nomic-embed-text')).toBe(true);
    expect(serves(['qwen3:4b'], 'qwen3:8b')).toBe(false);
  });
});
