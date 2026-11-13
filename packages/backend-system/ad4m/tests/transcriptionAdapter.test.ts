/**
 * The transcription port's readiness, streams and one-step setup, over a stand-in AI client.
 *
 * Worth testing because every way it goes wrong is quiet: a model whose server is down read as
 * ready (a stream that never produces text), a second registration of the same model, a server
 * registered twice, or a guest offered a button the node should not have.
 */
import { describe, expect, it } from 'vitest';

import { createAd4mTranscriptionPort } from '../src/transcriptionAdapter';

interface Row {
  id: string;
  name: string;
  modelType: string;
  endpointId: string;
  remoteModel: string;
  status: { state: string; progress?: number };
}

const speaches = {
  kind: 'OPEN_AI_AUDIO',
  baseUrl: 'http://127.0.0.1:8000',
  capabilities: ['transcription', 'speech'],
  servedModels: ['speaches-ai/Kokoro-82M', 'Systran/faster-whisper-small'],
};

function row(status: Row['status'], id = 'm'): Row {
  return { id, name: 'Whisper', modelType: 'TRANSCRIPTION', endpointId: 'e', remoteModel: 'whisper', status };
}

/** An AI client with a speech server on loopback, which records what is registered. */
function client({
  rows = [] as Row[],
  detected = [speaches] as unknown[],
  endpoints = [] as { id: string; baseUrl: string }[],
  served = [
    { id: 'speaches-ai/Kokoro-82M', capabilities: ['speech'] },
    { id: 'Systran/faster-whisper-small', capabilities: ['transcription'] },
  ],
  defaultModel = null as { id: string } | null,
} = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  return {
    calls,
    ai: {
      getModels: async () => rows,
      getDefaultModel: async () => defaultModel,
      detectEndpoints: async () => detected,
      endpoints: async () => endpoints,
      discoverModels: async (params: unknown) => (record('discoverModels', params), served),
      addEndpoint: async (input: { baseUrl: string }) => (record('addEndpoint', input), { id: 'e-new', ...input }),
      addModel: async (input: unknown) => (record('addModel', input), 'new'),
      setDefaultModel: async (...args: unknown[]) => record('setDefaultModel', ...args),
      openTranscriptionStream: async (...args: unknown[]) => (record('open', ...args), 'stream'),
    },
  };
}

describe('models', () => {
  it('is ready only when its server says so', async () => {
    const [ready] = await createAd4mTranscriptionPort(client({ rows: [row({ state: 'READY' })] })).models();
    expect(ready).toMatchObject({ id: 'm', ready: true, isDefault: true });
    expect(ready).not.toHaveProperty('progress');
  });

  it('says why a model cannot run', async () => {
    const port = createAd4mTranscriptionPort(
      client({
        rows: [row({ state: 'ENDPOINT_DOWN' }, 'a'), row({ state: 'MISSING' }, 'b'), row({ state: 'UNKNOWN' }, 'c')],
      }),
    );
    const [down, missing, unknown] = await port.models();
    expect(down).toMatchObject({ ready: false, detail: 'The speech server is not answering' });
    expect(missing).toMatchObject({ ready: false, detail: 'The speech server does not have whisper' });
    expect(unknown.ready).toBe(false);
  });

  it('reports how far a pull has got', async () => {
    const [model] = await createAd4mTranscriptionPort(
      client({ rows: [row({ state: 'PULLING', progress: 41.6 })] }),
    ).models();
    expect(model).toMatchObject({ ready: false, progress: 42 });
  });
});

describe('open', () => {
  it('opens a stream with the model and the callback alone', async () => {
    const c = client();
    const onText = () => {};
    await createAd4mTranscriptionPort(c).open('m', onText);
    expect(c.calls).toEqual([{ method: 'open', args: ['m', onText] }]);
  });
});

describe('setup', () => {
  it('names a speech server running on the node’s machine', async () => {
    const setup = await createAd4mTranscriptionPort(client()).setup?.();
    expect(setup?.found).toBe('Use the speech server at localhost:8000');
    expect(setup?.installUrl).toMatch(/^https:\/\//);
  });

  it('finds nothing where no server transcribes, and still says where to get one', async () => {
    const setup = await createAd4mTranscriptionPort(
      client({ detected: [{ ...speaches, kind: 'OLLAMA', capabilities: ['chat'] }] }),
    ).setup?.();
    expect(setup?.found).toBe('');
    expect(setup?.installUrl).toBeTruthy();
  });

  it('offers nothing to a guest on somebody else’s node', () => {
    const port = createAd4mTranscriptionPort(client(), { administersNode: false });
    expect(port.setup).toBeUndefined();
    expect(port.connectFound).toBeUndefined();
  });

  it('offers nothing where the grant does not include adding a model', () => {
    const port = createAd4mTranscriptionPort(client(), {
      capabilities: [{ with: { domain: 'artificial intelligence', pointers: ['*'] }, can: ['READ'] }],
    });
    expect(port.setup).toBeUndefined();
  });
});

describe('connectFound', () => {
  it('registers the server, its recommended transcription model, and makes it the default', async () => {
    const c = client();
    await createAd4mTranscriptionPort(c).connectFound?.();
    expect(c.calls.map((call) => call.method)).toEqual([
      'discoverModels',
      'addEndpoint',
      'addModel',
      'setDefaultModel',
    ]);
    expect(c.calls[1].args[0]).toMatchObject({ kind: 'OPEN_AI_AUDIO', baseUrl: 'http://127.0.0.1:8000' });
    expect(c.calls[2].args[0]).toEqual({
      name: 'Systran/faster-whisper-small',
      modelType: 'TRANSCRIPTION',
      endpointId: 'e-new',
      remoteModel: 'Systran/faster-whisper-small',
    });
    expect(c.calls[3].args).toEqual(['TRANSCRIPTION', 'new']);
  });

  it('reuses an endpoint already registered at that address', async () => {
    const c = client({ endpoints: [{ id: 'e-old', baseUrl: 'http://127.0.0.1:8000/' }] });
    await createAd4mTranscriptionPort(c).connectFound?.();
    expect(c.calls.map((call) => call.method)).not.toContain('addEndpoint');
    expect(c.calls.find((call) => call.method === 'addModel')?.args[0]).toMatchObject({ endpointId: 'e-old' });
  });

  it('does not register a second model when one is already there', async () => {
    const c = client({ rows: [row({ state: 'READY' })] });
    await createAd4mTranscriptionPort(c).connectFound?.();
    expect(c.calls).toEqual([]);
  });

  it('refuses a server with no transcription model rather than registering a speech one', async () => {
    const c = client({ served: [{ id: 'speaches-ai/Kokoro-82M', capabilities: ['speech'] }] });
    await expect(createAd4mTranscriptionPort(c).connectFound?.()).rejects.toThrow('has no transcription model');
    expect(c.calls.map((call) => call.method)).toEqual(['discoverModels']);
  });
});
