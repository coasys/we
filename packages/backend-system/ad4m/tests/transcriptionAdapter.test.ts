/**
 * The transcription port's install and progress, over a stand-in AI client.
 *
 * Worth testing because the executor's `addModel` does not answer until a download of most of a
 * gigabyte has finished, so the adapter deliberately does not wait for it — and the ways that can go
 * wrong are all quiet: a second registration of the same model, an install that reports failure for
 * a model that is in fact downloading, or a guest offered a button the node should not have.
 */
import { describe, expect, it } from 'vitest';

import { createAd4mTranscriptionPort } from '../src/transcriptionAdapter';

interface Row {
  id: string;
  name: string;
  modelType: string;
}

/** An AI client whose `addModel` writes the row at once and then never answers — like a real download. */
function client({ rows = [] as Row[], refuse = false, status = {} as Record<string, unknown> } = {}) {
  const added: unknown[] = [];
  return {
    added,
    ai: {
      getModels: async () => rows,
      getDefaultModel: async () => null,
      modelLoadingStatus: async () => status,
      addModel: (input: unknown) => {
        added.push(input);
        if (refuse) return Promise.reject(new Error('capability denied'));
        rows = [...rows, { id: 'new', name: 'Whisper small', modelType: 'TRANSCRIPTION' }];
        return new Promise<string>(() => {});
      },
    },
  };
}

describe('offeredModel', () => {
  it('offers Whisper small, with its size, where this connection runs the node', () => {
    const port = createAd4mTranscriptionPort(client());
    expect(port.offeredModel?.()).toEqual({ name: 'Whisper small', downloadBytes: 967_000_000 });
  });

  it('offers nothing to a guest on somebody else’s node', () => {
    const port = createAd4mTranscriptionPort(client(), { administersNode: false });
    expect(port.offeredModel).toBeUndefined();
    expect(port.installOfferedModel).toBeUndefined();
  });

  it('offers nothing where the grant does not include adding a model', () => {
    const port = createAd4mTranscriptionPort(client(), {
      capabilities: [{ with: { domain: 'artificial intelligence', pointers: ['*'] }, can: ['READ'] }],
    });
    expect(port.offeredModel).toBeUndefined();
  });
});

describe('installOfferedModel', () => {
  it('resolves once the row exists, without waiting for the download', async () => {
    const c = client();
    const port = createAd4mTranscriptionPort(c);

    await port.installOfferedModel?.();

    expect(c.added).toEqual([
      { name: 'Whisper small', local: { fileName: 'whisper_small' }, modelType: 'TRANSCRIPTION' },
    ]);
  });

  it('does not register a second model when one is already there', async () => {
    const c = client({ rows: [{ id: 'm', name: 'Whisper', modelType: 'TRANSCRIPTION' }] });
    const port = createAd4mTranscriptionPort(c);

    await port.installOfferedModel?.();

    expect(c.added).toEqual([]);
  });

  it('throws a refusal that arrives before the row does', async () => {
    const port = createAd4mTranscriptionPort(client({ refuse: true }));

    await expect(port.installOfferedModel?.()).rejects.toThrow('capability denied');
  });
});

describe('models', () => {
  it('reports how far a download has got while the model is not ready', async () => {
    const c = client({
      rows: [{ id: 'm', name: 'Whisper small', modelType: 'TRANSCRIPTION' }],
      status: { downloaded: false, loaded: false, progress: 41.6 },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model).toMatchObject({ id: 'm', ready: false, progress: 42 });
  });

  it('leaves progress out once the model is ready', async () => {
    const c = client({
      rows: [{ id: 'm', name: 'Whisper small', modelType: 'TRANSCRIPTION' }],
      status: { downloaded: true, loaded: false, progress: 100 },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model.ready).toBe(true);
    expect(model).not.toHaveProperty('progress');
  });
});
