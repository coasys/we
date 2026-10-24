/**
 * The AI-model form's two directions.
 *
 * `draftFrom` and `toDraft` are inverses, and the value of writing them next to each other is only
 * realised if something checks that they actually are. The launcher's equivalent pair — a
 * `useEffect` that unfolds a model into eleven pieces of state and a cascade of `includes()` checks
 * that folds them back — disagree: a local file's tokenizer is written with empty repo/revision and
 * read back as a custom Hugging Face tokenizer.
 */
import type { AiModel, AiModelSource, AiModelSourceDraft } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  AI_API_PRESETS,
  apiKeyProblem,
  describeModel,
  draftFrom,
  EMPTY_FORM,
  formComplete,
  keepsStoredKey,
  matchingApiPreset,
  toDraft,
} from '../src/frameworks/solid/stores/aiModelDraft';

/**
 * What an untouched form writes back for a source: the same, less `hasApiKey`. A save that sends no
 * key keeps the one the backend holds, so a round trip that touched nothing leaves the key alone.
 */
function asWritten(source: AiModelSource): AiModelSourceDraft {
  if (source.kind !== 'api') return source;
  const { hasApiKey: _held, ...written } = source;
  return written;
}

function model(overrides: Partial<AiModel>): AiModel {
  return {
    id: 'm1',
    name: 'A model',
    kind: 'llm',
    isDefault: false,
    source: { kind: 'preset', name: 'llama_8b' },
    ...overrides,
  };
}

describe('round-tripping a model through the form', () => {
  const cases: AiModel[] = [
    model({ source: { kind: 'preset', name: 'llama_8b' } }),
    model({
      source: {
        kind: 'api',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
        model: 'gpt-4o',
      },
    }),
    // The case that used to come back as OpenAI: the protocol was not on the form at all.
    model({
      source: {
        kind: 'api',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        hasApiKey: true,
        model: 'claude-sonnet-5',
      },
    }),
    // Read as OpenAI and without its ceiling until the protocol and the ceiling were on the form.
    model({
      source: {
        kind: 'api',
        protocol: 'ollama',
        baseUrl: 'http://localhost:11434',
        hasApiKey: false,
        model: 'qwen3:4b',
        maxContext: 40960,
      },
    }),
    model({
      kind: 'transcription',
      source: { kind: 'huggingface', repo: 'openai/whisper', revision: 'v2', fileName: 'model.bin' },
    }),
    model({
      source: {
        kind: 'huggingface',
        repo: 'org/repo',
        revision: 'main',
        fileName: 'model.gguf',
        tokenizer: { repo: 'org/tok', revision: 'main', fileName: 'tokenizer.json' },
      },
    }),
    model({ kind: 'embedding', source: { kind: 'file', fileName: '/models/bert.gguf' } }),
  ];

  for (const original of cases) {
    it(`survives ${original.source.kind}${original.source.kind === 'api' ? ` (${original.source.protocol})` : ''}${original.source.kind === 'huggingface' && original.source.tokenizer ? ' with a tokenizer' : ''}`, () => {
      const round = toDraft(draftFrom(original));

      expect(round.name).toBe(original.name);
      expect(round.kind).toBe(original.kind);
      expect(round.source).toEqual(asWritten(original.source));
    });
  }

  it('drops a tokenizer that was switched off, rather than sending empty strings', () => {
    const form = draftFrom(
      model({
        source: {
          kind: 'file',
          fileName: '/models/x.gguf',
          tokenizer: { repo: '', revision: 'main', fileName: 'tok.json' },
        },
      }),
    );
    expect(form.useTokenizer).toBe(true);

    const source = toDraft({ ...form, useTokenizer: false }).source;
    expect(source).toEqual({ kind: 'file', fileName: '/models/x.gguf', tokenizer: undefined });
  });

  it('carries the id, so a save from an edited form updates instead of adding a duplicate', () => {
    expect(draftFrom(model({ id: 'm7' })).id).toBe('m7');
    expect(EMPTY_FORM.id).toBeUndefined();
  });
});

describe('formComplete', () => {
  it('asks only for the fields the chosen source needs', () => {
    const api = { ...EMPTY_FORM, name: 'GPT', sourceKind: 'api' as const, apiModel: 'gpt-4o' };
    expect(formComplete(api)).toBe(true);
    // The same form as a Hugging Face model is missing the repo and file it would then need.
    expect(formComplete({ ...api, sourceKind: 'huggingface' })).toBe(false);
  });

  it('will not save a nameless model, whitespace included', () => {
    expect(formComplete({ ...EMPTY_FORM, name: '   ', presetName: 'llama_8b' })).toBe(false);
  });

  it('takes an empty context ceiling as none, and refuses one that is not a whole number', () => {
    const api = { ...EMPTY_FORM, name: 'Qwen', sourceKind: 'api' as const, apiModel: 'qwen3:4b' };
    expect(formComplete({ ...api, apiMaxContext: '' })).toBe(true);
    expect(formComplete({ ...api, apiMaxContext: ' 40960 ' })).toBe(true);
    // Saving these would drop the ceiling silently, since an update writes the whole record.
    for (const typed of ['0', '-1', '4096.5', '40k'])
      expect(formComplete({ ...api, apiMaxContext: typed })).toBe(false);
    expect(toDraft({ ...api, apiMaxContext: ' 40960 ' }).source).toMatchObject({ maxContext: 40960 });
    expect(toDraft({ ...api, apiMaxContext: '' }).source).not.toHaveProperty('maxContext');
  });

  it('does not require an API key — a local endpoint is a normal thing to point at', () => {
    expect(formComplete({ ...EMPTY_FORM, name: 'Local', sourceKind: 'api', apiModel: 'llama', apiKey: '' })).toBe(true);
  });
});

describe('the API key', () => {
  // The backend answers whether a key is set and never the key, and keeps the stored key on an
  // update that sends none. Everything here follows from those two facts.
  const keyed = model({
    source: {
      kind: 'api',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      hasApiKey: true,
      model: 'claude-sonnet-5',
    },
  });

  it('opens a keyed model with the field empty, knowing a key is set', () => {
    const form = draftFrom(keyed);
    expect(form).toMatchObject({ apiKey: '', apiKeyStored: true, apiKeyRemoved: false });
    expect(keepsStoredKey(form)).toBe(true);
    expect(toDraft(form).source).not.toHaveProperty('apiKey');
  });

  it('sends a typed key, trimmed, to replace the stored one', () => {
    const form = { ...draftFrom(keyed), apiKey: '  sk-new ' };
    expect(keepsStoredKey(form)).toBe(false);
    expect(toDraft(form).source).toMatchObject({ apiKey: 'sk-new' });
  });

  it('sends an empty key to remove the stored one, and a typed key wins over removing', () => {
    const removed = { ...draftFrom(keyed), apiKeyRemoved: true };
    expect(toDraft(removed).source).toMatchObject({ apiKey: '' });
    expect(toDraft({ ...removed, apiKey: 'sk-new' }).source).toMatchObject({ apiKey: 'sk-new' });
  });

  it('sends no key for a new model nobody typed one for', () => {
    const form = { ...EMPTY_FORM, name: 'Local', sourceKind: 'api' as const, apiModel: 'llama' };
    expect(toDraft(form).source).not.toHaveProperty('apiKey');
    // "Removing" means nothing without a stored key, so it sends nothing either.
    expect(toDraft({ ...form, apiKeyRemoved: true }).source).not.toHaveProperty('apiKey');
  });

  it('holds the save when the address moves away from the stored key, as the backend would', () => {
    const moved = { ...draftFrom(keyed), apiBaseUrl: 'https://llm.corp.example' };
    expect(apiKeyProblem(moved)).toContain('only to the address it was set for');
    expect(formComplete(moved)).toBe(false);
    // Typing the key again, or removing it, is what the backend accepts for a move.
    expect(formComplete({ ...moved, apiKey: 'sk-ant' })).toBe(true);
    expect(formComplete({ ...moved, apiKeyRemoved: true })).toBe(true);
  });

  it('compares addresses the way the backend does: as parsed URLs', () => {
    const form = draftFrom(keyed);
    expect(apiKeyProblem({ ...form, apiBaseUrl: 'https://api.anthropic.com/' })).toBe('');
    const v1 = { ...form, apiKeyBaseUrl: 'https://api.openai.com/v1' };
    expect(apiKeyProblem({ ...v1, apiBaseUrl: 'https://api.openai.com/v1' })).toBe('');
    expect(apiKeyProblem({ ...v1, apiBaseUrl: 'https://api.openai.com/v1/' })).not.toBe('');
  });

  it('raises nothing for a model with no key, wherever it moves', () => {
    const keyless = draftFrom(model({ source: { ...keyed.source, hasApiKey: false } as AiModelSource }));
    expect(apiKeyProblem({ ...keyless, apiBaseUrl: 'https://llm.corp.example' })).toBe('');
    expect(keepsStoredKey(keyless)).toBe(false);
  });
});

describe('describeModel', () => {
  it('says nothing about progress for a remote model, which has nothing to download', () => {
    const view = describeModel(
      model({ source: { kind: 'api', protocol: 'openai', baseUrl: 'u', hasApiKey: true, model: 'gpt-4o' } }),
    );
    expect(view.statusText).toBe('');
    expect(view.ready).toBe(true);
    expect(view.detail).toBe('gpt-4o');
  });

  it('distinguishes "no status yet" from "nothing to report"', () => {
    expect(describeModel(model({})).statusText).toBe('Checking…');
  });

  it('reports download progress before it reports the backend status line', () => {
    const view = describeModel(model({}), { downloaded: false, loaded: false, progress: 41.6, status: 'fetching' });
    expect(view.statusText).toBe('Downloading 42%');
    expect(view.ready).toBe(false);
  });

  it('is ready once loaded', () => {
    const view = describeModel(model({}), { downloaded: true, loaded: true, progress: 100, status: 'ready' });
    expect(view.statusText).toBe('Loaded — ready');
    expect(view.ready).toBe(true);
  });

  it('counts a transcription model ready once downloaded, since AD4M never marks one loaded', () => {
    // Reading `loaded` alone left every Whisper model unready for good, and the settings page polled
    // its status for as long as it stayed open.
    const status = { downloaded: true, loaded: false, progress: 100, status: 'Loaded' };
    expect(describeModel(model({ kind: 'transcription' }), status).ready).toBe(true);
    expect(describeModel(model({ kind: 'llm' }), status).ready).toBe(false);
  });
});

describe('remote API presets', () => {
  it('opens a model on the service its endpoint matches, or custom for one none describes', () => {
    const anthropic = draftFrom(
      model({
        source: {
          kind: 'api',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          hasApiKey: true,
          model: 'm',
        },
      }),
    );
    const gateway = draftFrom(
      model({
        source: {
          kind: 'api',
          protocol: 'anthropic',
          baseUrl: 'https://llm.corp.example',
          hasApiKey: true,
          model: 'm',
        },
      }),
    );
    expect(anthropic.apiService).toBe('anthropic');
    expect(gateway.apiService).toBe('custom');
  });

  it('recognises an endpoint as the preset it matches, trailing slash or not', () => {
    expect(matchingApiPreset({ apiProtocol: 'anthropic', apiBaseUrl: 'https://api.anthropic.com/' })).toBe('anthropic');
    expect(matchingApiPreset({ apiProtocol: 'openai', apiBaseUrl: 'https://openrouter.ai/api/v1' })).toBe('openrouter');
  });

  it('does not match an endpoint spoken to in a different protocol from the preset', () => {
    expect(matchingApiPreset({ apiProtocol: 'openai', apiBaseUrl: 'https://api.anthropic.com' })).toBe('');
  });

  it('has an id per preset, since the select keys on it', () => {
    expect(new Set(AI_API_PRESETS.map((p) => p.id)).size).toBe(AI_API_PRESETS.length);
  });

  it('speaks to Ollama in its own protocol, the only one where the window can be capped', () => {
    expect(AI_API_PRESETS.find((p) => p.id === 'ollama')).toMatchObject({ protocol: 'ollama' });
    expect(matchingApiPreset({ apiProtocol: 'ollama', apiBaseUrl: 'http://localhost:11434/' })).toBe('ollama');
    // A model saved through the compatible surface is still that, and opens as custom rather than
    // being quietly moved onto another provider.
    expect(matchingApiPreset({ apiProtocol: 'openai', apiBaseUrl: 'http://localhost:11434/v1' })).toBe('');
  });

  it('labels an Anthropic model as such in the list', () => {
    const view = describeModel(
      model({
        source: { kind: 'api', protocol: 'anthropic', baseUrl: 'u', hasApiKey: true, model: 'claude-sonnet-5' },
      }),
    );
    expect(view.sourceLabel).toBe('Anthropic API');
  });
});
