/**
 * A first run's AI step: when it is asked, what it offers on each kind of node, and that an answer
 * keeps it from being asked again.
 */
import {
  type AiSetupAbilities,
  aiSetupOptions,
  offersAiStep,
  readAiSetupAnswer,
  recordAiSetupAnswer,
} from '@shared/aiSetupStep';
import { modelsForRoles } from '@solid/stores/aiModelDraft';
import { describe, expect, it } from 'vitest';

/** The node's operator: local AI, the servers and the models are all theirs to set up. */
const operator: AiSetupAbilities = { canConfigureLocalAi: true, canConfigureAi: true, canManageAiEndpoints: true };
/** A managed user on a node somebody else runs: the backend gives them nothing to change. */
const managed: AiSetupAbilities = { canConfigureLocalAi: false, canConfigureAi: false, canManageAiEndpoints: false };

const fresh = { models: 0, localInstalled: false, answered: false };

describe('what the AI step offers', () => {
  it('offers this device, a model server and skip to the node’s operator', () => {
    expect(aiSetupOptions(operator)).toEqual(['local', 'server', 'skip']);
  });

  it('offers a model server and skip where local AI cannot be installed from here', () => {
    expect(aiSetupOptions({ ...operator, canConfigureLocalAi: false })).toEqual(['server', 'skip']);
  });

  it('offers no model server where the models can only be read', () => {
    expect(aiSetupOptions({ ...operator, canConfigureAi: false })).toEqual(['local', 'skip']);
    expect(aiSetupOptions({ ...operator, canManageAiEndpoints: false })).toEqual(['local', 'skip']);
  });

  it('offers only skip to a managed user', () => {
    expect(aiSetupOptions(managed)).toEqual(['skip']);
  });
});

describe('when the AI step is asked', () => {
  it('is asked on a node with no AI, of somebody who can set it up', () => {
    expect(offersAiStep({ ...operator, ...fresh })).toBe(true);
    expect(offersAiStep({ ...operator, canConfigureLocalAi: false, ...fresh })).toBe(true);
  });

  it('is not asked of a managed user, where skip would be all it offered', () => {
    expect(offersAiStep({ ...managed, ...fresh })).toBe(false);
  });

  it('is not asked where the node has a model already', () => {
    expect(offersAiStep({ ...operator, ...fresh, models: 1 })).toBe(false);
  });

  it('is not asked where local AI is installed already', () => {
    expect(offersAiStep({ ...operator, ...fresh, localInstalled: true })).toBe(false);
  });

  it('is not asked again once the account answered it', () => {
    expect(offersAiStep({ ...operator, ...fresh, answered: true })).toBe(false);
  });
});

describe('the account’s answer', () => {
  function memory() {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  }

  it('is kept per node', () => {
    const store = memory();
    expect(readAiSetupAnswer('https://one.test', store)).toBeNull();
    recordAiSetupAnswer('https://one.test', 'skipped', store);
    expect(readAiSetupAnswer('https://one.test', store)).toBe('skipped');
    expect(readAiSetupAnswer('https://two.test', store)).toBeNull();
  });

  it('keeps a set-up answer as well as a skip', () => {
    const store = memory();
    recordAiSetupAnswer('https://one.test', 'set-up', store);
    expect(readAiSetupAnswer('https://one.test', store)).toBe('set-up');
  });

  it('keeps nothing for a node with no address', () => {
    const store = memory();
    recordAiSetupAnswer('', 'skipped', store);
    expect(readAiSetupAnswer('', store)).toBeNull();
  });

  it('reads nothing it did not write', () => {
    const store = memory();
    store.setItem('we.aiSetup.answer:https://one.test', 'something else');
    expect(readAiSetupAnswer('https://one.test', store)).toBeNull();
    expect(readAiSetupAnswer('', store)).toBeNull();
  });
});

describe('the models a server found on the node’s machine takes on', () => {
  const ollama = { id: 'e1', kind: 'ollama' as const, capabilities: ['chat' as const, 'embeddings' as const] };
  const recommended = [
    { kind: 'llm' as const, endpointKind: 'ollama' as const, model: 'qwen3:8b', description: '' },
    { kind: 'embedding' as const, endpointKind: 'ollama' as const, model: 'nomic-embed-text', description: '' },
  ];

  it('takes the recommended model for each role where the server serves it', () => {
    const drafts = modelsForRoles({
      endpoint: ollama,
      served: [
        { id: 'llama3.2:3b', capabilities: ['chat'] },
        { id: 'qwen3:8b', capabilities: ['chat'] },
        { id: 'nomic-embed-text:latest', capabilities: ['embeddings'] },
      ],
      recommended,
      existing: [],
    });
    expect(drafts).toEqual([
      { name: 'qwen3:8b', kind: 'llm', endpointId: 'e1', remoteModel: 'qwen3:8b' },
      { name: 'nomic-embed-text:latest', kind: 'embedding', endpointId: 'e1', remoteModel: 'nomic-embed-text:latest' },
    ]);
  });

  it('takes the first model that fits a role where the recommended one is not served', () => {
    const drafts = modelsForRoles({
      endpoint: ollama,
      served: [{ id: 'llama3.2:3b', capabilities: ['chat'] }],
      recommended,
      existing: [],
    });
    expect(drafts).toEqual([{ name: 'llama3.2:3b', kind: 'llm', endpointId: 'e1', remoteModel: 'llama3.2:3b' }]);
  });

  it('leaves a role alone that the node has a model for', () => {
    const drafts = modelsForRoles({
      endpoint: ollama,
      served: [
        { id: 'qwen3:8b', capabilities: ['chat'] },
        { id: 'nomic-embed-text:latest', capabilities: ['embeddings'] },
      ],
      recommended,
      existing: [{ kind: 'llm' }],
    });
    expect(drafts.map((d) => d.kind)).toEqual(['embedding']);
  });

  it('fills only the roles the server can serve', () => {
    const speech = { id: 'e2', kind: 'openai-audio' as const, capabilities: ['transcription' as const] };
    const drafts = modelsForRoles({
      endpoint: speech,
      served: [
        { id: 'whisper-test', capabilities: ['transcription'] },
        { id: 'chat-test', capabilities: ['chat'] },
      ],
      recommended,
      existing: [],
    });
    expect(drafts).toEqual([
      { name: 'whisper-test', kind: 'transcription', endpointId: 'e2', remoteModel: 'whisper-test' },
    ]);
  });
});
