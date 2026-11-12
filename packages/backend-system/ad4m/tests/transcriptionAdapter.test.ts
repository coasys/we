/**
 * The transcription port's install and progress, over a stand-in AI client.
 *
 * Local installs are the executor's own now — `ai.localInstall` picks the model, fetches it, and
 * resolves when done — so the ways this can go wrong are all quiet: a second install on top of a
 * working one, an install that finishes having registered nothing, or a guest offered a button the
 * node should not have.
 */
import { describe, expect, it } from 'vitest';

import { createAd4mTranscriptionPort } from '../src/transcriptionAdapter';

interface Row {
  id: string;
  name: string;
  modelType: string;
}

/** An AI client whose `localInstall` registers a transcription row — like a finished download. */
function client({
  rows = [] as Row[],
  installsNothing = false,
  refuse = false,
  status = {} as Record<string, unknown>,
} = {}) {
  const installs: unknown[] = [];
  let liveRows = rows;
  return {
    installs,
    ai: {
      getModels: async () => liveRows,
      getDefaultModel: async () => null,
      modelStatus: async () => status,
      localInstall: async (input: unknown) => {
        installs.push(input);
        if (refuse) throw new Error('capability denied');
        if (!installsNothing) {
          liveRows = [...liveRows, { id: 'new', name: 'Whisper small', modelType: 'TRANSCRIPTION' }];
        }
      },
    },
  };
}

describe('offeredModel', () => {
  it('offers the executor’s own speech model, with its size, where this connection runs the node', () => {
    const port = createAd4mTranscriptionPort(client());
    expect(port.offeredModel?.()).toEqual({ name: 'Whisper (on-device)', downloadBytes: 967_000_000 });
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
  it('runs the executor’s own install for speech-to-text, and registers nothing itself', async () => {
    const c = client();
    const port = createAd4mTranscriptionPort(c);

    await port.installOfferedModel?.();

    expect(c.installs).toEqual([{ services: ['stt'] }]);
  });

  it('does not install a second model when one is already there', async () => {
    const c = client({ rows: [{ id: 'm', name: 'Whisper', modelType: 'TRANSCRIPTION' }] });
    const port = createAd4mTranscriptionPort(c);

    await port.installOfferedModel?.();

    expect(c.installs).toEqual([]);
  });

  it('throws the install’s refusal', async () => {
    const port = createAd4mTranscriptionPort(client({ refuse: true }));

    await expect(port.installOfferedModel?.()).rejects.toThrow('capability denied');
  });

  it('throws when the install finishes with no speech model registered', async () => {
    const port = createAd4mTranscriptionPort(client({ installsNothing: true }));

    await expect(port.installOfferedModel?.()).rejects.toThrow('no speech-to-text model');
  });
});

describe('models', () => {
  it('reports how far a download has got while the model is not ready', async () => {
    const c = client({
      rows: [{ id: 'm', name: 'Whisper small', modelType: 'TRANSCRIPTION' }],
      status: { state: 'PULLING', progress: 41.6 },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model).toMatchObject({ id: 'm', ready: false, progress: 42 });
  });

  it('leaves progress out once the model is ready', async () => {
    const c = client({
      rows: [{ id: 'm', name: 'Whisper small', modelType: 'TRANSCRIPTION' }],
      status: { state: 'READY', progress: 100 },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model.ready).toBe(true);
    expect(model).not.toHaveProperty('progress');
  });

  it('reads a model whose status check fails as ready — the diagnostic must not hide a working one', async () => {
    const c = client({ rows: [{ id: 'm', name: 'Whisper small', modelType: 'TRANSCRIPTION' }] });
    c.ai.modelStatus = async () => {
      throw new Error('EntityNotFound');
    };

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model.ready).toBe(true);
  });
});
