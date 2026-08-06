/**
 * The AI-model form's two directions.
 *
 * `draftFrom` and `toDraft` are inverses, and the value of writing them next to each other is only
 * realised if something checks that they actually are. The launcher's equivalent pair — a
 * `useEffect` that unfolds a model into eleven pieces of state and a cascade of `includes()` checks
 * that folds them back — disagree: a local file's tokenizer is written with empty repo/revision and
 * read back as a custom Hugging Face tokenizer.
 */
import type { AiModel } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  describeModel,
  draftFrom,
  EMPTY_FORM,
  formComplete,
  toDraft,
} from '../src/frameworks/solid/stores/aiModelDraft';

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
    model({ source: { kind: 'api', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'gpt-4o' } }),
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
    it(`survives ${original.source.kind}${original.source.kind === 'huggingface' && original.source.tokenizer ? ' with a tokenizer' : ''}`, () => {
      const round = toDraft(draftFrom(original));

      expect(round.name).toBe(original.name);
      expect(round.kind).toBe(original.kind);
      expect(round.source).toEqual(original.source);
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

  it('does not require an API key — a local endpoint is a normal thing to point at', () => {
    expect(formComplete({ ...EMPTY_FORM, name: 'Local', sourceKind: 'api', apiModel: 'llama', apiKey: '' })).toBe(true);
  });
});

describe('describeModel', () => {
  it('says nothing about progress for a remote model, which has nothing to download', () => {
    const view = describeModel(model({ source: { kind: 'api', baseUrl: 'u', apiKey: 'k', model: 'gpt-4o' } }));
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
});
