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
  endpointId?: string;
}

interface EndpointRow {
  id: string;
  managed: boolean;
}

/** An AI client whose `localInstall` registers a transcription row — like a finished download. */
function client({
  rows = [] as Row[],
  installsNothing = false,
  refuse = false,
  status = {} as Record<string, unknown>,
  endpoints = undefined as EndpointRow[] | undefined | (() => Promise<EndpointRow[]>),
} = {}) {
  const installs: unknown[] = [];
  let liveRows = rows;
  return {
    installs,
    ai: {
      getModels: async () => liveRows,
      getDefaultModel: async () => null,
      modelStatus: async () => status,
      // Absent by default: the pre-endpoint API shape, where every model was the executor's own.
      ...(endpoints !== undefined
        ? { endpoints: typeof endpoints === 'function' ? endpoints : async () => endpoints }
        : {}),
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

  it('counts a remote model ready unless the executor says it failed', async () => {
    // A remote transcription endpoint often has no model listing at all, so its status stays
    // `UNKNOWN` — no verdict, not a failure. Reading anything but `READY` as "downloading" marked
    // every working remote speech model unready forever.
    const c = client({
      rows: [{ id: 'm', name: 'Remote whisper', modelType: 'TRANSCRIPTION', endpointId: 'ep-remote' }],
      endpoints: [{ id: 'ep-remote', managed: false }],
      status: { state: 'UNKNOWN' },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model.ready).toBe(true);
  });

  it('honours the executor’s no on a remote model — a failed endpoint is not ready', async () => {
    for (const state of ['ENDPOINT_DOWN', 'MISSING', 'PULLING']) {
      const c = client({
        rows: [{ id: 'm', name: 'Remote whisper', modelType: 'TRANSCRIPTION', endpointId: 'ep-remote' }],
        endpoints: [{ id: 'ep-remote', managed: false }],
        status: { state },
      });
      const [model] = await createAd4mTranscriptionPort(c).models();
      expect(model.ready).toBe(false);
    }
  });

  it('waits for READY only on the executor’s own model — a managed endpoint can still be pulling', async () => {
    const c = client({
      rows: [{ id: 'm', name: 'Local whisper', modelType: 'TRANSCRIPTION', endpointId: 'ep-local' }],
      endpoints: [{ id: 'ep-local', managed: true }],
      status: { state: 'UNKNOWN' },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model.ready).toBe(false);
  });

  it('takes an executor without the endpoint API as remote — nothing to wait a download on', async () => {
    // `ai.endpoints` missing entirely: a pre-endpoints client or executor. No endpoint can be
    // proven managed, so the model is taken at the status call's word — `UNKNOWN` is no verdict.
    const c = client({
      rows: [{ id: 'm', name: 'Old-node whisper', modelType: 'TRANSCRIPTION', endpointId: 'ep-x' }],
      status: { state: 'UNKNOWN' },
    });
    const [model] = await createAd4mTranscriptionPort(c).models();
    expect(model.ready).toBe(true);
  });

  it('takes a guest’s unseen endpoint list as remote — the model is not this node’s download', async () => {
    const c = client({
      rows: [{ id: 'm', name: 'Hosted whisper', modelType: 'TRANSCRIPTION', endpointId: 'ep-x' }],
      endpoints: async () => {
        throw new Error('Forbidden');
      },
      status: { state: 'UNKNOWN' },
    });

    const [model] = await createAd4mTranscriptionPort(c).models();

    expect(model.ready).toBe(true);
  });
});
